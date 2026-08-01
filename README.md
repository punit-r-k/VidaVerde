# Vida Verde Storefront

Premium sourkrout and microgreen nourishment, built with Next.js + Supabase + Stripe.

## Quick Start

1) Install dependencies.

```bash
npm install
```

2) Create `.env.local` from `.env.example` and fill in the values.

3) Run the dev server.

```bash
npm run dev
```

## Inventory Sync (Google Sheets)

Inventory is stored in Supabase and synced to the `Inventory` sheet via Apps Script.
Column C is a restock delta; it is cleared after a successful sync to prevent double-counting.
The same Apps Script also syncs the weekly prep, orders, shipments, email
signup, and health-check tabs used by operations.
When a positive restock releases preorder units, the sheet schedules one
preorder-ready email pass five minutes after the latest restock. Releases across
multiple products are grouped by order so each customer receives one consolidated
market-pickup or shipping update instead of an email per product.

Apps Script file: `apps-script/inventory-sync.gs`

Script properties required:
- `API_BASE_URL` (example: `https://your-site-url`)
- `ADMIN_JWT_SECRET` (matches your server-side JWT signing secret)

Optional script properties:
- `ADMIN_JWT_ISSUER` (defaults to `vidaverde-admin`)
- `ADMIN_JWT_AUDIENCE` (defaults to `vidaverde-admin-api`)
- `ADMIN_JWT_SUBJECT` (defaults to `vidaverde-inventory-sync`)
- `ADMIN_JWT_ROLES` (defaults to `ops_admin,inventory_admin`)

The Apps Script now signs a fresh short-lived bearer JWT for each admin API request.
For a staged rollout, the script still accepts a legacy `ADMIN_RESTOCK_SECRET` property
as a fallback source for the signing secret, but the backend no longer accepts
`x-admin-secret` header authentication.

Sheet columns:
- Column A: SKU (`VV1` ... `VV6`)
- Column B: Product (name or slug, optional)
- Column C: Stock input (restock delta)
- Column D: Stock Status (on_hand)
- Column E: Status (In Stock / Out of Stock)
- Column F: # of Preorders (read-only; derived from paid orders and the preorder queue)
- Column G: Expected restock date
- Column H: Total Sales

Additional sheet behavior:
- The `Prepare for this week` tab now includes preorder units released by restocks
  in the active prep window as fresh demand for the current batch.
- The `Health` tab shows pickup-date backfill status, email queue status, latest
  order activity, latest restock activity, and latest pickup reminder activity.
- The prep, orders, and shipments tabs normalize phone numbers into readable sheet
  output such as `+1 (346) 387-2454`.
- Manual edits to the preorder count column are reverted. Preorder backlog is managed
  from actual paid orders so fulfillment stays first-come-first-served.

Spreadsheet toggle for stock visibility:
- The Apps Script creates a `Settings` sheet.
- Use `Settings!B2` (`Show stock on website`) checkbox to show/hide stock pills
  such as `Only 5 left` and `Sold Out` on the storefront.

Email signup sheet:
- A dedicated `Email List` sheet is created automatically during sync.
- Active subscribers appear in `Signed Up At`, `Email`, `Source`, and `Remove`.
- A blank spacer column separates them from `Unsubscribed At`, `Email`, `Reason`,
  and `Add Back` for suppressed addresses.
- Select any number of `Remove` and `Add Back` checkboxes, then use the green
  `Confirm Changes` control to apply the whole batch together.
- Both lists appear on the same `Email List` sheet, and suppressed rows are
  shaded red so they are easy to distinguish.
- Submitting the website signup form again is treated as renewed consent: the
  address leaves `Do Not Market` and returns to the active `Email List`.
- The Apps Script checks replies to `vvsauerkraut@gmail.com` every five minutes;
  a reply whose first non-empty line is `STOP` (case-insensitive) is unsubscribed automatically.

## Supabase Schema

