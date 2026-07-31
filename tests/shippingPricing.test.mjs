import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTINENTAL_US_SHIPPING_AREA_ERROR_MESSAGE,
  FASTEST_SHIPPING_OPTION_ID,
  getCustomerShippingOptions,
  getEstimatedShipDate,
  getLatestExpectedDeliveryDate,
  getNextPackingDate,
  getShippingOptionsForCart,
  inferSelectedShippingOption,
  isContinentalUnitedStatesShippingAddressEligible,
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

test("checkout exposes one live fastest-carrier option without a flat price", () => {
  const cart = buildCart({ sauerkrautQty: 2, hotSauceQty: 3 });
  const shipping = getShippingOptionsForCart(cart);
  const options = getCustomerShippingOptions({ shipping });

  assert.equal(shipping.tier, "live_rate");
  assert.equal(shipping.subtotalCents, cart.subtotalCents);
  assert.equal(shipping.sauerkrautCount, 2);
  assert.equal(shipping.hotSauceCount, 3);
  assert.equal(options.length, 1);
  assert.equal(options[0].id, FASTEST_SHIPPING_OPTION_ID);
  assert.equal(options[0].amountCents, 0);
  assert.match(options[0].note, /live postage plus packaging/i);
});

test("legacy shipping option IDs normalize to the new fastest workflow", () => {
  for (const value of ["fastest", "standard", "expedited", "owner_delivery", "owner"]) {
    assert.equal(normalizeShippingOptionId(value), FASTEST_SHIPPING_OPTION_ID);
  }
});

test("shipping copy includes the Wednesday carrier handoff", () => {
  const shipping = getShippingOptionsForCart(buildCart({ sauerkrautQty: 1 }));
  assert.match(shipping.fastestOption.transitLabel, /carrier on Wednesday/i);
  assert.match(shipping.fastestOption.transitLabel, /fastest available service/i);
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
      shippingOption: shipping.fastestOption
    })),
    "2026-06-17"
  );
});

test("preorder readiness precedes the Wednesday handoff and carrier transit", () => {
  const shipping = getShippingOptionsForCart(buildCart({ sauerkrautQty: 1 }));
  assert.equal(
    formatDateKey(getLatestExpectedDeliveryDate({
      orderDate: new Date("2026-06-08T12:00:00-05:00"),
      shippingOption: shipping.fastestOption,
      hasPreorderItems: true
    })),
    "2026-07-01"
  );
});

test("historical metadata resolves to the fastest option while retaining recorded labels", () => {
  const shipping = getShippingOptionsForCart(buildCart({ hotSauceQty: 2 }));
  const selection = inferSelectedShippingOption({
    shipping,
    amountCents: 1100,
    shippingRateMetadata: {
      shipping_option: "expedited",
      shipping_option_label: "Historical Expedited Shipping",
      shipping_estimate: "Historical estimate"
    }
  });

  assert.equal(selection.id, FASTEST_SHIPPING_OPTION_ID);
  assert.equal(selection.label, "Historical Expedited Shipping");
  assert.equal(selection.transitLabel, "Historical estimate");
});
