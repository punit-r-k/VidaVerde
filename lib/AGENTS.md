# Shared Domain Library Guidance

## Ownership

- Checkout input and normalization: `checkoutSchema.js`
- Pickup timing and policy: `pickupDetails.js`
- Carrier schedule and option semantics: `shippingPricing.js`
- Parcel construction, rate choice, and charge math: `shippingParcels.js`,
  `shippingRateRanking.js`, `shippingCharge.js`
- Quote reuse and provider budgets: `shippingQuoteCache.js`, `shippingQuotes.js`
- Stripe transport and financial integrity: `stripe.js`, `stripeOrderIntegrity.js`,
  `stripeFinancialState.js`
- API auth, rate limits, CORS, and bounded bodies: `adminAuth.js`, `apiSecurity.js`,
  `rateLimit.js`, `cors.js`, `requestBody.js`
- Email composition and durable workers: the `*Email.js`, `*Dispatch.js`, and
  `emailJobQueue.js` modules
- Supabase service-role access: `supabaseAdmin.js`

## Design Rules

- Prefer small pure exports for money, time, normalization, selection, and state
  transition decisions. Keep network and database effects at orchestration edges.
- Preserve integer-cent arithmetic and explicit currency checks. Shipping charged to
  a customer must cover postage plus packaging and follow the existing round-up rule.
- Date behavior must be deterministic from an injected `Date` when tested. Do not use
  host-local timezone assumptions for market or carrier calculations.
- External requests need explicit timeouts, sanitized failures, and bounded retries.
  Before adding an EasyPost call, account for cache reuse, concurrency, the usage
  ledger, and its maximum calls per user/operator action.
- `supabaseAdmin` is optional in some local/read paths. Preserve intentional fallbacks
  for catalog/display reads, but fail closed for payments and privileged mutations.
- Durable email and shipment workers use leases, claims, and idempotent message IDs.
  Do not replace those with in-memory flags or best-effort fire-and-forget behavior.
- Do not expose server-only modules to client components. A shared client-safe helper
  must have no secret-bearing imports or module-level access to private environment
  variables.

## Tests

Mirror the module name in `tests/` where possible. Cover exact boundaries and failure
states, not just the happy path: cutoff instants, zero/rounding cents, expired quotes,
duplicate delivery, reordered financial events, lease expiry, and malformed input.

