# Interactive Component Guidance

## Existing Ownership

- `Storefront.jsx`: catalog, cart, inventory polling, checkout state, shipping quote
  selection, and handoff to Stripe.
- `StripePaymentPanel.jsx`: Stripe Elements and payment confirmation only.
- `AnalyticsRuntime.jsx` plus `lib/analytics.js`: first-party event collection and
  sanitization.
- `MarketPickupPolicy.jsx`: presentation of policy owned by `lib/pickupDetails.js`.
- `RevealOnScroll.jsx`, `FaqAccordion.jsx`, and `TestimonialGrid.jsx`: shared motion and
  disclosure patterns.

## Component Rules

- Do not make the browser authoritative for inventory, product prices, tax, shipping
  charges, order totals, or payment success.
- Treat async inventory and quote responses as stale-able. Preserve the existing
  request identity/cancellation guards when changing cart, address, or fulfillment
  state.
- Derive state when practical instead of introducing another synchronized copy inside
  `Storefront.jsx`. Extract a focused helper to `lib/` when logic is deterministic and
  independently testable.
- Use shared checkout formatting and Zod schemas from `lib/checkoutSchema.js`; keep
  client guidance aligned with server validation without weakening the server.
- Preserve analytics attributes and emit only allowlisted, sanitized metadata. Never
  attach email, phone, street address, notes, or payment/provider identifiers.
- Modals and disclosures must retain focus management, Escape/keyboard behavior,
  accessible names, and scroll-lock cleanup.

For checkout changes, test the matching modules under `tests/` and run lint plus a
production build. Exercise market pickup, in-stock shipping, preorder shipping, and a
stale quote/address transition when those paths are affected.

