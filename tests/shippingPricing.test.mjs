import assert from "node:assert/strict";
import test from "node:test";

import {
  CONTINENTAL_US_SHIPPING_AREA_ERROR_MESSAGE,
  EXPEDITED_SHIPPING_OPTION_ID,
  getCustomerShippingOptions,
  getEstimatedShipDate,
  getExpectedDeliveryDateFromShipDate,
  getLatestExpectedDeliveryDate,
  getNextPackingDate,
  getShippingOptionsForCart,
  getShippingTransitWindow,
  inferSelectedShippingOption,
  isContinentalUnitedStatesShippingAddressEligible,
  NORMAL_SHIPPING_OPTION_ID,
  normalizeShippingOptionId,
  parseShippingCutoffTime,
  parseShippingScheduleDays,
  SHIPPING_CUTOFF_LABEL,
  SHIPPING_SCHEDULE_DAY_LABEL,
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

test("both shipping options calculate delivery after the configured carrier handoff", () => {
  const shipping = getShippingOptionsForCart(buildCart({ sauerkrautQty: 1 }));
  assert.match(shipping.normalOption.transitLabel, /estimated carrier-handoff date/i);
  assert.match(shipping.normalOption.transitLabel, /3–5 business days/i);
  assert.match(shipping.expeditedOption.transitLabel, /estimated carrier-handoff date/i);
  assert.match(shipping.expeditedOption.transitLabel, /1–3 business days/i);
  assert.equal(SHIPPING_SCHEDULE_DAY_LABEL, "Saturday");
  assert.equal(SHIPPING_CUTOFF_LABEL, "7:00 AM Central Time");
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

test("next shipping date uses the strict Saturday 7 AM cutoff", () => {
  const cases = [
    ["Monday", "2026-06-08T15:00:00-05:00", "2026-06-13"],
    ["Before cutoff", "2026-06-13T06:59:59-05:00", "2026-06-13"],
    ["Exact cutoff", "2026-06-13T07:00:00-05:00", "2026-06-20"],
    ["After cutoff", "2026-06-13T07:01:00-05:00", "2026-06-20"],
    ["Sunday", "2026-06-14T12:00:00-05:00", "2026-06-20"]
  ];

  for (const [label, orderDateInput, expectedDate] of cases) {
    assert.equal(formatDateKey(getNextPackingDate(new Date(orderDateInput))), expectedDate, label);
  }
});

test("delivery timing starts from the configured Saturday handoff", () => {
  const shipping = getShippingOptionsForCart(buildCart({ sauerkrautQty: 1 }));
  const orderDate = new Date("2026-06-08T12:00:00-05:00");

  assert.equal(formatDateKey(getEstimatedShipDate({ orderDate })), "2026-06-13");
  assert.equal(
    formatDateKey(getLatestExpectedDeliveryDate({
      orderDate,
      shippingOption: shipping.normalOption
    })),
    "2026-06-19"
  );
  assert.equal(
    formatDateKey(getLatestExpectedDeliveryDate({
      orderDate,
      shippingOption: shipping.expeditedOption
    })),
    "2026-06-17"
  );
});

test("preorder readiness precedes the configured handoff and carrier transit", () => {
  const shipping = getShippingOptionsForCart(buildCart({ sauerkrautQty: 1 }));
  assert.equal(
    formatDateKey(getLatestExpectedDeliveryDate({
      orderDate: new Date("2026-06-08T12:00:00-05:00"),
      shippingOption: shipping.normalOption,
      hasPreorderItems: true
    })),
    "2026-07-03"
  );
});

test("delivery can be calculated directly from a frozen carrier-handoff date", () => {
  const shipping = getShippingOptionsForCart(buildCart({ sauerkrautQty: 1 }));
  assert.equal(
    formatDateKey(getExpectedDeliveryDateFromShipDate({
      shipDate: new Date("2026-06-13T07:00:00-05:00"),
      shippingOption: shipping.normalOption
    })),
    "2026-06-19"
  );
});

test("shipping schedule configuration supports multiple days and rejects invalid values", () => {
  assert.deepEqual(parseShippingScheduleDays("Wednesday, Saturday,Wednesday"), [
    { index: 3, name: "Wednesday" },
    { index: 6, name: "Saturday" }
  ]);
  assert.deepEqual(parseShippingCutoffTime("07:00"), {
    hour: 7,
    minute: 0,
    value: "07:00"
  });
  assert.throws(() => parseShippingScheduleDays("Funday"), /Invalid shipping day/u);
  assert.throws(() => parseShippingCutoffTime("7:00"), /Invalid shipping cutoff/u);
});

test("multiple configured ship days drive the actual cutoff calculation", async () => {
  const previousDays = process.env.NEXT_PUBLIC_SHIPPING_DAYS;
  const previousCutoff = process.env.NEXT_PUBLIC_SHIPPING_CUTOFF_TIME;
  const previousTimeZone = process.env.NEXT_PUBLIC_SHIPPING_TIME_ZONE;

  process.env.NEXT_PUBLIC_SHIPPING_DAYS = "Wednesday,Saturday";
  process.env.NEXT_PUBLIC_SHIPPING_CUTOFF_TIME = "07:00";
  process.env.NEXT_PUBLIC_SHIPPING_TIME_ZONE = "America/Chicago";

  try {
    const configured = await import(`../lib/shippingPricing.js?multi-day=${Date.now()}`);
    assert.equal(
      formatDateKey(configured.getNextPackingDate(new Date("2026-06-10T06:59:59-05:00"))),
      "2026-06-10"
    );
    assert.equal(
      formatDateKey(configured.getNextPackingDate(new Date("2026-06-10T07:00:00-05:00"))),
      "2026-06-13"
    );
  } finally {
    if (previousDays === undefined) delete process.env.NEXT_PUBLIC_SHIPPING_DAYS;
    else process.env.NEXT_PUBLIC_SHIPPING_DAYS = previousDays;
    if (previousCutoff === undefined) delete process.env.NEXT_PUBLIC_SHIPPING_CUTOFF_TIME;
    else process.env.NEXT_PUBLIC_SHIPPING_CUTOFF_TIME = previousCutoff;
    if (previousTimeZone === undefined) delete process.env.NEXT_PUBLIC_SHIPPING_TIME_ZONE;
    else process.env.NEXT_PUBLIC_SHIPPING_TIME_ZONE = previousTimeZone;
  }
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
