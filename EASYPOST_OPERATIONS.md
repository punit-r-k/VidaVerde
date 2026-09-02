# EasyPost Operations Runbook

This document is the operating guide for every EasyPost-related process in VidaVerde. It covers storefront quotes, quote reuse, checkout, label purchase, tracking webhooks, cost controls, monitoring, deployment, incident response, and EasyPost account administration.

## 1. Operating principles

- Never expose an EasyPost API key or webhook secret to the browser.
- Never call EasyPost on initial page load, cart edits, address keystrokes, or automatic retries.
- A customer explicitly requests a quote with **Calculate shipping** or **Update shipping**.
- Build exactly one deterministic parcel plan locally before contacting EasyPost.
- Cache an equivalent quote for 45 minutes and reuse it across checkout.
- A cache hit and order creation make zero EasyPost requests.
- Buying a label reuses the stored EasyPost Shipment and Rate IDs whenever the quote is still valid.
- A paid order may receive a replacement quote only through an authenticated administrator workflow.
- Never buy postage that exceeds the shipping revenue collected from the customer.
- Never create a standalone EasyPost Tracker. Tracking comes from the purchased label.
- Keep EasyPost IDs and tracking numbers in internal records for reconciliation and support.
- Customer-facing tracking emails are disabled; carrier tracking events are still processed operationally.

## 2. Code and data map

| Concern | Primary implementation |
| --- | --- |
| Storefront shipping controls | `app/components/Storefront.jsx` |
| Public quote endpoint | `app/api/shipping/quote/route.js` |
| Address, cart, and quote request validation | `lib/shippingSchemas.js` and the quote route |
| Deterministic parcel planning | `lib/shippingParcels.js` |
| EasyPost Shipment rating | `lib/shippingQuotes.js` |
| Quote fingerprint, cache, and budgets | `lib/shippingQuoteCache.js` |
| Customer shipping charge calculation | `lib/shippingCharge.js` |
| Checkout quote consumption | `app/api/order/route.js` |
| Admin label endpoint | `app/api/admin/shipments/[id]/labels/route.js` |
| Label preview, replacement, and purchase | `lib/shipmentLabelAutomation.js` |
| EasyPost client and webhook verification | `lib/easypost.js` |
| EasyPost tracking webhook | `app/api/webhooks/easypost/route.js` |
| Monotonic tracking-state policy | `lib/shippingOperationsPolicy.js` |
| Stripe refund/dispute retirement | `app/api/stripe/webhook/route.js` |
| Operations monitoring | `app/api/admin/health/route.js` |
| Quote/cache/budget database objects | `supabase/migrations/20260901130000_easypost_quote_cache_budget.sql` |

The main database objects are:

- `checkout_shipping_quotes`: quote token, fingerprint, EasyPost identifiers, price components, expiration, and lifecycle state.
- `shipment_quotes` and `shipment_parcels`: order-level shipping decision and parcel-level label/tracking records.
- `easypost_usage_ledger`: rating, verification, cache, label, blocked, failed, and estimated-cost events.
- `easypost_usage_alerts`: deduplicated 50%, 80%, and 100% budget alerts.
- `reserve_easypost_quote(...)`: atomic cache lookup and budget reservation under a PostgreSQL advisory lock.
- `get_easypost_usage_summary()`: current usage and financial summary for admin health.

## 3. End-to-end lifecycle

### 3.1 Storefront quote request

