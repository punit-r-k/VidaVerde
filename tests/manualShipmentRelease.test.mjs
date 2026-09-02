import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const shipmentRoute = read("app/api/admin/shipments/route.js");
const labelRoute = read("app/api/admin/shipments/[id]/labels/route.js");
const quoteRoute = read("app/api/admin/shipments/[id]/label-quote/route.js");
const labelRelease = read("lib/shipmentLabelAutomation.js");
const shippingQuotes = read("lib/shippingQuotes.js");
const emailQueue = read("lib/emailJobQueue.js");
const trackingEmail = read("lib/shipmentTrackingEmail.js");
const preorderReady = read("lib/preorderReadyEmail.js");
const finalizeRoute = read("app/api/order/finalize/route.js");
const stripeWebhook = read("app/api/stripe/webhook/route.js");
const appsScript = read("apps-script/inventory-sync.gs");
const migration = read(
  "supabase/migrations/20260901120000_manual_shipment_release_tracking_email.sql"
);

const {
  getShipmentReleaseBlockReason,
  summarizeShipmentReleaseQuote
} = await import("../lib/shipmentReleasePolicy.js");

test("only explicit release APIs can rate or purchase post-payment postage", () => {
  for (const source of [shipmentRoute, finalizeRoute, stripeWebhook, preorderReady]) {
    assert.doesNotMatch(
      source,
      /buyEasyPostShipment|purchaseReleasedShippingLabels|getEasyPostQuotesForParcels/u
    );
  }
  assert.match(quoteRoute, /createShippingLabelReleaseQuote/u);
  assert.match(labelRoute, /purchaseReleasedShippingLabels/u);
  assert.match(labelRoute, /quote_id/u);
});

test("release previews rate exactly the persisted parcel plan", () => {
  assert.match(labelRelease, /getReleaseParcelPlan/u);
  assert.match(labelRelease, /checkout_shipping_quotes/u);
  assert.match(labelRelease, /buildShippingPlans\(shipment\.items_json\)\[0\]/u);
  assert.match(labelRelease, /plan_key: `RELEASE__/u);
  assert.match(labelRelease, /QUOTE_LIFETIME_MS = 60 \* 60 \* 1000/u);
  assert.match(shippingQuotes, /getEasyPostQuotesForParcels/u);
  assert.match(shippingQuotes, /for \(const \[parcelIndex, parcel\] of selectedParcels\.entries\(\)\)/u);
});

test("confirmed purchases validate ownership, expiry, eligibility, and recovery identity", () => {
  assert.match(labelRelease, /\.eq\("id", quoteId\)[\s\S]*\.eq\("shipment_id", shipment\.id\)/u);
  assert.match(labelRelease, /startsWith\("RELEASE__"\)/u);
  assert.match(labelRelease, /The release quote expired/u);
  assert.match(labelRelease, /hasOutstandingPreorders/u);
  assert.match(labelRelease, /active_release_quote_id/u);
  assert.match(labelRelease, /getEasyPostShipment\(parcel\.easyPostShipmentId/u);
  assert.match(labelRelease, /A partial label purchase must be resumed with its original release quote/u);
});

test("release policy blocks unsafe orders and exposes complete preview totals", () => {
  const shipment = { id: "shipment-1", status: "pending_label" };
  const paidOrder = { status: "paid", fulfillment: "ship", amount_shipping: 2400 };
  assert.equal(getShipmentReleaseBlockReason({ shipment, order: paidOrder }), "");
  assert.match(
    getShipmentReleaseBlockReason({
      shipment,
      order: { ...paidOrder, status: "disputed" }
    }),
    /disputed/u
  );
  assert.match(
    getShipmentReleaseBlockReason({
      shipment,
      order: paidOrder,
      hasOutstandingPreorders: true
    }),
    /preorder items/u
  );
  assert.match(
    getShipmentReleaseBlockReason({
      shipment,
      order: { ...paidOrder, is_test_order: true }
    }),
    /Financial test/u
  );
  assert.match(
    getShipmentReleaseBlockReason({
      shipment: {
        ...shipment,
        status: "purchasing_label",
        label_purchase_started_at: "2026-09-01T11:55:00.000Z"
      },
      order: paidOrder,
      now: new Date("2026-09-01T12:00:00.000Z")
    }),
    /already in progress/u
  );
  assert.equal(
    getShipmentReleaseBlockReason({
      shipment: {
        ...shipment,
        status: "purchasing_label",
        label_purchase_started_at: "2026-09-01T11:30:00.000Z"
      },
      order: paidOrder,
      now: new Date("2026-09-01T12:00:00.000Z")
    }),
    ""
  );

  assert.deepEqual(
    summarizeShipmentReleaseQuote({
      shipment,
      order: paidOrder,
      quote: {
        id: "quote-1",
        expires_at: "2026-09-01T12:00:00.000Z",
        postage_cents: 1866,
        box_cost_cents: 200,
        currency: "usd",
        quote_json: { parcels: [{}, {}] }
      }
    }),
    {
      shipment_id: "shipment-1",
      quote_id: "quote-1",
      expires_at: "2026-09-01T12:00:00.000Z",
      parcel_count: 2,
      postage_cents: 1866,
      packaging_cents: 200,
      customer_shipping_charge_cents: 2400,
      currency: "USD"
    }
  );
});

test("the Sheet previews every selected row before one confirmation and any purchase", () => {
  const start = appsScript.indexOf("function releaseSelectedShipments()");
  const end = appsScript.indexOf("function formatMoneyFromCents_", start);
  const source = appsScript.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(source, /selectedRows\.length > 10/u);
  assert.match(source, /new Set\(ranges\.flatMap/u);
  const previewIndex = source.indexOf("/label-quote");
  const confirmationIndex = source.indexOf('ui.alert("Confirm shipment release"');
  const purchaseIndex = source.indexOf("/labels");
  assert.ok(previewIndex >= 0 && confirmationIndex > previewIndex && purchaseIndex > confirmationIndex);
  assert.match(source, /if \(previewErrors\.length > 0\)[\s\S]*Nothing was purchased/u);
  assert.match(source, /ui\.ButtonSet\.YES_NO/u);
  assert.match(source, /const successes = \[\];[\s\S]*const failures = \[\];/u);
});

test("customer-facing tracking delivery is disabled while label tracking remains internal", () => {
  assert.match(migration, /email_jobs_shipment_tracking_uidx/u);
  assert.match(emailQueue, /const SUPPORTED_JOB_TYPES = \[ORDER_CONFIRMATION_JOB_TYPE\]/u);
  assert.match(emailQueue, /Shipment tracking emails are disabled/u);
  assert.doesNotMatch(labelRoute, /enqueueShipmentTrackingEmail|processShipmentTrackingEmailJob/u);
  assert.match(labelRoute, /tracking_email: \{ state: "disabled" \}/u);
  assert.match(labelRelease, /tracking_number: bought\.tracking_code/u);
  assert.match(trackingEmail, /getPreferredTrackingNumbers/u);
});
