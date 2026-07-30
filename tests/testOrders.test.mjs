import assert from "node:assert/strict";
import test from "node:test";

import {
  FINANCIAL_TEST_CARD_LAST4,
  getChargeCardLast4,
  isFinancialTestCharge
} from "../lib/testOrders.js";

test("4242 card charges are excluded from financial distributions", () => {
  const charge = {
    payment_method_details: {
      type: "card",
      card: { last4: "4242" }
    }
  };

  assert.equal(FINANCIAL_TEST_CARD_LAST4, "4242");
  assert.equal(getChargeCardLast4(charge), "4242");
  assert.equal(isFinancialTestCharge(charge), true);
});

test("other cards and non-card payments remain distributable", () => {
  assert.equal(
    isFinancialTestCharge({
      payment_method_details: {
        type: "card",
        card: { last4: "1111" }
      }
    }),
    false
  );
  assert.equal(
    isFinancialTestCharge({
      payment_method_details: {
        type: "link"
      }
    }),
    false
  );
  assert.equal(isFinancialTestCharge(null), false);
});
