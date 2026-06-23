import assert from "node:assert/strict";
import test from "node:test";

import {
  LOCAL_SHIPPING_AREA_ERROR_MESSAGE,
  OWNER_DELIVERY_OPTION,
  getCartUpsellMessage,
  getCustomerShippingOptions,
  getEstimatedShipDate,
  getLatestExpectedDeliveryDate,
  getNextPackingDate,
  getShippingOptionsForCart,
  inferSelectedShippingOption,
  isGreaterHoustonShippingAddressEligible,
  SHIPPING_SCHEDULE_TIME_ZONE
} from "../lib/shippingPricing.js";

const SAUERKRAUT_PRICE = 1199;
const HOT_SAUCE_PRICE = 999;

const buildCart = ({ sauerkrautQty, hotSauceQty }) => {
  const items = [];
  if (sauerkrautQty > 0) {
    items.push({
      sku: "VV1",
      productType: "sauerkraut",
      quantity: sauerkrautQty
    });
  }
  if (hotSauceQty > 0) {
    items.push({
      sku: "VV5",
      productType: "hot_sauce",
      quantity: hotSauceQty
    });
  }

  return {
    items,
    subtotalCents: sauerkrautQty * SAUERKRAUT_PRICE + hotSauceQty * HOT_SAUCE_PRICE
  };
};

const formatDateKey = (date) => {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((acc, part) => {
    if (part.type !== "literal") {
      acc[part.type] = part.value;
    }
    return acc;
  }, {});
  const year = parts.year;
  const month = parts.month;
  const day = parts.day;
  return `${year}-${month}-${day}`;
};

const expectedRows = [
  [0, 1, "small", 699, 1199],
  [0, 2, "standard", 999, 1499],
  [0, 3, "standard", 999, 1499],
  [0, 4, "bundle", 1499, 1999],
  [0, 5, "bundle", 1499, 1999],
  [0, 6, "bundle", 1499, 1999],
  [0, 7, "large_bundle", 1899, 2499],
  [1, 0, "single_jar", 799, 1499],
  [1, 1, "standard", 999, 1499],
  [1, 2, "standard", 999, 1499],
  [1, 3, "bundle", 1499, 1999],
  [1, 4, "bundle", 1499, 1999],
  [1, 5, "bundle", 1499, 1999],
  [1, 6, "large_bundle", 1899, 2499],
  [2, 0, "bundle", 1499, 1999],
  [2, 1, "bundle", 1499, 1999],
  [2, 2, "bundle", 1499, 1999],
  [2, 3, "bundle", 1499, 1999],
  [2, 4, "bundle", 1499, 1999],
  [2, 5, "large_bundle", 1899, 2499],
  [3, 0, "large_bundle", 1899, 2499],
  [3, 1, "large_bundle", 1899, 2499],
  [3, 2, "large_bundle", 1899, 2499],
  [3, 3, "large_bundle", 1899, 2499],
  [3, 4, "free_shipping", 0, 999],
  [4, 0, "large_bundle", 1899, 2499],
  [4, 1, "large_bundle", 1899, 2499],
  [4, 2, "large_bundle", 1899, 2499],
  [4, 3, "free_shipping", 0, 999],
  [4, 4, "free_shipping", 0, 999]
];

test("shipping pricing matches the master customer table", () => {
  for (const [
    sauerkrautQty,
    hotSauceQty,
    tier,
    standardAmount,
    expeditedAmount
  ] of expectedRows) {
    const shipping = getShippingOptionsForCart(
      buildCart({ sauerkrautQty, hotSauceQty })
    );

    assert.equal(
      shipping.tier,
      tier,
      `${sauerkrautQty} sauerkraut + ${hotSauceQty} hot sauce tier`
    );
    assert.equal(shipping.standardOption.amountCents, standardAmount);
    assert.equal(shipping.expeditedOption.amountCents, expeditedAmount);
  }
});

test("one sauerkraut jar stays under twenty dollars with standard shipping", () => {
  const shipping = getShippingOptionsForCart(
    buildCart({ sauerkrautQty: 1, hotSauceQty: 0 })
  );

  assert.equal(shipping.standardOption.amountCents, 799);
  assert.equal(shipping.subtotalCents + shipping.standardOption.amountCents, 1998);
});

