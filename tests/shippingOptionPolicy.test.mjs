import assert from "node:assert/strict";
import test from "node:test";

import { resolveCustomerShippingSelections } from "../lib/shippingOptionPolicy.js";

const normalOption = { id: "normal", label: "Normal Shipping" };

const selection = ({ id, amountCents, deliveryDays, marker = id }) => ({
  quote: { marker },
  charge: { amountCents },
  deliveryDays,
  option: {
    id,
    label: id === "normal" ? "Normal Shipping" : "Expedited Shipping"
  }
});

test("shows Expedited only when it is faster and more expensive", () => {
  const result = resolveCustomerShippingSelections({
    normalOption,
    normalSelection: selection({ id: "normal", amountCents: 1000, deliveryDays: 4 }),
    expeditedSelection: selection({ id: "expedited", amountCents: 1500, deliveryDays: 2 })
  });

  assert.deepEqual(result.visibleOptionIds, ["normal", "expedited"]);
  assert.equal(result.normalSelection.charge.amountCents, 1000);
  assert.equal(result.expeditedSelection.charge.amountCents, 1500);
});

test("uses the cheaper Expedited label as Normal and hides Expedited", () => {
  const result = resolveCustomerShippingSelections({
    normalOption,
    normalSelection: selection({ id: "normal", amountCents: 1600, deliveryDays: 4 }),
    expeditedSelection: selection({
      id: "expedited",
      amountCents: 1200,
      deliveryDays: 2,
      marker: "expedited-label"
    })
  });

  assert.deepEqual(result.visibleOptionIds, ["normal"]);
  assert.equal(result.normalSelection.option.id, "normal");
  assert.equal(result.normalSelection.charge.amountCents, 1200);
  assert.equal(result.normalSelection.quote.marker, "expedited-label");
  assert.equal(result.expeditedSelection, null);
});

test("hides equal-priced Expedited and gives Normal the faster label", () => {
  const result = resolveCustomerShippingSelections({
    normalOption,
    normalSelection: selection({ id: "normal", amountCents: 1200, deliveryDays: 4 }),
    expeditedSelection: selection({ id: "expedited", amountCents: 1200, deliveryDays: 2 })
  });

  assert.deepEqual(result.visibleOptionIds, ["normal"]);
  assert.equal(result.normalSelection.deliveryDays, 2);
  assert.equal(result.normalSelection.option.id, "normal");
});

test("hides Expedited when it is not faster", () => {
  const result = resolveCustomerShippingSelections({
    normalOption,
    normalSelection: selection({ id: "normal", amountCents: 1000, deliveryDays: 3 }),
    expeditedSelection: selection({ id: "expedited", amountCents: 1500, deliveryDays: 3 })
  });

  assert.deepEqual(result.visibleOptionIds, ["normal"]);
  assert.equal(result.normalSelection.option.id, "normal");
});

test("uses an available Expedited label as Normal when Normal is unavailable", () => {
  const result = resolveCustomerShippingSelections({
    normalOption,
    normalSelection: null,
    expeditedSelection: selection({ id: "expedited", amountCents: 1400, deliveryDays: 2 })
  });

  assert.deepEqual(result.visibleOptionIds, ["normal"]);
  assert.equal(result.normalSelection.option.id, "normal");
  assert.equal(result.normalSelection.sourceServiceLevel, "expedited");
});