1. The customer enters a complete destination and chooses **Calculate shipping**.
2. The browser sends the normalized cart, destination, shipping service, and opaque browser quote-session ID to `POST /api/shipping/quote`.
3. The server rejects incomplete or invalid data before any provider request.
4. The server creates one deterministic parcel plan locally.
5. The server creates an HMAC-SHA-256 fingerprint from normalized destination, cart, parcel plan, ship date, requested service, carrier configuration, and origin configuration. Raw addresses are not used as cache keys.
6. `reserve_easypost_quote(...)` serializes equivalent requests and checks for an unexpired cached quote.
7. On a cache hit, the route returns the existing opaque quote token and makes no EasyPost request.
8. On a miss, the database atomically checks the per-session, per-fingerprint, daily, and monthly limits. If a limit is exceeded, it records a blocked event and the server does not contact EasyPost.
9. If allowed, the application creates one EasyPost Shipment per planned parcel. The first Shipment performs inline delivery-address verification. If there are additional parcels, they reuse the verified EasyPost Address ID.
10. The server selects the requested service, stores the EasyPost Shipment and Rate IDs, and computes the customer charge.
11. The customer charge is `postage + packaging`, rounded upward to the next whole dollar. No discount, cap, or hidden subsidy is applied.
12. The quote is stored as `quoted`, returned with an opaque UUID token, and expires after 45 minutes.

Important behavior:

- One parcel means at most one Shipment-rating request.
- Two parcels mean at most two Shipment-rating requests, with verification requested only on the first.
- Browser retries are not automatic. A customer can explicitly try again after a displayed failure.
- Cache hits do not consume new provider-rating or budget reservations, but every public request remains subject to endpoint abuse rate limiting.

### 3.2 Quote cache and concurrency

Equivalent requests share the same fingerprint. The reservation RPC uses an advisory lock so simultaneous requests cannot both miss the cache and spend the same budget independently.

The cache lifetime is 45 minutes. Configuration that changes rating behavior is part of the fingerprint, so a quote is not incorrectly reused after a carrier account, service, origin, parcel plan, or API-key mode change.

The browser sees only the quote UUID token. It never receives the HMAC secret or uses the raw HMAC as a token.

### 3.3 Order creation and payment

1. The browser submits `shippingQuoteToken` with the order.
2. `POST /api/order` loads the server-side quote.
3. The server verifies expiration, destination, cart, parcel plan, selected service, and price invariants.
4. Order creation performs zero EasyPost requests.
5. The quote is attached to the Stripe PaymentIntent/order workflow and transitions to `attached`.
6. The stored postage, packaging, charged shipping, and margin values become the source of truth for fulfillment.

If the token is missing, expired, mismatched, or already unusable, the order is rejected rather than silently obtaining a different rate.

### 3.4 Post-payment shipment release

Shipment release is an authenticated admin action.

- If the checkout quote remains usable, the preview reuses its stored EasyPost Shipment and Rate IDs and makes zero provider requests.
- If it has expired, an authenticated admin may preview a replacement. Replacement preview rates exactly the deterministic parcel plan again.
- Replacement is never automatic and requires confirmation before purchase.
- Replacement is blocked if its total postage and packaging exceed shipping revenue collected from the customer.
- Paid-order data, rather than browser input, is used for the destination and parcel plan.

### 3.5 Label purchase

For each parcel, the label workflow:

1. Retrieves the stored EasyPost Shipment to recover current state.
2. If a label already exists, treats it as recovery and does not purchase another label.
3. Otherwise buys the stored EasyPost Rate on that Shipment.
4. Stores the label URL/PDF URL, tracking number, carrier, service, postage, and EasyPost identifiers.
5. Records label usage in the EasyPost ledger.
6. Marks the checkout quote `purchased` once the associated label work succeeds.

The normal maximum is one Shipment `GET` plus one buy `POST` per parcel. During an ambiguous network failure, recovery may require another `GET`; the workflow remains idempotent and does not create a new Shipment merely to recover a purchase.

Never click or submit label purchase repeatedly while the first request is unresolved. Check the stored parcel and EasyPost Shipment before attempting recovery.

### 3.6 Tracking and EasyPost webhooks

Purchased labels supply tracking codes. VidaVerde does not create standalone Tracker objects.

EasyPost sends tracking events to `POST /api/webhooks/easypost`. The endpoint:

- verifies the EasyPost webhook signature;
- applies endpoint rate limiting;
- accepts supported `tracker.updated` events;
- matches parcel records by tracking number;
- advances parcel and shipment state monotonically so an older webhook cannot move a package backward; and
- does not enqueue a customer tracking email.

Operational staff can still use the stored tracking number and carrier site. Preserve webhook logs and EasyPost object IDs when investigating delivery issues.