test("cart upsell returns free standard shipping threshold messages", () => {
  assert.equal(
    getCartUpsellMessage(buildCart({ sauerkrautQty: 2, hotSauceQty: 3 }))?.message,
    "Free standard shipping starts at $75."
  );

  const awayMessage = getCartUpsellMessage(
    buildCart({ sauerkrautQty: 0, hotSauceQty: 7 })
  );
  assert.equal(
    awayMessage?.message,
    "You're $5.07 away from free standard shipping."
  );
  assert.equal(awayMessage?.amountAwayFromFreeShippingCents, 507);
  assert.equal(awayMessage?.formattedAmountAwayFromFreeShipping, "$5.07");

  const almostMessage = getCartUpsellMessage(
    buildCart({ sauerkrautQty: 2, hotSauceQty: 5 })
  );
  assert.equal(
    almostMessage?.message,
    "You're almost at free standard shipping, only $1.07 away."
  );
  assert.equal(almostMessage?.amountAwayFromFreeShippingCents, 107);
  assert.equal(almostMessage?.formattedAmountAwayFromFreeShipping, "$1.07");

  assert.equal(
    getCartUpsellMessage(buildCart({ sauerkrautQty: 3, hotSauceQty: 4 }))?.message,
    "Free standard shipping unlocked."
  );
});

test("cart upsell suggests an item when it unlocks free standard shipping", () => {
  assert.equal(
    getCartUpsellMessage(buildCart({ sauerkrautQty: 3, hotSauceQty: 3 }))?.message,
    "Add one hot sauce and your order ships standard for free."
  );
});

test("cart upsell only shows same-cost messages when the benefit is real", () => {
  const cases = [
    [0, 1, null],
    [0, 2, "You can add another hot sauce before shipping increases."],
    [1, 0, null],
    [1, 1, "You can add another hot sauce before shipping increases."],
    [2, 0, "You can add one hot sauce without increasing shipping."],
    [2, 1, "You can add another hot sauce without increasing shipping."],
    [2, 2, "You can add another hot sauce without increasing shipping."]
  ];

  for (const [sauerkrautQty, hotSauceQty, message] of cases) {
    assert.equal(
      getCartUpsellMessage(buildCart({ sauerkrautQty, hotSauceQty }))?.message ?? null,
      message,
      `${sauerkrautQty} sauerkraut + ${hotSauceQty} hot sauce upsell`
    );
  }

  assert.equal(
    getCartUpsellMessage(buildCart({ sauerkrautQty: 0, hotSauceQty: 0 })),
    null
  );
  assert.equal(
    getCartUpsellMessage(buildCart({ sauerkrautQty: 0, hotSauceQty: 3 })),
    null
  );
});

test("free shipping has highest priority", () => {
  const shipping = getShippingOptionsForCart({
    items: [
      { sku: "VV1", productType: "sauerkraut", quantity: 1 },
      { sku: "VV5", productType: "hot_sauce", quantity: 7 }
    ],
    subtotalCents: 8192
  });

  assert.equal(shipping.tier, "free_shipping");
  assert.equal(shipping.standardOption.amountCents, 0);
  assert.equal(shipping.expeditedOption.amountCents, 999);
});

test("shipping options keep Standard, Expedited, Owner delivery order", () => {
  const shipping = getShippingOptionsForCart(
    buildCart({ sauerkrautQty: 1, hotSauceQty: 1 })
  );

  assert.deepEqual(
    getCustomerShippingOptions({ shipping, includeOwnerDelivery: false }).map(
      (option) => option.id
    ),
    ["standard", "expedited"]
  );
  assert.deepEqual(
    getCustomerShippingOptions({ shipping, includeOwnerDelivery: true }).map(
      (option) => option.id
    ),
    ["standard", "expedited", "owner_delivery"]
  );
  assert.equal(OWNER_DELIVERY_OPTION.amountCents, 100000);
});

test("shipping option transit labels include the packing schedule", () => {
  const shipping = getShippingOptionsForCart(
    buildCart({ sauerkrautQty: 1, hotSauceQty: 1 })
  );

  assert.match(shipping.standardOption.transitLabel, /Ships on the next packing day/i);
  assert.match(shipping.standardOption.transitLabel, /2–5 business days/);
  assert.match(shipping.expeditedOption.transitLabel, /Ships on the next packing day/i);
  assert.match(shipping.expeditedOption.transitLabel, /1–3 business days/);
});

test("local shipping eligibility is limited to Greater Houston-area TX ZIP prefixes", () => {
  assert.equal(
    isGreaterHoustonShippingAddressEligible({
      state: "TX",
      postalCode: "77494"
    }),
    true
  );
  assert.equal(
    isGreaterHoustonShippingAddressEligible({
      state: "tx",
      postalCode: "77002-1234"
    }),
    true
  );
  assert.equal(
    isGreaterHoustonShippingAddressEligible({
      state: "TX",
      postalCode: "78701"
    }),
    false
  );
  assert.equal(
    isGreaterHoustonShippingAddressEligible({
      state: "CA",
      postalCode: "90210"
    }),
    false
  );
  assert.match(LOCAL_SHIPPING_AREA_ERROR_MESSAGE, /Greater Houston area/i);
});

