import assert from "node:assert/strict";
import test from "node:test";

import {
  FINANCIAL_TEST_CARD_LAST4,
  FINANCIAL_TEST_CUSTOMER_EMAIL,
  FINANCIAL_TEST_EMAILS,
  getChargeCardLast4,
  isFinancialTestCharge,
  isFinancialTestCustomer,
  isFinancialTestOrder
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

test("Punit Kothakonda orders using the designated email are tests", () => {
  assert.equal(FINANCIAL_TEST_CUSTOMER_EMAIL, "punit1012@tamu.edu");
  assert.equal(
    isFinancialTestCustomer({
      name: "Punit Kothakonda",
      email: "PUNIT1012@TAMU.EDU"
    }),
    true
  );
  assert.equal(
    isFinancialTestCustomer({
      name: "Punit Raj Kothakonda",
      email: " punit1012@tamu.edu "
    }),
    true
  );
});

test("the customer test rule requires both the identity and email", () => {
  assert.equal(
    isFinancialTestCustomer({
      name: "Someone Else",
      email: "punit1012@tamu.edu"
    }),
    false
  );
  assert.equal(
    isFinancialTestCustomer({
      name: "Punit Kothakonda",
      email: "customer@example.com"
    }),
    false
  );
});

test("designated business emails are tests regardless of customer name", () => {
  assert.deepEqual(FINANCIAL_TEST_EMAILS, [
    "punit@peridotkonda",
    "punit@peridotkonda.com",
    "vidaverdemicrogreens@gmail.com"
  ]);

  for (const email of FINANCIAL_TEST_EMAILS) {
    assert.equal(isFinancialTestCustomer({ name: "Someone Else", email }), true);
    assert.equal(isFinancialTestCustomer({ email: ` ${email.toUpperCase()} ` }), true);
  }
});

test("an order is a test when either the card or customer rule matches", () => {
  assert.equal(
    isFinancialTestOrder({
      charge: { payment_method_details: { card: { last4: "1111" } } },
      customer: { name: "Punit Raj Kothakonda", email: "punit1012@tamu.edu" }
    }),
    true
  );
});