### 3.7 Refunds, disputes, and cancellation of work

Stripe is authoritative for payment refunds and disputes. A verified full refund or terminal payment state retires unneeded shipping work and prevents normal fulfillment from continuing. Partial refunds do not automatically retire fulfillment.

Before requesting a carrier label refund:

1. Confirm a label was actually purchased.
2. Confirm the carrier has not scanned or used it.
3. Preserve the EasyPost Shipment ID, tracking number, label purchase date, and order ID.
4. Follow the carrier/EasyPost refund eligibility rules in the EasyPost dashboard or support channel.
5. Reconcile any provider credit separately from the customer's Stripe refund.

There is no general-purpose automated EasyPost label-refund process in this repository. Do not mark a label refunded internally until EasyPost or the carrier confirms it.

## 4. EasyPost request budget

| Event | EasyPost request maximum |
| --- | ---: |
| Page load, cart edit, address typing | 0 |
| Valid cached quote | 0 |
| New one-parcel quote | 1 Shipment create/rate request |
| New two-parcel quote | 2 Shipment create/rate requests |
| Order creation | 0 |
| Admin preview using a valid checkout quote | 0 |
| Admin replacement preview | 1 Shipment create/rate request per parcel |
| Normal label purchase | 1 Shipment GET + 1 buy POST per parcel |
| Tracking | 0 standalone Tracker creates |

EasyPost currently bills rating overages per Shipment rated beyond the plan allowance, not merely per customer quote. The internal ledger therefore distinguishes a quote/rating operation from the number of rated Shipments.

## 5. Budget controls and safeguards

Production requires explicit circuit-breaker values:

```dotenv
EASYPOST_LIVE_QUOTES_ENABLED=true
EASYPOST_MONTHLY_OVERAGE_LIMIT_CENTS=500
EASYPOST_DAILY_RATING_LIMIT=100
EASYPOST_DAILY_ADDRESS_VERIFICATION_LIMIT=100
EASYPOST_RATING_OVERAGE_UNIT_CENTS=2
EASYPOST_ADDRESS_VERIFICATION_OVERAGE_UNIT_CENTS=2
```

The values above are an example policy, not a universal budget. Set the three limits to amounts approved by the business. The two unit-cost values should match the current EasyPost contract; EasyPost's published Free Access overage examples currently use $0.02 per rated Shipment and $0.02 per eligible domestic address verification.

Other controls include:

- public endpoint IP rate limiting;
- a limit of two uncached quote attempts per browser session/fingerprint window;
- fingerprint-based duplicate suppression;
- daily rating and address-verification ceilings;
- a monthly estimated-overage ceiling;
- alerts at 50%, 80%, and 100%;
- database constraints that prevent negative margin, a hidden discount, or charging less than stored postage plus packaging; and
- production startup checks for required secrets and settings.

When a ceiling is reached, the correct outcome is to block a new quote and show a recoverable customer message. Do not bypass the limit by calling EasyPost manually from the browser or by changing data in the ledger.

## 6. Required configuration

At minimum, production uses:

```dotenv
EASYPOST_API_KEY=EZAK_live_key_from_secret_manager
EASYPOST_WEBHOOK_SECRET=secret_from_easypost_webhook_configuration
EASYPOST_LIVE_QUOTES_ENABLED=true
SHIPPING_QUOTE_HMAC_SECRET=at_least_32_random_bytes

EASYPOST_FROM_NAME=Vida Verde Sauerkraut
EASYPOST_FROM_STREET1=...
EASYPOST_FROM_CITY=...
EASYPOST_FROM_STATE=...
EASYPOST_FROM_ZIP=...
EASYPOST_FROM_COUNTRY=US
EASYPOST_FROM_PHONE=...
EASYPOST_FROM_EMAIL=...

EASYPOST_MONTHLY_OVERAGE_LIMIT_CENTS=...
EASYPOST_DAILY_RATING_LIMIT=...
EASYPOST_DAILY_ADDRESS_VERIFICATION_LIMIT=...
EASYPOST_RATING_OVERAGE_UNIT_CENTS=2
EASYPOST_ADDRESS_VERIFICATION_OVERAGE_UNIT_CENTS=2
```

