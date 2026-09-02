import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertShippingChargeCoversCosts,
  createShippingQuoteFingerprint
} from "../lib/shippingQuoteCache.js";
import { buildShippingPlan } from "../lib/shippingParcels.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const storefront = read("app/components/Storefront.jsx");
const quoteRoute = read("app/api/shipping/quote/route.js");
const orderRoute = read("app/api/order/route.js");
const quotes = read("lib/shippingQuotes.js");
const labels = read("lib/shipmentLabelAutomation.js");
const ledgerMigration = read("supabase/migrations/20260901130000_easypost_quote_cache_budget.sql");
const nextConfig = read("next.config.js");
const allRuntimeSource = [
  ...fs.readdirSync(path.join(root, "lib")).filter((file) => file.endsWith(".js"))
    .map((file) => read(`lib/${file}`)),
  quoteRoute,
  orderRoute
].join("\n");

const customer = {
  address1: "123 Main Street",
  address2: "Apt 4",
  city: "Austin",
  state: "TX",
  postalCode: "78701",
  country: "US"
};
const items = [{ sku: "VV1", quantity: 1 }];
const plan = buildShippingPlan(items);
const fingerprint = (overrides = {}) => createShippingQuoteFingerprint({
  customer,
  items,
  parcelPlan: plan,
  plannedShipDate: "2026-09-05",
  serviceLevel: "normal",
  ...overrides
});

test("quote fingerprints are HMACs and address or cart changes invalidate them", () => {
  const original = fingerprint();
  assert.match(original, /^[a-f0-9]{64}$/u);
  assert.doesNotMatch(original, /Main|Austin|78701/u);
  assert.notEqual(fingerprint({ customer: { ...customer, postalCode: "78702" } }), original);
  assert.notEqual(fingerprint({ items: [{ sku: "VV1", quantity: 2 }] }), original);
  assert.notEqual(fingerprint({ serviceLevel: "expedited" }), original);
});

test("deterministic planning creates exactly the parcels that can be rated", () => {
  assert.equal(buildShippingPlan([{ sku: "VV1", quantity: 1 }]).parcels.length, 1);
  assert.equal(buildShippingPlan([
    { sku: "VV1", quantity: 1 },
    { sku: "VV5", quantity: 1 }
  ]).parcels.length, 2);
  assert.match(quotes, /shipmentCreateLimit = plan\.parcels\.length/u);
  assert.doesNotMatch(quotes, /MAX_EASYPOST_SHIPMENT_CREATES_PER_RATING\s*=\s*12/u);
});

test("the storefront only rates after an enabled explicit action and never retries automatically", () => {
  assert.match(storefront, /"Calculate shipping"/u);
  assert.match(storefront, /"Update shipping"/u);
  assert.match(storefront, /onClick=\{calculateShipping\}/u);
  assert.match(storefront, /!shippingPreviewReady[\s\S]*hasActiveShippingPreview[\s\S]*shippingPreviewStatus === "loading"/u);
  const calculateStart = storefront.indexOf("const calculateShipping");
  const calculateEnd = storefront.indexOf("const pickupAcknowledgementError", calculateStart);
  assert.ok(calculateStart > 0 && calculateEnd > calculateStart);
  assert.equal((storefront.slice(calculateStart, calculateEnd).match(/fetch\("\/api\/shipping\/quote"/gu) || []).length, 1);
  assert.doesNotMatch(storefront, /SHIPPING_QUOTE_DEBOUNCE_MS/u);
});

test("database reservation returns cache hits before provider calls and enforces ceilings", () => {
  const cacheBranch = quoteRoute.indexOf('reservation.state === "cache_hit"');
  const providerCall = quoteRoute.indexOf("selectCheckoutShippingQuote({");
  assert.ok(cacheBranch > 0 && providerCall > cacheBranch);
  assert.match(ledgerMigration, /pg_advisory_xact_lock/u);
  assert.match(ledgerMigration, /v_session_misses >= 2/u);
  assert.match(ledgerMigration, /p_daily_rating_limit/u);
  assert.match(ledgerMigration, /p_daily_verification_limit/u);
  assert.match(ledgerMigration, /p_monthly_overage_limit_cents/u);
  assert.match(quoteRoute, /Shipping usage could not be recorded|SAFE_UNAVAILABLE_MESSAGE/u);
});

test("one inline address verification is reused by every parcel", () => {
  assert.match(quotes, /verify: \["delivery"\]/u);
  assert.match(quotes, /context\.verifiedAddressId/u);
  assert.match(quotes, /toAddress: inlineToAddress/u);
  assert.doesNotMatch(quotes, /createAndVerifyEasyPostAddress/u);
});

test("checkout consumes the opaque quote token and performs no rating", () => {
  assert.match(orderRoute, /shippingQuoteToken/u);
  assert.match(orderRoute, /createShippingQuoteFingerprint/u);
  assert.match(orderRoute, /status: "attached"/u);
  assert.doesNotMatch(orderRoute, /selectCheckoutShippingQuote|createEasyPostRatingContext|getEasyPostQuotes/u);
  assert.match(orderRoute, /shipping_quote_expired/u);
});

test("label purchase reuses saved shipment and rate IDs without normal rerating", () => {
  assert.match(labels, /CHECKOUT__/u);
  assert.match(labels, /buyEasyPostShipment\([\s\S]*parcel\.easyPostShipmentId[\s\S]*parcel\.selectedRate\.id/u);
  assert.match(labels, /providerCalls: 0/u);
  assert.match(labels, /confirmed label cost exceeds customer shipping revenue/i);
});

test("shipping charges cannot be below postage plus packaging", () => {
  assert.deepEqual(assertShippingChargeCoversCosts({
    postageCents: 821,
    packagingCents: 250,
    customerShippingChargeCents: 1100
  }), {
    postageCents: 821,
    packagingCents: 250,
    customerShippingChargeCents: 1100,
    shippingMarginCents: 29
  });
  assert.throws(() => assertShippingChargeCoversCosts({
    postageCents: 821,
    packagingCents: 250,
    customerShippingChargeCents: 799
  }), /does not cover/u);
  assert.match(ledgerMigration, /checkout_shipping_quotes_cost_coverage/u);
  assert.match(ledgerMigration, /checkout_shipping_quotes_no_hidden_subsidy/u);
});

test("non-production environments reject production EasyPost keys", () => {
  assert.match(nextConfig, /staging and test environments cannot use an EasyPost production key/u);
  assert.match(nextConfig, /easyPostApiKey\.startsWith\("EZAK"\)/u);
});

test("standalone trackers and customer-facing advanced tracking remain disabled", () => {
  assert.doesNotMatch(allRuntimeSource, /createEasyPostTracker|\/trackers(?:\/|"|'|`)/u);
  assert.match(read("lib/emailJobQueue.js"), /SUPPORTED_JOB_TYPES = \[ORDER_CONFIRMATION_JOB_TYPE\]/u);
  assert.doesNotMatch(read("app/api/admin/shipments/[id]/labels/route.js"), /enqueueShipmentTrackingEmail/u);
  assert.match(labels, /tracking_number: bought\.tracking_code/u);
});
