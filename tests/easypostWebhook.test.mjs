import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import {
  createAndVerifyEasyPostAddress,
  easyPostRequest,
  getFromAddress,
  isUsdEasyPostRate,
  verifyEasyPostWebhook
} from "../lib/easypost.js";
import {
  getAggregateTrackingStatus,
  getMonotonicTrackingStatus,
  isShippingQuoteExpired,
  isShippingQuoteUsable,
  mapEasyPostTrackerStatus,
  processEasyPostTrackerEvent
} from "../lib/shippingOperationsPolicy.js";
import { getPreferredTrackingNumbers } from "../lib/trackingNumbers.js";

test("validates official EasyPost raw-body HMAC signatures", () => {
  const previous = process.env.EASYPOST_WEBHOOK_SECRET;
  process.env.EASYPOST_WEBHOOK_SECRET = "unit-tést-secret";

  try {
    const body = '{"description":"tracker.updated","result":{"weight":136.0,"note":"jalapeño"}}';
    const digest = crypto
      .createHmac(
        "sha256",
        process.env.EASYPOST_WEBHOOK_SECRET.normalize("NFKD")
      )
      .update(Buffer.from(body, "utf8"))
      .digest("hex");
    const signature = `hmac-sha256-hex=${digest}`;

    assert.equal(verifyEasyPostWebhook(body, { signature }), true);
    assert.equal(verifyEasyPostWebhook(`${body} `, { signature }), false);
    assert.equal(
      verifyEasyPostWebhook(JSON.stringify(JSON.parse(body)), { signature }),
      false
    );
    assert.equal(verifyEasyPostWebhook(body, { signature: digest }), false);
    assert.equal(
      verifyEasyPostWebhook(body, { signature: `hmac-sha256-hex=${"é".repeat(64)}` }),
      false
    );
  } finally {
    if (previous === undefined) delete process.env.EASYPOST_WEBHOOK_SECRET;
    else process.env.EASYPOST_WEBHOOK_SECRET = previous;
  }
});

test("parcel tracking numbers take precedence over aggregate fallback values", () => {
  assert.deepEqual(
    getPreferredTrackingNumbers({
      parcels: [
        { parcel_index: 2, tracking_number: "TRACK-B" },
        { parcel_index: 1, tracking_number: "TRACK-A" },
        { parcel_index: 3, tracking_number: "TRACK-A" }
      ],
      aggregateTrackingNumber: "TRACK-A, TRACK-B"
    }),
    ["TRACK-A", "TRACK-B"]
  );

  assert.deepEqual(
    getPreferredTrackingNumbers({
      aggregateTrackingNumber: "TRACK-A, TRACK-B, TRACK-A"
    }),
    ["TRACK-A", "TRACK-B"]
  );
});

test("EasyPost HTTP requests disable caching and abort at their deadline", async (context) => {
  const previousApiKey = process.env.EASYPOST_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.EASYPOST_API_KEY = "test-api-key";
  context.after(() => {
    if (previousApiKey === undefined) delete process.env.EASYPOST_API_KEY;
    else process.env.EASYPOST_API_KEY = previousApiKey;
    globalThis.fetch = previousFetch;
  });

  let requestOptions;
  globalThis.fetch = async (_url, options) => {
    requestOptions = options;
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "shp_test" })
    };
  };
  assert.deepEqual(
    await easyPostRequest("/shipments/shp_test", { timeoutMs: 100 }),
    { id: "shp_test" }
  );
  assert.equal(requestOptions.cache, "no-store");
  assert.ok(requestOptions.signal instanceof AbortSignal);

  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  });
  await assert.rejects(
    easyPostRequest("/shipments/shp_slow", { timeoutMs: 10 }),
    /timed out after 10ms/i
  );
});

test("only explicit USD EasyPost rates are eligible", () => {
  assert.equal(isUsdEasyPostRate({ currency: "USD" }), true);
  assert.equal(isUsdEasyPostRate({ currency: " usd " }), true);
  assert.equal(isUsdEasyPostRate({ currency: "EUR" }), false);
  assert.equal(isUsdEasyPostRate({}), false);
});

