# Test Suite Guidance

Tests use Node's built-in runner and strict assertions. Test files are ESM
`*.test.mjs`; application modules are imported directly where possible.

## Placement and Style

- Add behavior to the closest existing suite before creating a new file.
- Name tests as observable rules. Prefer table-driven cases for aliases, statuses,
  schedule boundaries, and malformed inputs.
- Keep fixtures minimal and deterministic. Inject timestamps and environment values;
  restore mutated `process.env` and globals in cleanup hooks.
- Mock provider/database boundaries, not the pure policy being tested. No test may
  purchase a real label, charge a card, send live email, or mutate production data.
- Assert both the success result and the safety invariant: no duplicate side effect,
  no undercharge, no unauthorized access, no stale state regression, or no PII leak.

## Choosing Suites

| Change | Focused suites |
| --- | --- |
| Checkout input/body limits | `checkout*`, `requestBody.test.mjs`, `cartLimits`-related coverage |
| Pickup and prep timing | `pickupDetails.test.mjs`, `pickupDetails` consumers |
| Shipping options/rates/costs | `shippingPricing`, `shippingRateRanking`, `shippingCharge`, `shippingOptionPolicy` |
| Parcels and quote safety | `shippingParcels`, `shippingQuoteSafety`, `easypostWebhook` |
| Stripe persistence/state | `stripeOrderIntegrity`, `paymentFinancialStateOperations`, `testOrders` |
| Email queues and releases | `emailReliability`, `pendingEmailQueue`, `preorderReadyEmailOperations` |
| Admin and database hardening | `adminShipmentPolicy`, `databaseHardening`, `operationsHardening` |
| Metadata/discovery | `seoMetadata.test.mjs` |
| End-to-end security posture | `tests/security/security.test.mjs` via `npm run test:security` |

Run one file while iterating:

```powershell
node --test tests/shippingPricing.test.mjs
```

Run the serial full suite before completing a cross-cutting change:

```powershell
npm test
```

The security integration suite starts a local Next.js server and is intentionally
separate/slower; use it for API/security/configuration changes.

