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
      discountCents: 0,
      amountCents: 1100,
      marginCents: 29
    }
  );
});

test("one-unit standard shipping never applies a loss-making cap", () => {
  const charge = getShippingChargeBreakdown(
    { postageCents: 821, boxCostCents: 250 },
    { subtotalCents: 1199, itemCount: 1, serviceLevel: "normal" }
  );

  assert.equal(charge.amountCents, 1100);
  assert.equal(charge.discountCents, 0);
  assert.ok(charge.amountCents >= charge.postageCents + charge.packagingCents);
});

test("one-unit standard shipping keeps a lower real charge", () => {
  const charge = getShippingChargeBreakdown(
    { postageCents: 625, boxCostCents: 75 },
    { subtotalCents: 999, itemCount: 1, serviceLevel: "normal" }
  );

  assert.equal(charge.amountCents, 700);
  assert.equal(charge.discountCents, 0);
});

test("multi-unit and expedited shipping retain the calculated charge", () => {
  const quote = { postageCents: 821, boxCostCents: 250 };

  assert.equal(
    getShippingChargeBreakdown(quote, {
      subtotalCents: 2398,
      itemCount: 2,
      serviceLevel: "normal"
    }).amountCents,
    1100
  );
  assert.equal(
    getShippingChargeBreakdown(quote, {
      subtotalCents: 1199,
      itemCount: 1,
      serviceLevel: "expedited"
    }).amountCents,
    1100
  );
});

test("exact dollar totals are not increased", () => {
  assert.equal(roundUpToNearestDollarCents(1200), 1200);
});

test("invalid and empty totals safely remain zero", () => {
  assert.equal(roundUpToNearestDollarCents(0), 0);
  assert.equal(roundUpToNearestDollarCents("not-a-number"), 0);
});
