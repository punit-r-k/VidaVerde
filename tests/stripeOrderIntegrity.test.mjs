import assert from "node:assert/strict";
import test from "node:test";

import {
  getStripeCheckoutIdempotencyKey,
  getStripeChargeFinancialState,
  getStripeChargePlacedAt,
  getStripeDisputeAction,
  getStripePaymentIntentId,
  isCheckoutExpectationExact,
  isPaymentIntentCheckoutFlow,
  isStripeChargeFullyRefunded,
  parseStripeMetadataItems,
  validatePaymentIntentOrderIntegrity,
  validateStripeOrderIntegrity
} from "../lib/stripeOrderIntegrity.js";

const items = [
  { sku: "VV1", quantity: 2, price_cents: 1_199, product_type: "sauerkraut" },
  { sku: "VV5", quantity: 1, price_cents: 999, product_type: "hot_sauce" }
];
const subtotal = 3_397;

const buildCharge = (overrides = {}) => ({
  object: "charge",
  amount: 4_197,
  amount_captured: 4_197,
  amount_refunded: 0,
  refunded: false,
  disputed: false,
  currency: "usd",
  created: 1_800_000_000,
  livemode: true,
  ...overrides
});

const buildIntent = (overrides = {}) => ({
  object: "payment_intent",
  amount: 4_197,
  amount_received: 4_197,
  currency: "usd",
  metadata: {
    checkout_flow: "payment_intent",
    amount_subtotal: String(subtotal),
    amount_shipping: "800",
    amount_tax: "0",
    amount_total: "4197"
  },
  ...overrides
});

test("accepts an exact USD PaymentIntent accounting chain", () => {
  const result = validatePaymentIntentOrderIntegrity({
    intent: buildIntent(),
    charge: buildCharge(),
    items
  });

  assert.deepEqual(
    {
      ok: result.ok,
      currency: result.currency,
      subtotal: result.subtotal,
      shipping: result.shipping,
      tax: result.tax,
      total: result.total
    },
    {
      ok: true,
      currency: "USD",
      subtotal,
      shipping: 800,
      tax: 0,
      total: 4_197
    }
  );
});

test("rejects non-USD and cross-object currency mismatches", () => {
  assert.equal(
    validatePaymentIntentOrderIntegrity({
      intent: buildIntent({ currency: "eur" }),
      charge: buildCharge({ currency: "eur" }),
      items
    }).code,
    "unsupported_currency"
  );
  assert.equal(
    validatePaymentIntentOrderIntegrity({
      intent: buildIntent(),
      charge: buildCharge({ currency: "cad" }),
      items
    }).code,
    "currency_mismatch"
  );
});

test("rejects item, component, and Stripe total mismatches", () => {
  assert.equal(
    validatePaymentIntentOrderIntegrity({
      intent: buildIntent({
        metadata: {
          ...buildIntent().metadata,
          amount_subtotal: "3396"
        }
      }),
      charge: buildCharge(),
      items
    }).code,
    "item_subtotal_mismatch"
  );

  assert.equal(
    validatePaymentIntentOrderIntegrity({
      intent: buildIntent({
        metadata: {
          ...buildIntent().metadata,
          amount_total: "4196"
        }
      }),
      charge: buildCharge({ amount: 4_196, amount_captured: 4_196 }),
      items
    }).code,
    "order_total_mismatch"
  );

  assert.equal(
    validatePaymentIntentOrderIntegrity({
      intent: buildIntent(),
      charge: buildCharge({ amount_captured: 4_196 }),
      items
    }).code,
    "total_mismatch"
  );
});

