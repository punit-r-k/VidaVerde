import assert from "node:assert/strict";
import test from "node:test";
import {
  getShippingChargeBreakdown,
  roundUpToNearestDollarCents
} from "../lib/shippingCharge.js";

test("shipping plus packaging rounds up to the nearest dollar", () => {
  assert.deepEqual(
    getShippingChargeBreakdown({ postageCents: 821, boxCostCents: 250 }),
    {
      postageCents: 821,
      packagingCents: 250,
      unroundedCents: 1071,
      roundingCents: 29,
      amountCents: 1100
    }
  );
});

test("exact dollar totals are not increased", () => {
  assert.equal(roundUpToNearestDollarCents(1200), 1200);
});

test("invalid and empty totals safely remain zero", () => {
  assert.equal(roundUpToNearestDollarCents(0), 0);
  assert.equal(roundUpToNearestDollarCents("not-a-number"), 0);
});