test("next packing date follows Tuesday and Saturday 8 AM cutoff", () => {
  const cases = [
    ["Monday 3 PM", "2026-06-08T15:00:00-05:00", "2026-06-09"],
    ["Tuesday 7:59 AM", "2026-06-09T07:59:00-05:00", "2026-06-09"],
    ["Tuesday 8:00 AM", "2026-06-09T08:00:00-05:00", "2026-06-09"],
    ["Tuesday 8:01 AM", "2026-06-09T08:01:00-05:00", "2026-06-13"],
    ["Wednesday 12 PM", "2026-06-10T12:00:00-05:00", "2026-06-13"],
    ["Thursday 12 PM", "2026-06-11T12:00:00-05:00", "2026-06-13"],
    ["Friday 12 PM", "2026-06-12T12:00:00-05:00", "2026-06-13"],
    ["Saturday 7:59 AM", "2026-06-13T07:59:00-05:00", "2026-06-13"],
    ["Saturday 8:00 AM", "2026-06-13T08:00:00-05:00", "2026-06-13"],
    ["Saturday 8:01 AM", "2026-06-13T08:01:00-05:00", "2026-06-16"],
    ["Sunday 12 PM", "2026-06-14T12:00:00-05:00", "2026-06-16"]
  ];

  for (const [label, orderDateInput, expectedDate] of cases) {
    assert.equal(
      formatDateKey(getNextPackingDate(new Date(orderDateInput))),
      expectedDate,
      label
    );
  }
});

test("latest expected delivery date starts from the next packing day", () => {
  const shipping = getShippingOptionsForCart(
    buildCart({ sauerkrautQty: 1, hotSauceQty: 1 })
  );
  const orderDate = new Date("2026-06-08T12:00:00-05:00");

  assert.equal(formatDateKey(getEstimatedShipDate({ orderDate })), "2026-06-09");
  assert.equal(
    formatDateKey(
      getLatestExpectedDeliveryDate({
        orderDate,
        shippingOption: shipping.standardOption
      })
    ),
    "2026-06-16"
  );
  assert.equal(
    formatDateKey(
      getLatestExpectedDeliveryDate({
        orderDate,
        shippingOption: shipping.expeditedOption
      })
    ),
    "2026-06-12"
  );
});

test("expedited shipping changes transit speed but not the packing date", () => {
  const shipping = getShippingOptionsForCart(
    buildCart({ sauerkrautQty: 1, hotSauceQty: 1 })
  );
  const orderDate = new Date("2026-06-09T08:01:00-05:00");

  assert.equal(formatDateKey(getEstimatedShipDate({ orderDate })), "2026-06-13");
  assert.equal(
    formatDateKey(
      getLatestExpectedDeliveryDate({
        orderDate,
        shippingOption: shipping.standardOption
      })
    ),
    "2026-06-19"
  );
  assert.equal(
    formatDateKey(
      getLatestExpectedDeliveryDate({
        orderDate,
        shippingOption: shipping.expeditedOption
      })
    ),
    "2026-06-17"
  );
});

test("latest expected delivery date includes preorder ready window before packing and transit", () => {
  const shipping = getShippingOptionsForCart(
    buildCart({ sauerkrautQty: 1, hotSauceQty: 0 })
  );

  assert.equal(
    formatDateKey(
      getLatestExpectedDeliveryDate({
        orderDate: new Date("2026-06-08T12:00:00-05:00"),
        shippingOption: shipping.standardOption,
        hasPreorderItems: true
      })
    ),
    "2026-07-03"
  );
});

test("selected shipping option uses rate metadata and amount fallback", () => {
  const shipping = getShippingOptionsForCart(
    buildCart({ sauerkrautQty: 3, hotSauceQty: 4 })
  );
  const metadataSelection = inferSelectedShippingOption({
    shipping,
    amountCents: 999,
    shippingRateMetadata: {
      shipping_tier: "free_shipping",
      shipping_option: "expedited",
      shipping_option_label: "Expedited Shipping Upgrade",
      shipping_estimate: "Ships on the next packing day, then typically arrives in 1–3 business days."
    }
  });

  assert.equal(metadataSelection.id, "expedited");
  assert.equal(metadataSelection.label, "Expedited Shipping Upgrade");

  const fallbackSelection = inferSelectedShippingOption({
    shipping,
    amountCents: 999
  });
  assert.equal(fallbackSelection.id, "expedited");
});