Optional configuration includes `EASYPOST_CARRIER_ACCOUNT_IDS` and `EASYPOST_REQUEST_TIMEOUT_MS`.

Security requirements:

- Store live keys only in the production secret manager.
- Use EasyPost test keys outside production. Application configuration rejects a production EasyPost key in a non-production build.
- Rotate a key immediately if it appears in a log, ticket, screenshot, commit, or browser payload.
- Never include API keys, webhook secrets, full customer addresses, or payment data in support tickets.
- Rotate `SHIPPING_QUOTE_HMAC_SECRET` deliberately; changing it invalidates fingerprint equivalence for existing cache entries.

## 7. Request courtesy credits for the current overages

This is the procedure for requesting a one-time courtesy credit for the `$48.02` **Rating Overage** and `$18.66` **Address Verification Overage** (`$66.68` total). Approval is discretionary; document the incident honestly and do not describe it as an EasyPost error unless evidence proves that.

### Gather evidence

1. Sign in to the EasyPost dashboard.
2. Open **Billing > Invoices & Logs > Invoices**.
3. Download the invoice that contains both overage lines. Record its invoice number, billing period, issue date, and payment status.
4. If useful, export or capture the corresponding payment-log entry.
5. Prepare a short incident timeline: when excessive calls began, when they stopped, and when the production safeguards were deployed.
6. Prepare the corrective-action list: explicit quote button, 45-minute cache, deterministic parcel count, inline one-time verification, atomic usage reservation, daily/monthly circuit breakers, and 50/80/100 alerts.
7. Redact customer addresses, API credentials, payment details, and unrelated invoice data from attachments.

### Submit the request