test("rejects malformed, fractional, duplicate, and overflowing item values", () => {
  for (const invalidItems of [
    [{ sku: "VV1", quantity: "1item", price_cents: 1_199 }],
    [{ sku: "VV1", quantity: 1.5, price_cents: 1_199 }],
    [
      { sku: "VV1", quantity: 1, price_cents: 1_199 },
      { sku: "vv1", quantity: 1, price_cents: 1_199 }
    ],
    [{ sku: "VV1", quantity: 2_147_483_647, price_cents: 2 }]
  ]) {
    assert.equal(
      validateStripeOrderIntegrity({
        items: invalidItems,
        currency: "usd",
        subtotal: 1_199,
        shipping: 0,
        tax: 0,
        total: 1_199,
        amountComparisons: { total: [1_199] }
      }).ok,
      false
    );
  }
});

test("accepts complimentary lines only inside a positive authoritative cart", () => {
  const mixedCart = [
    { sku: "GIFT", quantity: 1, price_cents: 0, product_type: "gift" },
    { sku: "VV1", quantity: 1, price_cents: 1_199, product_type: "sauerkraut" }
  ];
  const accepted = validateStripeOrderIntegrity({
    items: mixedCart,
    currency: "usd",
    subtotal: 1_199,
    shipping: 0,
    tax: 0,
    total: 1_199,
    amountComparisons: { total: [1_199] }
  });
  assert.equal(accepted.ok, true);
  assert.equal(accepted.items[0].price_cents, 0);

  assert.equal(
    validateStripeOrderIntegrity({
      items: [{ sku: "GIFT", quantity: 1, price_cents: 0 }],
      currency: "usd",
      subtotal: 0,
      shipping: 0,
      tax: 0,
      total: 0,
      amountComparisons: { total: [0] }
    }).code,
    "invalid_amount"
  );
});

test("metadata parsing fails closed instead of partially accepting malformed carts", () => {
  assert.deepEqual(
    parseStripeMetadataItems({
      metadata: { items: JSON.stringify(items) }
    }),
    items
  );
  assert.deepEqual(
    parseStripeMetadataItems({
      metadata: {
        items: JSON.stringify([
          items[0],
          { sku: "VV5", quantity: "1oops", price_cents: 999 }
        ])
      }
    }),
    []
  );
});

test("PaymentIntent flow marker must match exactly", () => {
  assert.equal(isPaymentIntentCheckoutFlow(buildIntent()), true);
  assert.equal(
    isPaymentIntentCheckoutFlow(buildIntent({
      metadata: { ...buildIntent().metadata, checkout_flow: "checkout_session" }
    })),
    false
  );
  assert.equal(
    isPaymentIntentCheckoutFlow(buildIntent({
      metadata: { ...buildIntent().metadata, checkout_flow: "Payment_Intent" }
    })),
    false
  );
  assert.equal(
    isPaymentIntentCheckoutFlow(buildIntent({ metadata: {} })),
    false
  );
});

test("checkout-attempt UUIDs produce only namespaced Stripe idempotency keys", () => {
  assert.equal(
    getStripeCheckoutIdempotencyKey(" 0198d1a2-9c4e-7b10-8e6d-123456789abc "),
    "vidaverde:checkout:0198d1a2-9c4e-7b10-8e6d-123456789abc"
  );
  assert.equal(getStripeCheckoutIdempotencyKey("same-cart-retry"), "");
  assert.equal(getStripeCheckoutIdempotencyKey("0198d1a2-9c4e-7b10-0e6d-123456789abc"), "");
  assert.equal(getStripeCheckoutIdempotencyKey(null), "");
});

test("checkout creation rejects every stale authoritative total or shipping choice", () => {
  const expectation = {
    totalCents: 4_197,
    shippingCents: 800,
    shippingOption: "normal"
  };
  assert.equal(isCheckoutExpectationExact({
    expectation,
    totalCents: 4_197,
    shippingCents: 800,
    shippingOption: "normal"
  }), true);
  assert.equal(isCheckoutExpectationExact({
    expectation,
    totalCents: 4_198,
    shippingCents: 800,
    shippingOption: "normal"
  }), false);
  assert.equal(isCheckoutExpectationExact({
    expectation,
    totalCents: 4_197,
    shippingCents: 801,
    shippingOption: "normal"
  }), false);
  assert.equal(isCheckoutExpectationExact({
    expectation,
    totalCents: 4_197,
    shippingCents: 800,
    shippingOption: "expedited"
  }), false);
  assert.equal(isCheckoutExpectationExact({
    expectation: null,
    totalCents: 4_197,
    shippingCents: 800,
    shippingOption: "normal"
  }), false);
});

