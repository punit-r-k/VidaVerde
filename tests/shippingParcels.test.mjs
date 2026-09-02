import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import test from "node:test";
import {
  buildShippingPlan,
  buildShippingPlans
} from "../lib/shippingParcels.js";

test("keeps sauerkraut and hot sauce in separate parcels", () => {
  const plans = buildShippingPlans([{ sku: "VV1", quantity: 1 }, { sku: "VV5", quantity: 1 }]);
  assert.ok(plans.length > 0);
  assert.ok(plans.every((plan) => plan.parcels.length >= 2));
  assert.ok(plans.every((plan) => plan.parcels.every((parcel) => new Set(parcel.skus.map((sku) => sku === "VV5" || sku === "VV6" ? "hot_sauce" : "sauerkraut")).size === 1)));
});

test("two sauerkraut jars use the three-count parcel", () => {
  const plans = buildShippingPlans([{ sku: "VV1", quantity: 2 }]);
  assert.equal(plans[0].parcels.length, 1);
  assert.equal(plans[0].parcels[0].packageCode, "SK-3");
  assert.equal(plans[0].parcels[0].weightOz, 53);
});

test("four sauerkraut jars select one deterministic single-box plan", () => {
  const plans = buildShippingPlans([{ sku: "VV1", quantity: 4 }]);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].parcels.length, 1);
  assert.equal(plans[0].parcels[0].packageCode, "SK-12");
});

test("hot sauce uses its exact five-count parcel", () => {
  const plans = buildShippingPlans([{ sku: "VV5", quantity: 5 }]);
  assert.equal(plans[0].parcels.length, 1);
  assert.equal(plans[0].parcels[0].packageCode, "HS-5");
  assert.equal(plans[0].parcels[0].weightOz, 57);
});

test("planner exposes only the selected small-cart plan", () => {
  const plans = buildShippingPlans([{ sku: "VV5", quantity: 4 }]);
  assert.deepEqual(
    plans.map((plan) => plan.parcels.map((parcel) => parcel.packageCode)),
    [["HS-4"]]
  );
});

test("rejects duplicate SKUs after normalization", () => {
  assert.throws(
    () => buildShippingPlans([
      { sku: "VV1", quantity: 1 },
      { sku: " vv1 ", quantity: 1 }
    ]),
    /only once/i
  );
});

test("rejects unknown SKUs instead of silently omitting their units", () => {
  assert.throws(
    () => buildShippingPlans([
      { sku: "VV1", quantity: 1 },
      { sku: "VV7", quantity: 24 }
    ]),
    /not configured for SKU VV7/i
  );
});

test("rejects per-SKU and total-unit limits before planning", () => {
  const oversizedStartedAt = performance.now();
  assert.throws(
    () => buildShippingPlans([{ sku: "VV5", quantity: 1_000 }]),
    /24 or fewer/i
  );
  assert.ok(
    performance.now() - oversizedStartedAt < 100,
    "oversized quantities should fail before packing work begins"
  );

  assert.throws(
    () => buildShippingPlans([
      { sku: "VV1", quantity: 24 },
      { sku: "VV5", quantity: 24 },
      { sku: "VV2", quantity: 1 }
    ]),
    /48 total items/i
  );
});

test("maximum valid cart stays fast and within provider-work budgets", () => {
  const startedAt = performance.now();
  const plans = buildShippingPlans([
    { sku: "VV1", quantity: 24 },
    { sku: "VV5", quantity: 24 }
  ]);
  const elapsedMs = performance.now() - startedAt;

  assert.ok(elapsedMs < 500, `maximum cart planning took ${elapsedMs.toFixed(1)}ms`);
  assert.equal(plans.length, 1);
  assert.ok(
    plans.every((plan) =>
      plan.parcels.reduce((total, parcel) => total + parcel.quantity, 0) === 48
    )
  );
  assert.deepEqual(buildShippingPlan([
    { sku: "VV1", quantity: 24 },
    { sku: "VV5", quantity: 24 }
  ]), plans[0]);
});
