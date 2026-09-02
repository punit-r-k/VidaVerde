import assert from "node:assert/strict";
import test from "node:test";

import { createAndVerifyEasyPostAddress } from "../lib/easypost.js";
import {
  createEasyPostRatingContext,
  getEasyPostQuotes,
  getEasyPostQuotesForServiceLevels
} from "../lib/shippingQuotes.js";
import { getOrCreateCompatibleReleaseQuote } from "../lib/shipmentReleaseQuoteReuse.js";

const shipment = (items = [{ sku: "VV1", quantity: 1 }]) => ({
  customer_name: "Test Customer",
  address1: "123 Main Street",
  city: "Austin",
  state: "TX",
  postal_code: "78701",
  country: "US",
  items_json: items
});

const serviceLevels = [
  { serviceLevel: "normal", transitWindow: { minimumDays: 3, maximumDays: 5 } },
  { serviceLevel: "expedited", transitWindow: { minimumDays: 1, maximumDays: 3 } }
];

test("one verified address and one rating per physical parcel produce both service levels", async () => {
  let verificationCalls = 0;
  const ratingCalls = [];
  const context = createEasyPostRatingContext({
    startedAt: new Date("2026-09-02T12:00:00-05:00"),
    verifyAddress: async () => {
      verificationCalls += 1;
      return {
        id: "adr_verified",
        verifications: { delivery: { success: true, errors: [] } }
      };
    },
    createShipment: async (request) => {
      const index = ratingCalls.length + 1;
      ratingCalls.push(request);
      return {
        id: `shp_${index}`,
        rates: [
          {
            id: `rate_ground_${index}`,
            carrier: "UPS",
            service: "Ground",
            rate: "10.00",
            currency: "USD",
            delivery_days: 4
          },
          {
            id: `rate_air_${index}`,
            carrier: "UPS",
            service: "2ndDayAir",
            rate: "15.00",
            currency: "USD",
            delivery_days: 2
          }
        ]
      };
    }
  });

  const result = await getEasyPostQuotesForServiceLevels(
    shipment([{ sku: "VV1", quantity: 1 }, { sku: "VV5", quantity: 1 }]),
    { serviceLevels, ratingContext: context }
  );

  assert.equal(verificationCalls, 1);
  assert.equal(ratingCalls.length, 2);
  assert.ok(ratingCalls.every((call) => call.toAddress.id === "adr_verified"));
  assert.deepEqual(Object.keys(result), ["normal", "expedited"]);
  assert.equal(result.normal[0].parcels.length, 2);
  assert.equal(result.expedited[0].parcels.length, 2);
  assert.deepEqual(
    result.normal[0].parcels.map((parcel) => parcel.easyPostShipmentId),
    result.expedited[0].parcels.map((parcel) => parcel.easyPostShipmentId)
  );
  assert.notEqual(
    result.normal[0].parcels[0].selectedRate.id,
    result.expedited[0].parcels[0].selectedRate.id
  );
});

for (const [name, verifiedAddress] of [
  ["failed delivery verification with an Address ID", {
    id: "adr_failed",
    verifications: { delivery: { success: false, errors: [{ code: "E.ADDRESS.NOT_FOUND" }] } }
  }],
  ["missing delivery verification metadata", { id: "adr_missing", verifications: {} }]
]) {
  test(`rating rejects ${name}`, async () => {
    let ratingCalls = 0;
    const context = createEasyPostRatingContext({
      verifyAddress: async () => verifiedAddress,
      createShipment: async () => {
        ratingCalls += 1;
        return { id: "shp_should_not_exist", rates: [] };
      }
    });
    await assert.rejects(
      getEasyPostQuotes(shipment(), {
        serviceLevel: "normal",
        transitWindow: { minimumDays: 3, maximumDays: 5 },
        ratingContext: context
      }),
      /could not be verified/u
    );
    assert.equal(ratingCalls, 0);
  });
}