test("operational events accept only safe PaymentIntent identifiers", () => {
  assert.equal(
    getStripePaymentIntentId({ object: "charge", payment_intent: "pi_123_safe" }),
    "pi_123_safe"
  );
  assert.equal(
    getStripePaymentIntentId({
      object: "charge",
      payment_intent: { id: "pi_456_safe" }
    }),
    "pi_456_safe"
  );
  assert.equal(
    getStripePaymentIntentId({ payment_intent: "pi_123'); DROP TABLE orders;--" }),
    ""
  );
});

test("only a complete charge refund is treated as fulfillment-cancelling", () => {
  assert.equal(
    isStripeChargeFullyRefunded({
      object: "charge",
      amount: 4_197,
      amount_refunded: 4_197,
      refunded: true
    }),
    true
  );
  assert.equal(
    isStripeChargeFullyRefunded({
      object: "charge",
      amount: 4_197,
      amount_refunded: 1_000,
      refunded: false
    }),
    false
  );
  assert.equal(
    isStripeChargeFullyRefunded({
      object: "charge",
      amount: 4_197,
      amount_refunded: 4_197,
      refunded: false
    }),
    false
  );
});

test("authoritative charge state blocks paid fulfillment after refunds or disputes", () => {
  assert.deepEqual(
    getStripeChargeFinancialState({
      charge: buildCharge({
        amount_refunded: 4_197,
        refunded: true
      })
    }),
    { ok: true, status: "refunded", retireWork: true }
  );

  assert.deepEqual(
    getStripeChargeFinancialState({
      charge: buildCharge({ amount_refunded: 1_000 })
    }),
    { ok: true, status: "paid", retireWork: false }
  );

  const disputedCharge = buildCharge({ disputed: true });
  assert.deepEqual(
    getStripeChargeFinancialState({
      charge: disputedCharge,
      disputes: [{ object: "dispute", status: "under_review" }]
    }),
    { ok: true, status: "disputed", retireWork: false }
  );
  assert.deepEqual(
    getStripeChargeFinancialState({
      charge: disputedCharge,
      disputes: [
        { object: "dispute", status: "won" },
        { object: "dispute", status: "lost" }
      ]
    }),
    { ok: true, status: "disputed", retireWork: true }
  );
  assert.deepEqual(
    getStripeChargeFinancialState({
      charge: disputedCharge,
      disputes: [
        { object: "dispute", status: "won" },
        { object: "dispute", status: "prevented" }
      ]
    }),
    { ok: true, status: "paid", retireWork: false }
  );
  assert.equal(
    getStripeChargeFinancialState({ charge: disputedCharge }).code,
    "dispute_state_missing"
  );
});

test("dispute statuses map to reversible operational actions", () => {
  for (const status of ["needs_response", "under_review", "warning_needs_response", "warning_under_review"]) {
    assert.equal(getStripeDisputeAction(status), "pause");
  }

  for (const status of ["won", "warning_closed", "prevented"]) {
    assert.equal(getStripeDisputeAction(status), "restore");
  }

  assert.equal(getStripeDisputeAction("lost"), "retire");
  assert.equal(getStripeDisputeAction("unknown_future_status"), "");
  assert.equal(getStripeDisputeAction(null), "");
});

test("placedAt is derived only from an exact latest-charge creation time", () => {
  assert.equal(
    getStripeChargePlacedAt(buildCharge()),
    new Date(1_800_000_000 * 1000).toISOString()
  );
  assert.equal(getStripeChargePlacedAt({ created: "1800000000" }), "");
  assert.equal(getStripeChargePlacedAt({}), "");
});