Schema + seed data live in `supabase/schema.sql` for fresh rebuilds.
Incremental production changes live in `supabase/migrations/` and should be run
in filename order.
It defines tables for `products`, `inventory`, `orders`, `order_items`,
`preorder_queue`, `preorder_release_events`, `shipments`, `shipment_parcels`,
`shipment_quotes`, `checkout_shipping_quotes`, `email_jobs`, and analytics data.

Preorder-specific data model:
- `preorder_queue` stores the remaining preorder backlog by order and SKU.
- `preorder_release_events` stores each quantity released by incoming stock so prep
  generation and preorder-ready customer emails can react to newly available units.
- New paid orders stamp `orders`, `order_items`, and `preorder_queue` with the Stripe
  payment success time so restocks can fulfill preorders in true order sequence.
- Ready market pickup orders store `orders.pickup_date`, so prep sheets and
  reminder emails can ask directly for the target pickup date instead of
  recalculating old cutoff rules every time.

RPC functions:
- `record_paid_order` (Stripe webhook)
- `get_admin_prep_data` (grouped weekly prep and pickup verification data)
- `apply_restock` (restock delta plus preorder release event creation)
- `set_expected_restock_date`
- `consume_api_rate_limit` (distributed API throttling)

## Stripe Payments

Stripe PaymentIntents are created in `app/api/order/route.js`.
The storefront uses Stripe secure card fields on the page, so card details are
collected by Stripe and never stored by this app.
Stripe webhooks are handled in `app/api/stripe/webhook/route.js`.
Configure your Stripe webhook endpoint to listen to `payment_intent.succeeded`.
The webhook still accepts `checkout.session.completed` and
`checkout.session.async_payment_succeeded` for legacy in-flight payments created
before the PaymentIntent migration.

For shipping orders, customers choose Normal or Expedited service. Normal selects
the fastest EasyPost rate estimated at 3–5 business days and excludes estimates
under three days; Expedited selects the fastest eligible 1–3-business-day rate.
The server adds exact packaging cost to the selected postage and rounds the combined
charge up to the nearest dollar. Once the shipping address is valid, the storefront
automatically refreshes that final charge and expected arrival whenever the cart,
address, or shipping method changes. Normal and Expedited previews are calculated
concurrently, so both final charges and expected arrival dates appear together.
Expedited is displayed only when it is faster and costs more than Normal. If its
label is cheaper, that label is used for Normal and Expedited is hidden. Multi-parcel
orders use one carrier for every parcel.
Checkout recalculates the authoritative amount,
stores the reserved quote and expected arrival with the PaymentIntent, then reuses the
same quote to buy the prepaid label automatically after payment. Packages are handed
to carriers on Wednesday, and carrier transit time starts when the carrier receives
the parcel.

Required environment variables:
- `NEXT_PUBLIC_SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `STRIPE_SECRET_KEY`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `EASYPOST_API_KEY` (use a production key before purchasing real labels)
- `EASYPOST_FROM_NAME`
- `EASYPOST_FROM_STREET1`
- `EASYPOST_FROM_CITY`
- `EASYPOST_FROM_STATE`
- `EASYPOST_FROM_ZIP`
- `EASYPOST_FROM_COUNTRY`
- `EASYPOST_FROM_PHONE`
- `EASYPOST_FROM_EMAIL`
- `SITE_URL`

Optional for customer order confirmation and preorder-ready emails:
- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_SECURE`
- `SMTP_USER`
- `SMTP_PASS`
- `ORDER_EMAIL_FROM`
- `ORDER_EMAIL_REPLY_TO`
- `ORDER_EMAIL_BCC`
- `ORDER_EMAIL_BANNER_URL`
- `ORDER_CONFIRMATION_EMAIL_MODE=queue` to queue confirmation emails instead of
  sending them inline during checkout/webhook work
- `EMAIL_JOB_RETRY_DELAY_MS` to control queued email retry spacing

The webhook sends the customer confirmation email after a paid order is recorded.
To avoid duplicate sends on normal webhook retries, the database now tracks
`orders.customer_confirmation_email_sent_at`. Apply the updated
`supabase/schema.sql` in Supabase before relying on this in production.
The default banner image is bundled at `public/email/order-confirmation-banner.png`.
When `ORDER_CONFIRMATION_EMAIL_MODE=queue` is enabled, confirmations are written
to `email_jobs` and processed through `POST /api/admin/email-jobs`.

