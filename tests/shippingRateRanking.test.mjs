import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseFastestQuote,
  compareRatesBySpeed,
  filterRatesForTransitWindow,
  getSameCarrierRateSets,
  getQuoteLatestDeliveryDate,
  getQuoteTransitDays,
  getRateTransitDays,
  isRateWithinTransitWindow
} from "../lib/shippingRateRanking.js";

test("multi-parcel rate sets use one carrier for every parcel", () => {
  const rateSets = getSameCarrierRateSets([
    [
      { id: "ups_fast", carrier: "UPS", deliveryDays: 1, amountCents: 2000 },
      { id: "usps_first", carrier: "USPS", deliveryDays: 3, amountCents: 800 }
    ],
    [
      { id: "fedex_fast", carrier: "FedEx", deliveryDays: 1, amountCents: 1800 },
      { id: "usps_second", carrier: "USPS", deliveryDays: 4, amountCents: 900 }
    ]
  ]);

  assert.equal(rateSets.length, 1);
  assert.deepEqual(rateSets[0].map((rate) => rate.carrier), ["USPS", "USPS"]);
});

test("multi-parcel rate sets reject plans without a common carrier", () => {
  assert.deepEqual(getSameCarrierRateSets([
    [{ carrier: "UPS", deliveryDays: 1, amountCents: 1000 }],
    [{ carrier: "USPS", deliveryDays: 2, amountCents: 900 }]
  ]), []);
});

test("fastest carrier wins regardless of carrier or postage price", () => {
  const rates = [
    { id: "rate_slow", carrier: "USPS", service: "Ground", deliveryDays: 4, amountCents: 500 },
    { id: "rate_fast", carrier: "UPS", service: "Next Day", deliveryDays: 1, amountCents: 5000 },
    { id: "rate_middle", carrier: "FedEx", service: "Two Day", deliveryDays: 2, amountCents: 1200 }
  ];

  assert.equal([...rates].sort(compareRatesBySpeed)[0].id, "rate_fast");
});

test("estimated delivery days are used when delivery_days is unavailable", () => {
  assert.equal(getRateTransitDays({ delivery_days: null, est_delivery_days: 2 }), 2);
  assert.equal(getRateTransitDays({ delivery_days: "", est_delivery_days: "" }), null);
});

test("multi-parcel quotes are ranked by the slowest parcel", () => {
  const oneDayOrder = {
    planKey: "mixed-carriers",
    postageCents: 7000,
    parcels: [
      { selectedRate: { carrier: "UPS", deliveryDays: 1 } },
      { selectedRate: { carrier: "FedEx", deliveryDays: 1 } }
    ]
  };
  const twoDayOrder = {
    planKey: "single-carrier",
    postageCents: 500,
    parcels: [
      { selectedRate: { carrier: "USPS", deliveryDays: 2 } }
    ]
  };

  assert.equal(getQuoteTransitDays(oneDayOrder), 1);
  assert.equal(chooseFastestQuote([twoDayOrder, oneDayOrder]).planKey, "mixed-carriers");
});

test("postage price only breaks equal-speed ties", () => {
  const expensive = {
    planKey: "expensive",
    postageCents: 2000,
    parcels: [{ selectedRate: { deliveryDays: 1 } }]
  };
  const affordable = {
    planKey: "affordable",
    postageCents: 1000,
    parcels: [{ selectedRate: { deliveryDays: 1 } }]
  };

  assert.equal(chooseFastestQuote([expensive, affordable]).planKey, "affordable");
});

test("normal shipping excludes rates faster than three or slower than five days", () => {
  const window = { minimumDays: 3, maximumDays: 5 };
  assert.equal(isRateWithinTransitWindow({ deliveryDays: 2 }, window), false);
  assert.equal(isRateWithinTransitWindow({ deliveryDays: 3 }, window), true);
  assert.equal(isRateWithinTransitWindow({ deliveryDays: 5 }, window), true);
  assert.equal(isRateWithinTransitWindow({ deliveryDays: 6 }, window), false);
});

test("a faster carrier estimate is used only when the preferred window is unavailable", () => {
  const window = { minimumDays: 3, maximumDays: 5 };
  const faster = { id: "local-ground", deliveryDays: 1, amountCents: 700 };
  const preferred = { id: "ground", deliveryDays: 4, amountCents: 900 };
  const slow = { id: "slow", deliveryDays: 6, amountCents: 500 };

  assert.deepEqual(
    filterRatesForTransitWindow([faster, preferred, slow], window),
    [preferred]
  );
  assert.deepEqual(
    filterRatesForTransitWindow([faster, slow], window),
    [faster]
  );
});

test("rates with unknown or overly slow delivery estimates are not fallbacks", () => {
  const window = { minimumDays: 3, maximumDays: 5 };

  assert.deepEqual(filterRatesForTransitWindow([
    { id: "unknown", deliveryDays: null, amountCents: 500 },
    { id: "slow", deliveryDays: 6, amountCents: 600 }
  ], window), []);
});

test("expedited shipping accepts one-to-three-day rates and rejects unknown estimates", () => {
  const window = { minimumDays: 1, maximumDays: 3 };
  assert.equal(isRateWithinTransitWindow({ deliveryDays: 1 }, window), true);
  assert.equal(isRateWithinTransitWindow({ deliveryDays: 3 }, window), true);
  assert.equal(isRateWithinTransitWindow({ deliveryDays: 4 }, window), false);
  assert.equal(isRateWithinTransitWindow({ deliveryDays: null }, window), false);
});

test("multi-parcel arrival uses EasyPost's latest parcel delivery date", () => {
  const arrival = getQuoteLatestDeliveryDate({
    parcels: [
      { selectedRate: { deliveryDate: "2026-08-05" } },
      { selectedRate: { deliveryDate: "2026-08-07" } }
    ]
  });
  assert.equal(arrival?.toISOString().slice(0, 10), "2026-08-07");
  assert.equal(
    getQuoteLatestDeliveryDate({ parcels: [{ selectedRate: { deliveryDate: null } }] }),
    null
  );
});
