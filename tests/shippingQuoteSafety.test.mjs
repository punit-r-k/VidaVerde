import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  assertShippingChargeCoversCosts,
  createShippingQuoteFingerprint,
  getEasyPostBudgetConfig,
  getShippingQuoteSelectionUpdate,
  getStoredShippingSelection,
  serializeCachedShippingSelections
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
const atomicBudgetMigration = read(
  "supabase/migrations/20260902120000_atomic_easypost_quote_budgets.sql"
);
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

test("production cost configuration requires explicit non-negative integers", () => {
  const valid = {
    NODE_ENV: "production",
    EASYPOST_DAILY_RATING_LIMIT: "10",
    EASYPOST_DAILY_ADDRESS_VERIFICATION_LIMIT: "8",
    EASYPOST_MONTHLY_OVERAGE_LIMIT_CENTS: "500",
    EASYPOST_RATING_OVERAGE_UNIT_CENTS: "2",
    EASYPOST_ADDRESS_VERIFICATION_OVERAGE_UNIT_CENTS: "3"
  };
  assert.deepEqual(getEasyPostBudgetConfig(valid), {
    dailyRatingLimit: 10,
    dailyAddressVerificationLimit: 8,
    monthlyOverageLimitCents: 500,
    ratingOverageUnitCents: 2,
    addressVerificationOverageUnitCents: 3
  });
  for (const invalid of ["", "-1", "1.5", "one"]) {
    assert.throws(
      () => getEasyPostBudgetConfig({
        ...valid,
        EASYPOST_RATING_OVERAGE_UNIT_CENTS: invalid
      }),
      /EASYPOST_RATING_OVERAGE_UNIT_CENTS must be configured as a non-negative integer/u
    );
  }
  assert.equal(getEasyPostBudgetConfig({ NODE_ENV: "test" }).ratingOverageUnitCents, 1);
});

test("one opaque token carries both options and narrows to the chosen provider IDs", () => {
  const selection = (id, amountCents, rateId) => ({
    option: { id, label: id === "normal" ? "Shipping" : "Expedited Shipping" },
    quote: {
      planKey: `plan__${id}`,
      parcels: [{
        selectedRate: { id: rateId, carrier: "UPS", service: id }
      }]
    },
    charge: { postageCents: amountCents - 200, packagingCents: 200, amountCents },
    deliveryDays: id === "normal" ? 4 : 2,
    estimatedShipDateKey: "2026-09-05",
    expectedArrivalDateKey: id === "normal" ? "2026-09-11" : "2026-09-09"
  });
  const normal = selection("normal", 1200, "rate_ground");
  const expedited = selection("expedited", 1700, "rate_air");
  const row = {
    id: "11111111-1111-4111-8111-111111111111",
    quote_json: { shippingOptions: [normal, expedited] }
  };

  const serialized = serializeCachedShippingSelections(row);
  assert.deepEqual(serialized.map((option) => option.quoteToken), [row.id, row.id]);
  assert.deepEqual(serialized.map((option) => option.id), ["normal", "expedited"]);
  const storedExpedited = getStoredShippingSelection(row, "expedited");
  const update = getShippingQuoteSelectionUpdate(storedExpedited);
  assert.equal(update.service_level, "expedited");
  assert.equal(update.quote_json.parcels[0].selectedRate.id, "rate_air");
  assert.equal(update.quote_json.shippingOptions, undefined);
});

test("deterministic planning creates exactly the parcels that can be rated", () => {
  assert.equal(buildShippingPlan([{ sku: "VV1", quantity: 1 }]).parcels.length, 1);
  assert.equal(buildShippingPlan([
    { sku: "VV1", quantity: 1 },
    { sku: "VV5", quantity: 1 }
  ]).parcels.length, 2);
  assert.match(quotes, /shipmentCreateLimit = parcels\.length/u);
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
  assert.match(storefront, /covers live postage and packaging and is rounded up to the next whole dollar/u);
});