Preorder-ready emails are sent separately from `lib/preorderReadyEmail.js` five
minutes after the latest restock releases preorder units. Market-pickup emails include the current
pickup date details and calendar attachment; shipping emails include the shipping
method, ship-to address, and tracking/delivery follow-up language. Shipping
orders also have their shipment rows synced when preorder release emails are
processed.

Friday pickup reminder emails are sent from `lib/pickupReminderEmail.js` through
`POST /api/admin/pickup-reminders`. They reuse the same banner image as the order
confirmation email and rely on reminder markers stored in:
- `orders.pickup_reminder_email_sent_at`
- `preorder_release_events.pickup_reminder_email_sent_at`

The Google Apps Script includes `setupFridayReminderTrigger()` to schedule this
admin action for Fridays at 12pm America/Chicago.

## API Security

Admin APIs under `app/api/admin/*` now require `Authorization: Bearer <jwt>`.
Tokens are validated on every request and must:
- be signed with `ADMIN_JWT_SECRET` using `HS256`
- include the configured issuer and audience
- include `exp`, `iat`, and `sub` claims
- include role claims (`admin`, `ops_admin`, or `inventory_admin`) depending on the route

Role enforcement:
- `orders`, `shipments`, `prep`, `health`, `pickup-reminders`, and `email-jobs`
  require `admin` or `ops_admin`
- `inventory` and `restock` require `admin` or `inventory_admin`

## CORS

API CORS is enforced centrally in `proxy.js`.
Only origins listed in the environment are allowed:
- `CORS_ALLOWED_ORIGINS`
- `CORS_ALLOWED_ORIGINS_DEVELOPMENT`
- `CORS_ALLOWED_ORIGINS_STAGING`
- `CORS_ALLOWED_ORIGINS_PRODUCTION`

Additional CORS controls:
- `CORS_ALLOWED_HEADERS`
- `CORS_ALLOWED_METHODS`
- `CORS_ALLOW_CREDENTIALS`

Do not use `*` for authenticated admin routes.

## Rate Limiting

Rate limiting is enforced on every API route.
If Supabase is available and the updated `supabase/schema.sql` has been applied,
limits are stored in Postgres via `consume_api_rate_limit` so they continue to work
across multiple app instances. If that RPC is missing, the app falls back to an
in-memory limiter until the schema is deployed.

Environment override pattern:
- `RATE_LIMIT_<ROUTE_KEY>_WINDOW_MS`
- `RATE_LIMIT_<ROUTE_KEY>_IP_MAX`
- `RATE_LIMIT_<ROUTE_KEY>_USER_MAX`

Examples:
- `RATE_LIMIT_ORDER_CREATE_IP_MAX=6`
- `RATE_LIMIT_ANALYTICS_CREATE_IP_MAX=180`
- `RATE_LIMIT_ADMIN_ORDERS_GET_USER_MAX=90`
- `RATE_LIMIT_ADMIN_SHIPMENTS_GET_IP_MAX=120`

## Analytics Reporting

First-party analytics events are stored in Supabase through `POST /api/analytics`.
Run the local reporting script to generate a sanitized summary for Codex or manual review:

```bash
npm run analytics:report -- --range=7d
npm run analytics:report -- --range=30d --format=json
```

The report outputs aggregates, funnels, friction points, and recommended actions only.
It does not print service-role keys, raw event rows, or raw PII.

## Customize

- Update copy in `app/page.jsx` and `app/about/page.jsx`.
- Adjust styling in `app/globals.css`.
- Edit product catalog in the Supabase `products` table.

## Tailwind Hybrid Mode

Tailwind is configured in hybrid mode so existing CSS continues to work while you
migrate section-by-section:

- Config: `tailwind.config.js` (`preflight` disabled to avoid global resets)
- PostCSS: `postcss.config.js`
- Layers loaded in: `app/globals.css`

Current migrated example:
- The shop allergen chip bar in `app/page.jsx` now uses Tailwind utility classes.
