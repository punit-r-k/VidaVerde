import assert from "node:assert/strict";
import test from "node:test";
import { buildShippingPlans } from "../lib/shippingParcels.js";

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

test("four sauerkraut jars retain single-box and split-box candidates", () => {
  const plans = buildShippingPlans([{ sku: "VV1", quantity: 4 }]);
  assert.ok(plans.some((plan) => plan.parcels.length === 1 && plan.parcels[0].packageCode === "SK-12"));
  assert.ok(plans.some((plan) => plan.parcels.length === 2));
});

test("hot sauce uses its exact five-count parcel", () => {
  const plans = buildShippingPlans([{ sku: "VV5", quantity: 5 }]);
  assert.equal(plans[0].parcels.length, 1);
  assert.equal(plans[0].parcels[0].packageCode, "HS-5");
  assert.equal(plans[0].parcels[0].weightOz, 57);
});
