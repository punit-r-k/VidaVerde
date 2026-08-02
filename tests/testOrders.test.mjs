import assert from "node:assert/strict";
import test from "node:test";

import {
  isFinancialTestCharge,
  isFinancialTestOrder,
  isFinancialTestSource
} from "../lib/testOrders.js";

test("Stripe test-mode sources are financial tests", () => {
  assert.equal(isFinancialTestSource({ livemode: false }), true);
  assert.equal(isFinancialTestCharge({ livemode: false }), true);
  assert.equal(
    isFinancialTestOrder({ source: { object: "payment_intent", livemode: false } }),
    true
  );
});

test("Stripe live-mode and malformed sources are not financial test orders", () => {
  assert.equal(isFinancialTestSource({ livemode: true }), false);
  assert.equal(isFinancialTestSource({ livemode: "false" }), false);
  assert.equal(isFinancialTestSource({}), false);
  assert.equal(isFinancialTestSource(null), false);
});

test("card digits and customer identity cannot mark a live charge as a test", () => {
  assert.equal(
    isFinancialTestOrder({
      charge: {
        livemode: true,
        payment_method_details: { card: { last4: "4242" } }
      },
      customer: {
        name: "Store Operator",
        email: "operator@example.com"
      }
    }),
    false
  );
});

test("a test-mode charge marks the order as a financial test", () => {
  assert.equal(
    isFinancialTestOrder({
      charge: {
        livemode: false,
        payment_method_details: { card: { last4: "3155" } }
      },
      source: { livemode: true }
    }),
    true
  );
});

test("a test-mode source is sufficient when charge expansion is unavailable", () => {
  assert.equal(
    isFinancialTestOrder({
      charge: {},
      source: { object: "payment_intent", livemode: false }
    }),
    true
  );
});
