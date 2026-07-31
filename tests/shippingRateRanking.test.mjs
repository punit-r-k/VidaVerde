import assert from "node:assert/strict";
import test from "node:test";
import {
  chooseFastestQuote,
  compareRatesBySpeed,
  getQuoteTransitDays,
  getRateTransitDays
} from "../lib/shippingRateRanking.js";

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
