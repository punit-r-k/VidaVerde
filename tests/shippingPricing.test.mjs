import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTINENTAL_US_SHIPPING_AREA_ERROR_MESSAGE,
  EXPEDITED_SHIPPING_OPTION_ID,
  getCustomerShippingOptions,
  getEstimatedShipDate,
  getLatestExpectedDeliveryDate,
  getNextPackingDate,
  getShippingOptionsForCart,
  getShippingTransitWindow,
  inferSelectedShippingOption,
  isContinentalUnitedStatesShippingAddressEligible,
  NORMAL_SHIPPING_OPTION_ID,
  normalizeShippingOptionId,
  SHIPPING_SCHEDULE_TIME_ZONE
} from "../lib/shippingPricing.js";

const buildCart = ({ sauerkrautQty = 0, hotSauceQty = 0 } = {}) => ({
  items: [
    { sku: "VV1", productType: "sauerkraut", quantity: sauerkrautQty },
    { sku: "VV5", productType: "hot_sauce", quantity: hotSauceQty }
  ],
  subtotalCents: sauerkrautQty * 1199 + hotSauceQty * 999
});

const formatDateKey = (date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

test("checkout exposes Normal and Expedited live options without flat prices", () => {
  const cart = buildCart({ sauerkrautQty: 2, hotSauceQty: 3 });
  const shipping = getShippingOptionsForCart(cart);
  const options = getCustomerShippingOptions({ shipping });

  assert.equal(shipping.tier, "live_rate");
  assert.equal(shipping.subtotalCents, cart.subtotalCents);
  assert.equal(shipping.sauerkrautCount, 2);
  assert.equal(shipping.hotSauceCount, 3);
  assert.deepEqual(options.map((option) => option.id), [
    NORMAL_SHIPPING_OPTION_ID,
    EXPEDITED_SHIPPING_OPTION_ID
  ]);
  assert.equal(options[0].amountCents, 0);
  assert.equal(options[1].amountCents, 0);
  assert.deepEqual(options[0].deliveryEstimate.maximum, {
    unit: "business_day",
    value: 5
  });
  assert.deepEqual(options[1].deliveryEstimate.maximum, {
    unit: "business_day",
    value: 3
  });
});

test("shipping option IDs normalize to Normal or Expedited", () => {
  for (const value of ["normal", "standard", "owner_delivery", "owner"]) {
    assert.equal(normalizeShippingOptionId(value), NORMAL_SHIPPING_OPTION_ID);
  }
  for (const value of ["fastest", "expedited", "expidited", "express"]) {
    assert.equal(normalizeShippingOptionId(value), EXPEDITED_SHIPPING_OPTION_ID);
  }
  assert.deepEqual(getShippingTransitWindow("normal"), {
    minimumDays: 3,
    maximumDays: 5
  });
  assert.deepEqual(getShippingTransitWindow("expedited"), {
    minimumDays: 1,
    maximumDays: 3
  });
});

test("both shipping options include Wednesday shipment and their delivery windows", () => {
  const shipping = getShippingOptionsForCart(buildCart({ sauerkrautQty: 1 }));
  assert.match(shipping.normalOption.transitLabel, /Wednesday shipment/i);
  assert.match(shipping.normalOption.transitLabel, /3–5 business days/i);
  assert.match(shipping.expeditedOption.transitLabel, /Wednesday shipment/i);
  assert.match(shipping.expeditedOption.transitLabel, /1–3 business days/i);
});

test("carrier shipping eligibility includes only the continental United States", () => {
  assert.equal(isContinentalUnitedStatesShippingAddressEligible({ state: "CA" }), true);
  assert.equal(isContinentalUnitedStatesShippingAddressEligible({ state: "tx" }), true);
  assert.equal(isContinentalUnitedStatesShippingAddressEligible({ state: "DC" }), true);
  assert.equal(isContinentalUnitedStatesShippingAddressEligible({ state: "AK" }), false);
  assert.equal(isContinentalUnitedStatesShippingAddressEligible({ state: "HI" }), false);
  assert.equal(isContinentalUnitedStatesShippingAddressEligible({ state: "ZZ" }), false);
  assert.match(CONTINENTAL_US_SHIPPING_AREA_ERROR_MESSAGE, /continental United States/i);
});

test("next shipping date follows the weekly Wednesday 8 AM cutoff", () => {
  const cases = [
    ["Monday", "2026-06-08T15:00:00-05:00", "2026-06-10"],
    ["Wednesday cutoff", "2026-06-10T08:00:00-05:00", "2026-06-10"],
    ["After cutoff", "2026-06-10T08:01:00-05:00", "2026-06-17"],
    ["Sunday", "2026-06-14T12:00:00-05:00", "2026-06-17"]
  ];

  for (const [label, orderDateInput, expectedDate] of cases) {
    assert.equal(formatDateKey(getNextPackingDate(new Date(orderDateInput))), expectedDate, label);
  }
});

test("delivery timing starts from the Wednesday handoff", () => {
  const shipping = getShippingOptionsForCart(buildCart({ sauerkrautQty: 1 }));
  const orderDate = new Date("2026-06-08T12:00:00-05:00");

  assert.equal(formatDateKey(getEstimatedShipDate({ orderDate })), "2026-06-10");
  assert.equal(
    formatDateKey(getLatestExpectedDeliveryDate({
      orderDate,
      shippingOption: shipping.normalOption
    })),
    "2026-06-17"
  );
  assert.equal(
    formatDateKey(getLatestExpectedDeliveryDate({
      orderDate,
      shippingOption: shipping.expeditedOption
    })),
    "2026-06-15"
  );
});

test("preorder readiness precedes the Wednesday handoff and carrier transit", () => {
  const shipping = getShippingOptionsForCart(buildCart({ sauerkrautQty: 1 }));
  assert.equal(
    formatDateKey(getLatestExpectedDeliveryDate({
      orderDate: new Date("2026-06-08T12:00:00-05:00"),
      shippingOption: shipping.normalOption,
      hasPreorderItems: true
    })),
    "2026-07-01"
  );
});

test("historical fastest metadata resolves to Expedited while retaining recorded labels", () => {
  const shipping = getShippingOptionsForCart(buildCart({ hotSauceQty: 2 }));
  const selection = inferSelectedShippingOption({
    shipping,
    amountCents: 1100,
    shippingRateMetadata: {
      shipping_option: "fastest",
      shipping_option_label: "Historical Expedited Shipping",
      shipping_estimate: "Historical estimate"
    }
  });

  assert.equal(selection.id, EXPEDITED_SHIPPING_OPTION_ID);
  assert.equal(selection.label, "Historical Expedited Shipping");
  assert.equal(selection.transitLabel, "Historical estimate");
});