test("strict EasyPost address creation uses the supported request shape", async () => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.EASYPOST_API_KEY;
  let request;
  process.env.EASYPOST_API_KEY = "EZTK_behavior_test_key";
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return {
      ok: true,
      json: async () => ({
        id: "adr_verified",
        verifications: { delivery: { success: true, errors: [] } }
      })
    };
  };
  try {
    const verified = await createAndVerifyEasyPostAddress({ street1: "123 Main Street" });
    assert.equal(verified.id, "adr_verified");
    assert.match(request.url, /\/v2\/addresses$/u);
    assert.deepEqual(JSON.parse(request.options.body), {
      address: { street1: "123 Main Street" },
      verify_strict: true
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.EASYPOST_API_KEY;
    else process.env.EASYPOST_API_KEY = previousKey;
  }
});

const releaseFixture = ({ id = "quote-1", expiresAt = "2026-09-02T14:00:00.000Z" } = {}) => ({
  id,
  shipment_id: "shipment-1",
  plan_key: "RELEASE__plan__normal__ups",
  expires_at: expiresAt,
  quote_json: {
    releaseShippingOption: "normal",
    releaseShippingTier: "live_rate",
    parcels: [{
      family: "sauerkraut",
      packageCode: "box-1",
      supplier: "supplier",
      quantity: 1,
      skus: ["VV1"],
      length: 10,
      width: 8,
      height: 6,
      weightOz: 24,
      boxCostCents: 200,
      selectedRate: { carrier: "UPS" }
    }]
  }
});

test("repeated compatible admin previews rate only the first time", async () => {
  const shipmentRecord = {
    id: "shipment-1",
    shipping_option: "normal",
    shipping_tier: "live_rate"
  };
  const parcelPlan = { parcels: releaseFixture().quote_json.parcels };
  const candidates = [];
  let ratingOperations = 0;
  const preview = () => getOrCreateCompatibleReleaseQuote({
    shipment: shipmentRecord,
    parcelPlan,
    loadCandidates: async () => candidates,
    hasPurchases: async () => false,
    createQuote: async () => {
      ratingOperations += 1;
      const quote = releaseFixture();
      candidates.push(quote);
      return quote;
    },
    now: Date.parse("2026-09-02T13:00:00.000Z")
  });

  assert.equal((await preview()).reused, false);
  assert.equal((await preview()).reused, true);
  assert.equal(ratingOperations, 1);
});

test("expired, mismatched, partially purchased, and different-shipment previews are not reused", async () => {
  const shipmentRecord = {
    id: "shipment-1",
    shipping_option: "normal",
    shipping_tier: "live_rate"
  };
  const parcelPlan = { parcels: releaseFixture().quote_json.parcels };
  const cases = [
    releaseFixture({ expiresAt: "2026-09-02T12:00:00.000Z" }),
    { ...releaseFixture(), shipment_id: "shipment-2" },
    {
      ...releaseFixture(),
      quote_json: { ...releaseFixture().quote_json, releaseShippingOption: "expedited" }
    },
    {
      ...releaseFixture(),
      quote_json: { ...releaseFixture().quote_json, parcels: [
        { ...releaseFixture().quote_json.parcels[0], weightOz: 30 }
      ] }
    }
  ];
  for (const candidate of cases) {
    let creates = 0;
    const result = await getOrCreateCompatibleReleaseQuote({
      shipment: shipmentRecord,
      parcelPlan,
      loadCandidates: async () => [candidate],
      hasPurchases: async () => candidate.id === "partial",
      createQuote: async () => {
        creates += 1;
        return releaseFixture({ id: "replacement" });
      },
      now: Date.parse("2026-09-02T13:00:00.000Z")
    });
    assert.equal(result.reused, false);
    assert.equal(creates, 1);
  }

  let creates = 0;
  const partial = releaseFixture({ id: "partial" });
  const partialResult = await getOrCreateCompatibleReleaseQuote({
    shipment: shipmentRecord,
    parcelPlan,
    loadCandidates: async () => [partial],
    hasPurchases: async () => true,
    createQuote: async () => {
      creates += 1;
      return releaseFixture({ id: "replacement" });
    },
    now: Date.parse("2026-09-02T13:00:00.000Z")
  });
  assert.equal(partialResult.reused, false);
  assert.equal(creates, 1);
});