test("checkout details and unexpired shipping calculations survive a page refresh", () => {
  assert.match(storefront, /window\.sessionStorage\.getItem\(CHECKOUT_DRAFT_STORAGE_KEY\)/u);
  assert.match(storefront, /window\.sessionStorage\.setItem\(/u);
  assert.match(storefront, /shippingPreview:\s*activePreview/u);
  assert.match(storefront, /shippingPreview\?\.requestFingerprint ===[\s\S]*shippingQuoteRequestFingerprint/u);
  assert.match(storefront, /getStoredShippingPreviewExpiration\(shippingPreview\)/u);
  assert.match(quoteRoute, /serializeStoredShippingSelection\(selection, saved\.id, saved\.expires_at\)/u);
});

test("shipping guidance points customers to required details and the accent calculation button", () => {
  assert.match(storefront, /Enter shipping details on the left/u);
  assert.match(storefront, /Press "Calculate Shipping" on the left/u);
  assert.match(storefront, /Enter shipping details above/u);
  assert.match(storefront, /: "_____";/u);
  assert.doesNotMatch(storefront, /Use Calculate shipping above/u);
  assert.match(storefront, /className="button button--accent"[\s\S]*onClick=\{calculateShipping\}/u);
  assert.match(read("app/globals.css"), /\.button--accent\s*\{[\s\S]*background: var\(--accent\);[\s\S]*color: var\(--ink\);/u);
});

test("service-tier filtering is local and never performs a provider request", () => {
  const filteringStart = quotes.indexOf("const buildQuotesFromRatedParcels");
  const filteringEnd = quotes.indexOf("const getCheckoutPlan", filteringStart);
  const filtering = quotes.slice(filteringStart, filteringEnd);

  assert.ok(filteringStart >= 0 && filteringEnd > filteringStart);
  assert.match(filtering, /filterRatesForTransitWindow\(parcel\.rates/u);
  assert.doesNotMatch(filtering, /createEasyPostShipment|getRatedEasyPostShipment/u);
  assert.match(
    read("lib/shippingRateRanking.js"),
    /only filters rates already returned by the existing rating/u
  );
});

test("database reservation serializes distinct fingerprints before checking every ceiling", () => {
  const cacheBranch = quoteRoute.indexOf('reservation.state === "cache_hit"');
  const providerCall = quoteRoute.indexOf("selectCheckoutShippingOptions({");
  assert.ok(cacheBranch > 0 && providerCall > cacheBranch);
  const globalLock = atomicBudgetMigration.indexOf("easypost-quote-budget-global-v1");
  const budgetRead = atomicBudgetMigration.indexOf("coalesce(sum(rated_shipments), 0)");
  assert.ok(globalLock > 0 && budgetRead > globalLock);
  assert.match(atomicBudgetMigration, /hashtextextended\(p_fingerprint, 0\)/u);
  assert.match(atomicBudgetMigration, /easypost-quote-session:/u);
  assert.match(atomicBudgetMigration, /v_session_misses >= 2/u);
  assert.match(atomicBudgetMigration, /v_daily_ratings \+ p_parcel_count > p_daily_rating_limit/u);
  assert.match(atomicBudgetMigration, /v_daily_verifications \+ 1 > p_daily_verification_limit/u);
  assert.match(
    atomicBudgetMigration,
    /v_monthly_overage \+ p_estimated_overage_cost_cents > p_monthly_overage_limit_cents/u
  );
  assert.match(quoteRoute, /Shipping usage could not be recorded|SAFE_UNAVAILABLE_MESSAGE/u);
});

test("one strict delivery verification is reused by every rated parcel", () => {
  assert.match(quotes, /createAndVerifyEasyPostAddress/u);
  assert.match(quotes, /verifiedAddressPromise/u);
  assert.match(quotes, /verifications\?\.delivery\?\.success === true/u);
  assert.match(quotes, /toAddress: \{ id: verifiedAddressId \}/u);
  assert.doesNotMatch(quotes, /verify: \["delivery"\]/u);
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