test("return-address configuration fails closed instead of using a hidden address", () => {
  const keys = [
    "EASYPOST_FROM_STREET1",
    "EASYPOST_FROM_CITY",
    "EASYPOST_FROM_STATE",
    "EASYPOST_FROM_ZIP",
    "EASYPOST_FROM_PHONE",
    "EASYPOST_FROM_EMAIL"
  ];
  const previous = new Map(keys.map((key) => [key, process.env[key]]));

  try {
    keys.forEach((key) => delete process.env[key]);
    assert.throws(() => getFromAddress(), /return address is incomplete/i);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("destination addresses are strictly verified before rating", async (context) => {
  const previousApiKey = process.env.EASYPOST_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.EASYPOST_API_KEY = "test-api-key";
  context.after(() => {
    if (previousApiKey === undefined) delete process.env.EASYPOST_API_KEY;
    else process.env.EASYPOST_API_KEY = previousApiKey;
    globalThis.fetch = previousFetch;
  });

  let requestedUrl = "";
  let requestedBody = null;
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedBody = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      json: async () => ({ id: "adr_verified", street1: "10 Main St" })
    };
  };

  const verified = await createAndVerifyEasyPostAddress({ street1: "10 Main Street" });
  assert.equal(verified.id, "adr_verified");
  assert.match(requestedUrl, /\/addresses\/create_and_verify$/);
  assert.deepEqual(requestedBody, {
    address: { street1: "10 Main Street" }
  });
});

test("expired quotes require evidence of an already purchased parcel", () => {
  const now = Date.parse("2026-07-31T12:00:00.000Z");
  const fresh = { expires_at: "2026-07-31T12:00:01.000Z" };
  const expired = { expires_at: "2026-07-31T11:59:59.000Z" };

  assert.equal(isShippingQuoteExpired(fresh, now), false);
  assert.equal(isShippingQuoteExpired(expired, now), true);
  assert.equal(isShippingQuoteExpired({}, now), true);
  assert.equal(isShippingQuoteUsable(expired, { now }), false);
  assert.equal(
    isShippingQuoteUsable(expired, { hasPurchasedParcels: true, now }),
    true
  );
});

test("tracking status mapping is explicit and monotonic", () => {
  assert.equal(mapEasyPostTrackerStatus("pre_transit"), "label_purchased");
  assert.equal(mapEasyPostTrackerStatus("in_transit"), "shipped");
  assert.equal(mapEasyPostTrackerStatus("out_for_delivery"), "shipped");
  assert.equal(mapEasyPostTrackerStatus("delivered"), "delivered");
  assert.equal(mapEasyPostTrackerStatus("failure"), null);
  assert.equal(mapEasyPostTrackerStatus("brand_new_status"), null);

  assert.equal(getMonotonicTrackingStatus("label_purchased", "shipped"), "shipped");
  assert.equal(getMonotonicTrackingStatus("shipped", "label_purchased"), "shipped");
  assert.equal(getMonotonicTrackingStatus("delivered", "shipped"), "delivered");
  assert.equal(getMonotonicTrackingStatus("cancelled", "delivered"), "cancelled");
  assert.equal(
    getMonotonicTrackingStatus("label_purchased", "delivered"),
    "delivered"
  );

  assert.equal(getAggregateTrackingStatus(["label_purchased", "shipped"]), "shipped");
  assert.equal(getAggregateTrackingStatus(["delivered", "delivered"]), "delivered");
  assert.equal(getAggregateTrackingStatus(["cancelled"]), null);
});

test("tracker processing advances once, preserves timestamps, and never regresses", async () => {
  const parcel = {
    id: "parcel-1",
    shipment_id: "shipment-1",
    status: "label_purchased",
    carrier: "USPS"
  };
  const shipment = {
    id: "shipment-1",
    status: "label_purchased",
    shipped_at: null
  };
  const operations = {
    findParcels: async () => [parcel],
    updateParcelStatus: async (record, status) => {
      record.status = status;
    },
    getParcelStatuses: async () => [parcel.status],
    getShipment: async () => shipment,
    updateShipmentStatus: async (record, status, { shippedAt }) => {
      record.status = status;
      if (shippedAt) record.shipped_at = shippedAt;
    }
  };

  const shippedAt = new Date("2026-07-31T12:00:00.000Z");
  const shipped = await processEasyPostTrackerEvent({
    description: "tracker.updated",
    result: { tracking_code: "TRACK-1", carrier: "USPS", status: "in_transit" }
  }, operations, { now: shippedAt });
  assert.deepEqual(shipped, {
    state: "processed",
    matchedParcels: 1,
    updatedParcels: 1,
    updatedShipments: 1
  });
  assert.equal(parcel.status, "shipped");
  assert.equal(shipment.status, "shipped");
  assert.equal(shipment.shipped_at, shippedAt.toISOString());

  const delivered = await processEasyPostTrackerEvent({
    description: "tracker.updated",
    result: { tracking_code: "TRACK-1", carrier: "USPS", status: "delivered" }
  }, operations, { now: new Date("2026-08-01T12:00:00.000Z") });
  assert.equal(delivered.updatedParcels, 1);
  assert.equal(delivered.updatedShipments, 1);
  assert.equal(parcel.status, "delivered");
  assert.equal(shipment.status, "delivered");
  assert.equal(shipment.shipped_at, shippedAt.toISOString());

  const replayed = await processEasyPostTrackerEvent({
    description: "tracker.updated",
    result: { tracking_code: "TRACK-1", carrier: "USPS", status: "pre_transit" }
  }, operations, { now: new Date("2026-08-02T12:00:00.000Z") });
  assert.equal(replayed.updatedParcels, 0);
  assert.equal(replayed.updatedShipments, 0);
  assert.equal(parcel.status, "delivered");
  assert.equal(shipment.status, "delivered");
  assert.equal(shipment.shipped_at, shippedAt.toISOString());
});

test("unknown tracking states are ignored and database failures propagate", async () => {
  let lookupCount = 0;
  const ignored = await processEasyPostTrackerEvent({
    description: "tracker.updated",
    result: { tracking_code: "TRACK-2", status: "return_to_sender" }
  }, {
    findParcels: async () => {
      lookupCount += 1;
      return [];
    }
  });
  assert.equal(ignored.state, "ignored");
  assert.equal(lookupCount, 0);

  await assert.rejects(
    processEasyPostTrackerEvent({
      description: "tracker.updated",
      result: { tracking_code: "TRACK-3", status: "in_transit" }
    }, {
      findParcels: async () => {
        throw new Error("database unavailable");
      }
    }),
    /database unavailable/i
  );
});