1. Open [EasyPost Submit a request](https://support.easypost.com/hc/en-us/requests/new).
2. Sign in if prompted so the case is associated with the correct account.
3. Select the closest billing/payments/account category offered by the form. EasyPost may change the category labels.
4. Use the account email shown on the billed EasyPost account.
5. Attach the relevant invoice or a redacted screenshot showing the two line items.
6. Submit the following message after replacing the bracketed fields.

```text
Subject: Request for one-time courtesy credit for Rating and Address Verification overages

EasyPost account email: [ACCOUNT EMAIL]
Invoice number: [INVOICE NUMBER]
Billing period: [START DATE - END DATE]

Hello EasyPost Support,

I am requesting a one-time courtesy credit for these charges on the invoice above:

- Rating Overage: $48.02
- Address Verification Overage: $18.66
- Total requested credit: $66.68

The charges resulted from an application integration issue that generated more rating and address-verification activity than intended. We identified the issue on [DATE] and stopped the excess activity on [DATE].

We have now deployed the following controls:

- shipping rates are requested only after an explicit customer action;
- equivalent quotes are cached for 45 minutes;
- only one deterministic parcel plan is rated;
- delivery-address verification happens inline on only the first Shipment;
- duplicate concurrent requests are serialized atomically;
- daily rating, daily verification, and monthly cost circuit breakers block excess calls; and
- usage alerts are generated at 50%, 80%, and 100% of the approved budget.

Would you please review the $66.68 in overage charges for a one-time courtesy credit? Please also confirm where an approved credit would appear and whether EasyPost can apply an account-level hard spending or overage ceiling.

I have attached the relevant invoice. I can provide EasyPost object IDs or a more detailed incident timeline if needed, but I have omitted credentials and customer personal data.

Thank you,
[NAME]
[ROLE / BUSINESS]
```

### Track the request

- Save the support ticket number and submission date in the internal incident record.
- EasyPost states that it generally provides same-business-day support, but a credit review may take longer.
- Complimentary phone support is not generally offered, so keep the request in the support ticket thread.
- If EasyPost asks for examples, provide only relevant `shp_`, `adr_`, or other EasyPost object IDs and timestamps. Never provide the API key.
- When a decision arrives, verify the credit in **Billing > Invoices & Logs** or the destination named by support, then record the result in the incident.

### Request written billing protections

Use the same ticket, or open a separate billing ticket, to get written answers to every question below. Do not assume that a usage alert, wallet threshold, or application-side limit is an EasyPost account-level spending cap.

Replace `[APPROVED AMOUNT]` with the maximum additional EasyPost spend the business is willing to accept in one billing month. Keep the application value in `EASYPOST_MONTHLY_OVERAGE_LIMIT_CENTS` at or below that amount.

| Ask EasyPost | Required clarification or action |
| --- | --- |
| Can you enforce a hard monthly account ceiling of `$[APPROVED AMOUNT]` for all EasyPost platform fees and overages combined? | Ask EasyPost to reject or pause billable requests once the ceiling is reached, rather than continuing to accrue charges. |
| If a combined hard ceiling is unavailable, can you enforce separate hard limits for rating, address verification, standalone tracking, labels, insurance, and other paid products? | Obtain the exact limit available for each product and whether it blocks requests or merely sends an alert. |
| Which charges cannot be capped? | Require a list that includes carrier postage, carrier adjustments, address corrections, insurance, return labels, subscription fees, and usage overages as applicable. |
| What exactly happens at each limit? | Confirm whether API calls fail, label purchases stop, the account is suspended, wallet-carrier access stops, or charges continue. Ask for the returned API error and advance notice behavior. |
| Can billing alerts be sent at 50%, 80%, 90%, and 100% of the approved amount? | Provide at least two monitored billing email addresses and ask whether alerts are based on real-time, delayed, or estimated data. |
| What is our billing-cycle start, end, reset time, and time zone? | Record the exact cycle used for rating and address-verification allowances so internal monthly counters can match it. |
| What plan is active, and what usage is included? | Ask for the included labels, rated Shipments, address verifications, trackers, users, support, and any other metered units. |
| How is rating usage counted? | Confirm whether it is counted per Shipment created/rated, per rerate, per carrier account, or by another unit; ask how failed or duplicate requests are treated. |
| How is address-verification usage counted? | Confirm whether inline `to_address.verify` on a Shipment is included with that Shipment, and which standalone or repeated verifications are billable. |
| Are tracking codes from EasyPost-purchased labels included at no additional tracker fee? | Confirm that no standalone Tracker, Advanced Tracking, SMS, branded tracking page, or tracking-email product is enabled or required. |
| Please list every enabled subscription, add-on, beta, and automatically applied paid feature on the account. | Request removal of anything not explicitly approved in writing. Specifically verify Advanced Tracking and EasyPost Guard/automatic insurance status. |
| Can new paid products or plan upgrades require written administrator approval? | Ask EasyPost to prevent sales-assisted, dashboard, or automatic activation without approval from the named account owner. |
| What are the wallet auto-reload amount, trigger, daily/monthly maximum, and funding source? | Set the lowest operationally safe values. Confirm whether multiple reloads can occur rapidly during a usage spike. |
| Can wallet reloads have a hard daily and monthly maximum? | Ask what happens to label purchases after the maximum is reached and whether an alert is sent before failure. |
| Can credit-card fallback be disabled? | Confirm that a failed ACH debit cannot silently fall back to a fee-bearing card or trigger repeated reload attempts. |
| Which payment-method fees apply? | Obtain the current ACH, credit-card, failed-payment, retry, and other funding fees for this account and contract. |
| How are carrier adjustments controlled and reported? | Ask about weight/dimension adjustments, address-correction fees, duplicate labels, voids, returns, and how quickly adjustments appear. |
| Can carrier-adjustment notifications or thresholds be configured? | Request alerts for each adjustment and escalation when adjustments exceed an approved amount. |
| What is the unused-label refund process and deadline for every enabled carrier? | Record eligibility, automatic versus manual steps, expected credit timing, and where credits appear. |
| Which charges are billed by EasyPost versus directly by connected carrier accounts? | Request an itemized mapping so EasyPost invoices and carrier invoices are both included in reconciliation. |
| Is there an API or export for current-period billable usage and estimated charges? | Ask about reporting delay, fields, and whether the values are authoritative enough for an external circuit breaker. |
| Who is contacted during abnormal usage or suspected credential abuse? | Provide security and billing contacts and ask EasyPost to document its escalation and temporary-lock procedure. |
| Can support place a permanent note on the account describing the approved budget and disabled products? | Ask for written confirmation and the ticket/reference number for every account change. |

Copy and send this message:

```text
Subject: Help with billing credits and account safeguards

Hi EasyPost Support,

Could you please help us with the following?

1. Review the $48.02 rating and $18.66 address-verification overages for possible courtesy credits.
2. If available, cap our monthly EasyPost fees and overages at $15 and reject billable requests at that limit. Otherwise, please share the available caps, uncapped charges, and limit behaviors.
3. Send usage alerts to punit@vvsauerkraut.com at 50%, 80%, 90%, and 100%.
4. Confirm our plan, billing cycle, included usage, overage rates, and how ratings and address verifications are counted.
5. List and disable any unapproved paid add-ons, including Advanced Tracking, standalone tracking, and automatic Guard insurance, and require our written approval for new paid features.
6. Explain carrier adjustments, unused-label refunds, current-usage reporting, and how we can quickly block billable activity in an emergency.

We understand the overage charges may be valid and that any credit is discretionary. The excess usage came from an isolated integration issue that we promptly corrected by requiring explicit quote requests, caching quotes, and adding usage limits. We would be very grateful if you could provide a one-time courtesy credit while we continue using EasyPost responsibly.

We would appreciate knowing which controls are hard blocks versus alerts. Please confirm any changes in writing with a reference number.

Thank you for your help!

```

After EasyPost responds, save the answers in this runbook or the internal incident record. If EasyPost cannot provide a true hard ceiling, the VidaVerde database-backed circuit breakers are the primary protection; EasyPost alerts and wallet settings are secondary monitoring controls.

Official references:

- [EasyPost Billing & Payments](https://support.easypost.com/hc/en-us/articles/360042414212-Billing-Payments)
- [Contacting EasyPost Support](https://support.easypost.com/hc/en-us/articles/360045019471-Contacting-Support)
- [EasyPost support request form](https://support.easypost.com/hc/en-us/requests/new)

## 8. EasyPost dashboard administration

Review these settings with the EasyPost account owner:

1. Confirm the current plan and included label/rating allowance.
2. Cancel Advanced Tracking if it is enabled and not intentionally used.
3. Review EasyPost Guard and disable it if the business does not want that add-on.
4. Confirm the bank/ACH payment method is healthy.
5. Review automatic wallet reload thresholds and maximums.
6. Avoid credit-card wallet funding when possible; EasyPost currently documents a card convenience fee, while ACH avoids it.
7. Request the courtesy credits using the preceding procedure.
8. Ask EasyPost whether it can enforce a hard account-level spend or overage ceiling. Treat this as a second line of defense; the application circuit breaker remains required.
9. Review **Billing > Invoices & Logs** after every billing cycle until usage is stable.

## 9. Monitoring and reconciliation

The admin health endpoint includes EasyPost usage and financial data. Operations should monitor:

- cache hits and misses;
- rating operations and total Shipments rated;
- address verifications;
- purchased labels;
- blocked and failed quote requests;
- estimated monthly overage cost;
- 50%, 80%, and 100% alert records;
- quoted, attached, expired, cancelled, and purchased quote counts; and
- collected shipping revenue, postage, packaging, and margin.

Recommended cadence:

- Daily during rollout: compare internal rated-Shipments and verification counts with EasyPost activity.
- Weekly after stabilization: review admin health, failed/blocked requests, and label recovery events.
- Monthly: reconcile the EasyPost invoice, wallet activity, purchased labels, refunds, and the internal usage ledger.

Because the internal ledger estimates overages, the EasyPost invoice remains authoritative. Update the two unit-cost environment variables if the contract changes.

## 10. Incident playbooks

### Customers cannot obtain a quote

1. Check whether `EASYPOST_LIVE_QUOTES_ENABLED` is true.
2. Check admin health for a reached daily/monthly limit.
3. Check EasyPost service status and application logs using the request timestamp.
4. Confirm origin configuration and live credentials are present.
5. Do not raise limits until usage and financial impact are understood.
6. If a provider call failed, let the customer make one explicit retry after the fault is resolved.

### Quote volume or cost spikes

1. Disable new live quotes with `EASYPOST_LIVE_QUOTES_ENABLED=false` if spend is still increasing.
2. Preserve logs and ledger records; do not delete evidence.
3. Compare cache misses, rated Shipments, verification counts, session fingerprints, and IP rate-limit events.
4. Confirm the cache migration and reservation RPC are deployed.
5. Confirm the unit-cost environment values match the current contract.
6. Rotate the EasyPost key if unauthorized activity is possible.
7. Restore quoting only after testing a cache hit and a bounded cache miss.

### Label purchase has an ambiguous result

1. Do not create a replacement Shipment immediately.
2. Open the stored EasyPost Shipment ID in EasyPost or retrieve it through the existing admin workflow.
3. If a postage label and tracking code exist, persist/recover those values without buying again.
4. If no label exists, retry the idempotent purchase workflow once the provider state is known.
5. Reconcile wallet debits before any manual second purchase.

### Paid quote expired before fulfillment

1. Open the shipment through the authenticated admin interface.
2. Preview a replacement quote.
3. Compare replacement cost with customer shipping revenue.
4. If it exceeds collected shipping, do not purchase it through the normal workflow; escalate the order for a business decision.
5. If it is covered, explicitly confirm the replacement and purchase.

### Tracking appears to move backward

1. Compare EasyPost event timestamps and tracking status with the stored parcel.
2. Confirm webhook signature verification succeeded.
3. The monotonic policy should ignore stale regressions; investigate only if the persisted state actually regressed.
4. Use the tracking number and EasyPost object ID in a support ticket if the carrier feed itself is inconsistent.

## 11. Deployment and verification

Deployment order matters:

1. Back up or snapshot the production database according to the normal release procedure.
2. Choose one database setup path. For an existing database, apply unapplied files from `supabase/migrations/` in filename order. For a completely fresh rebuild, use `supabase/schema.sql` instead. Do not run the schema snapshot after the migrations on the same database.
3. Apply `supabase/migrations/20260901130000_easypost_quote_cache_budget.sql` before deploying application code that calls its RPCs when using the migration path.
4. Configure all production secrets and approved circuit-breaker limits.
5. Deploy the application.
6. Confirm the EasyPost webhook points to `/api/webhooks/easypost` and uses the configured webhook secret.
7. Run a test-mode one-parcel quote and confirm a second identical request is a cache hit.
8. Verify order creation performs no EasyPost request.
9. Verify an admin label preview reuses the quote.
10. Review admin health and ledger entries.
11. Enable live quoting only after the preceding checks pass.

Before each release that changes shipping, run the repository test, lint, security, and production-build commands documented in `package.json`. Specifically test quote cache hits, concurrency, budget exhaustion, expired quotes, price invariants, label recovery, refund retirement, and out-of-order tracking webhooks.

## 12. Change-management checklist

Any change to EasyPost behavior must answer all of these questions in code review:

- Does it add a new EasyPost request? If so, what is the maximum per customer action?
- Can the result be computed locally or reused from the quote cache?
- Is the call counted in `easypost_usage_ledger`?
- Is it protected by the atomic budget reservation or an authenticated admin action?
- Does it create an address verification, rated Shipment, label, or standalone Tracker charge?
- Can concurrency or retry behavior duplicate the charge?
- Does it preserve the no-hidden-subsidy and cost-coverage invariants?
- Does it expose credentials, raw personal data, or internal provider IDs to the browser?
- Are monitoring, migration, and rollback implications documented?
- Are test mode and production mode kept strictly separate?

Do not merge a shipping change until its provider-call budget and failure-recovery path are explicit.
