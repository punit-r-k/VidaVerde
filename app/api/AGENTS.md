# API Route Guidance

Route handlers are security boundaries. Keep them thin and move deterministic domain
logic to `lib/` so it can be tested without starting Next.js.

## Required Route Shape

- Apply `securePublicRoute` to public endpoints and `secureAdminRoute` with the
  narrowest existing role set to admin endpoints.
- Define limits with `getRouteRateLimitConfig`; give each method/action a stable,
  distinct scope and return responses through the wrapper's `respond.json` so rate
  limit headers are retained.
- Bound request bodies with `readBoundedJsonBody` or `readBoundedTextBody`, especially
  for checkout and webhook routes. Validate parsed input with the nearest Zod schema.
- Use generic client-facing errors and log only operational context. Never return or
  log secrets, raw provider payloads, signed URLs, stack traces, or unnecessary PII.
- `proxy.js` centrally owns API CORS and ambiguous request-framing rejection. Do not
  add route-local wildcard CORS or bypass those checks.
- Keep state-changing admin actions separate from reporting reads. Do not turn a GET
  route into an operation with external or database side effects.

## Payments and Webhooks

- Verify webhook signatures against the exact bounded raw body before JSON parsing.
- Accept only the event and checkout-flow metadata already allowlisted by the Stripe
  integration. Preserve idempotency and tolerate retries and out-of-order financial
  events.
- The Stripe webhook is the primary paid-order persistence path;
  `/api/order/finalize` is an idempotent browser recovery path, not a competing source
  of truth.
- Order creation validates authoritative catalog data and a valid cached shipping
  quote. It does not buy labels or accept client-calculated totals.

## Verification

Add or update a focused `tests/*.test.mjs` suite for every behavior change. For API,
auth, webhook, CORS, request parsing, or error-shape changes, run:

```powershell
npm run lint
npm test
npm run security:repo
npm run test:security
```

Use Stripe test keys and EasyPost test keys only; tests must not make billable live
provider calls.

