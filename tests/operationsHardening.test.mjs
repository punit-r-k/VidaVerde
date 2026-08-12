import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (relativePath) =>
  fs.readFileSync(new URL(`../${relativePath}`, import.meta.url), "utf8");

const appsScript = read("apps-script/inventory-sync.gs");
const checkoutRoute = read("app/api/order/route.js");
const emailJobsRoute = read("app/api/admin/email-jobs/route.js");
const healthRoute = read("app/api/admin/health/route.js");
const trackerRoute = read("app/api/webhooks/easypost/route.js");
const labelAutomation = read("lib/shipmentLabelAutomation.js");
const emailQueue = read("lib/emailJobQueue.js");
const storefront = read("app/components/Storefront.jsx");
const repoSecurityChecks = read("scripts/repo-security-checks.mjs");
const paymentPanel = read("app/components/StripePaymentPanel.jsx");
const shippingQuoteRoute = read("app/api/shipping/quote/route.js");
const shippingQuotes = read("lib/shippingQuotes.js");
const shippingParcels = read("lib/shippingParcels.js");
const emailTransport = read("lib/email.js");
const adminAuth = read("lib/adminAuth.js");
const nextConfig = read("next.config.js");

test("Apps Script neutralizes spreadsheet formulas in every dynamic row set", () => {
  assert.match(appsScript, /function sanitizeSheetText_\(value\)/u);
  assert.match(appsScript, /\/\^\[=\+\\-@\]\//u);
  assert.ok(appsScript.includes("? `'\${text}` : text;"));
  assert.doesNotMatch(
    appsScript,
    /\.setValues\((?:rows|pickupRows|activeRows|suppressedRows)\)/u
  );
  assert.ok(
    (appsScript.match(/\.setValues\(sanitizeSheetRows_\(/gu) || []).length >= 8
  );
});

test("shipment sheet starts with the producer's requested fulfillment columns", () => {
  assert.match(
    appsScript,
    /const headerValues = \[\[\s*"Order Date \/ Time",\s*"Name",\s*"Address",\s*"Order",\s*"Prepaid Shipping Label"/u
  );
  assert.match(
    appsScript,
    /return \[\s*createdAt,\s*String\(shipment\?\.customer_name \|\| ""\),\s*formatShipmentAddress_\(shipment\),\s*formatShipmentItems_\(shipment\),\s*formatShipmentLabelText_\(shipment\)/u
  );
  assert.match(
    appsScript,
    /getRange\(CONFIG\.SHIPMENTS\.START_ROW, 1, rows\.length, 1\)\s*\.setNumberFormat\("yyyy-mm-dd hh:mm"\)/u
  );
  assert.match(
    appsScript,
    /getRange\(CONFIG\.SHIPMENTS\.START_ROW, 5, rows\.length, 1\)\s*\.setRichTextValues/u
  );
});

test("test shipment rows are clearly marked as ineligible for labels", () => {
  assert.match(appsScript, /Not applicable — test order/u);
  assert.match(appsScript, /No label — cancelled/u);
});

test("test labels are enabled only by an EasyPost test key", () => {
  assert.match(labelAutomation, /is_test_order === true && !isEasyPostTestMode\(\)/u);
  assert.match(shippingQuoteRoute, /Shipping rates are temporarily unavailable/u);
  assert.match(nextConfig, /EasyPost test API key cannot be deployed to production/u);
});

test("admin JWT authentication requires fresh integer claims and a strong secret", () => {
  assert.match(adminAuth, /Buffer\.byteLength\(config\.secret, "utf8"\) < 32/u);
  assert.match(adminAuth, /Number\.isSafeInteger\(issuedAt\)/u);
  assert.match(adminAuth, /Number\.isSafeInteger\(notBefore\)/u);
  assert.doesNotMatch(adminAuth, /ADMIN_RESTOCK_SECRET/u);
  assert.match(nextConfig, /ADMIN_JWT_SECRET must contain at least 32/u);
  assert.doesNotMatch(appsScript, /ADMIN_RESTOCK_SECRET/u);
});

test("payment SDK promise failures always unlock the submit button", () => {
  const submitHandler = paymentPanel.slice(
    paymentPanel.indexOf("const handleStripeSubmit"),
    paymentPanel.indexOf("return (", paymentPanel.indexOf("const handleStripeSubmit"))
  );
  const tryIndex = submitHandler.indexOf("try {");
  const elementsIndex = submitHandler.indexOf("await elements.submit()");
  const confirmIndex = submitHandler.indexOf("await stripe.confirmPayment");
  const catchIndex = submitHandler.lastIndexOf("catch (error)");

  assert.ok(tryIndex >= 0 && elementsIndex > tryIndex);
  assert.ok(confirmIndex > elementsIndex && catchIndex > confirmIndex);
  assert.match(submitHandler.slice(catchIndex), /failPayment\(error/u);
});

test("shipping tiers share one bounded EasyPost rating context", () => {
  assert.match(shippingQuoteRoute, /ipMax: 12/u);
  assert.match(
    shippingQuoteRoute,
    /const ratingContext = createEasyPostRatingContext\(\)[\s\S]*shipping\.options\.map[\s\S]*ratingContext/u
  );
  assert.match(
    checkoutRoute,
    /const ratingContext = createEasyPostRatingContext\(\)[\s\S]*shipping\.options\.map[\s\S]*ratingContext/u
  );
  assert.match(shippingQuotes, /shipmentPromises: new Map\(\)/u);
  assert.match(shippingQuotes, /getParcelRatingKey\(planKey, parcelIndex, parcel, options\)/u);
  assert.match(shippingQuotes, /for \(const \[parcelIndex, parcel\] of plan\.parcels\.entries\(\)\)/u);
  assert.match(shippingQuotes, /verifiedAddressPromise/u);
  assert.match(shippingQuotes, /labelDate: estimatedShipDate\?\.toISOString\(\) \|\| ""/u);
  assert.match(shippingQuotes, /EASYPOST_RATING_BUDGET_MS = 25_000/u);
  assert.match(shippingQuotes, /EASYPOST_RATING_REQUEST_TIMEOUT_MS = 10_000/u);
  assert.match(shippingQuotes, /MAX_EASYPOST_SHIPMENT_CREATES_PER_RATING = 12/u);
  assert.match(shippingParcels, /MAX_RATED_PARCELS_PER_QUOTE = 12/u);
  assert.match(
    labelAutomation,
    /createEasyPostRatingContext\(\{ deadlineAt: workerDeadlineAt \}\)/u
  );
  assert.match(shippingQuotes, /estimatedShipDate/u);
  assert.match(shippingQuotes, /expectedArrivalDate/u);
  assert.match(
    shippingQuoteRoute,
    /Shipping rates are temporarily unavailable\. Please try again in a few minutes\./u
  );
  assert.match(shippingQuoteRoute, /status: noEligibleRates \? 422 : 503/u);
  assert.match(nextConfig, /Incomplete production shipping configuration/u);
  assert.match(nextConfig, /EASYPOST_FROM_STREET1/u);
});

test("checkout retries retain idempotency after ambiguous failures", () => {
  const prepareStart = storefront.indexOf("const preparePaymentIntent");
  const prepareEnd = storefront.indexOf("const createPaymentIntent", prepareStart);
  const source = storefront.slice(prepareStart, prepareEnd);

  assert.doesNotMatch(
    source,
    /catch \(error\) \{[\s\S]{0,300}checkoutAttemptIdRef\.current = ""/u
  );
  assert.match(source, /const shouldRotateCheckoutAttempt =/u);
  assert.match(source, /checkout_changed/u);
  assert.match(source, /inventory_changed/u);
  assert.match(source, /checkout_already_processed/u);
});

test("inventory cart changes invalidate stale payment and shipping quotes", () => {
  const inventoryStart = storefront.indexOf("const applyInventory");
  const inventoryEnd = storefront.indexOf("// Poll inventory", inventoryStart);
  const inventorySource = storefront.slice(inventoryStart, inventoryEnd);
  const quoteStart = storefront.indexOf("const shippingQuoteRequestFingerprint");
  const quoteEnd = storefront.indexOf("const hasActiveShippingPreview", quoteStart);
  const quoteSource = storefront.slice(quoteStart, quoteEnd);

  assert.match(inventorySource, /inventoryChanges\.length > 0[\s\S]*resetPaymentState\(\)/u);
  assert.match(quoteSource, /inventoryAllocation/u);
  assert.match(quoteSource, /inStockUnits: item\.inStockUnits/u);
  assert.match(quoteSource, /preorderUnits: item\.preorderUnits/u);
  assert.match(storefront, /body: JSON\.stringify\(shippingQuoteRequestPayload\)/u);
});

test("mixed preorder carts explain shipping holds and split pickup timing before payment", () => {
  assert.match(
    storefront,
    /Your in-stock items will be held, and the entire order will ship together after all preorder items are ready\./u
  );
  assert.match(storefront, /This avoids a second shipping charge\./u);
  assert.match(
    storefront,
    /Your in-stock items can be picked up on the scheduled market date; preorder items may need to be collected on a later market day\./u
  );
  assert.match(
    storefront,
    /preorderUnitsInCart > 0 && preorderUnitsInCart < itemCount/u
  );
  assert.match(
    storefront,
    /MIXED_SHIPPING_PREORDER_ACKNOWLEDGEMENT_LABEL/u
  );
  assert.match(
    storefront,
    /MIXED_PICKUP_PREORDER_ACKNOWLEDGEMENT_LABEL/u
  );
});

test("shipment refresh reports even when synchronization returns a warning", () => {
  const functionStart = appsScript.indexOf("function syncShipments()");
  const source = appsScript.slice(functionStart, appsScript.indexOf("function ", functionStart + 25));
  const postIndex = source.indexOf("postJson_(");
  const getIndex = source.indexOf("getJson_(");

  assert.ok(functionStart >= 0 && postIndex >= 0 && getIndex > postIndex);
  assert.match(source, /let refreshWarning = ""/u);
  assert.doesNotMatch(source, /if \(!refreshResponse\?\.ok\) \{[\s\S]*?throw new Error/u);
  assert.match(source, /toastIfAvailable_\(/u);
});

test("shipment label refresh uses a bounded time-aware worker", () => {
  const shipmentRoute = read("app/api/admin/shipments/route.js");
  assert.match(shipmentRoute, /AUTOMATIC_LABEL_WORKER_LIMIT = 2/u);
  assert.match(shipmentRoute, /AUTOMATIC_LABEL_WORKER_BUDGET_MS = 25_000/u);
  assert.match(shipmentRoute, /Date\.now\(\) >= workerDeadlineAt/u);
  assert.match(shipmentRoute, /automatic_labels_deferred/u);
});

test("legacy label claims recover and health reporting includes null timestamps", () => {
  assert.match(
    labelAutomation,
    /current\.label_purchase_started_at == null[\s\S]*?\.is\("label_purchase_started_at", null\)/u
  );
  assert.match(
    healthRoute,
    /label_purchase_started_at\.is\.null,label_purchase_started_at\.lte\./u
  );
});

test("label purchase rechecks order eligibility and completes only its own lease", () => {
  assert.match(labelAutomation, /const assertPurchaseLeaseEligible = async/u);
  assert.match(
    labelAutomation,
    /await assertEligible\(\);[\s\S]*buyEasyPostShipment/u
  );
  assert.match(
    labelAutomation,
    /\.eq\("status", "purchasing_label"\)[\s\S]*\.eq\("label_purchase_started_at", shipment\.label_purchase_started_at\)[\s\S]*\.select\("id"\)/u
  );
  assert.match(labelAutomation, /Operator review is required\./u);
  assert.match(labelAutomation, /LABEL_PURCHASE_WORKER_BUDGET_MS = 45_000/u);
  assert.match(labelAutomation, /LABEL_PURCHASE_REQUEST_TIMEOUT_MS = 10_000/u);
  assert.match(labelAutomation, /getPurchaseRequestTimeoutMs\(deadlineAt\)/u);
});

test("tracking compare-and-set misses are reread and retried monotonically", () => {
  assert.match(trackerRoute, /for \(let attempt = 0; attempt < 3; attempt \+= 1\)/u);
  assert.match(trackerRoute, /getMonotonicTrackingStatus\(currentStatus, status\)/u);
  assert.match(trackerRoute, /\.select\("id,status"\)[\s\S]*?if \(updated\) return true/u);
  assert.match(trackerRoute, /A concurrent parcel tracking update did not settle safely/u);
  assert.match(trackerRoute, /A concurrent shipment tracking update did not settle safely/u);
});

test("checkout protection is mandatory and retains exact expected arrival metadata", () => {
  assert.doesNotMatch(checkoutRoute, /Object\.hasOwn\(checkoutPayload, "checkoutAttemptId"\)/u);
  assert.match(checkoutRoute, /getStripeCheckoutIdempotencyKey\([\s\S]*checkoutPayload\.checkoutAttemptId/u);
  assert.match(checkoutRoute, /suppliedExpectationFields\.length === expectationFields\.length/u);
  assert.match(checkoutRoute, /isCheckoutExpectationExact\(/u);
  assert.match(
    checkoutRoute,
    /shipping_estimate: asMetadataValue\([\s\S]*selectedShippingOption\?\.transitLabel/u
  );
});

test("producer email recovery exposes bounded structured outcomes", () => {
  assert.doesNotMatch(emailQueue, /ORDER_CONFIRMATION_EMAIL_MODE|shouldQueueOrderConfirmationEmail/u);
  assert.match(emailQueue, /process\.env\.EMAIL_JOB_RETRY_DELAY_MS/u);
  assert.match(emailQueue, /const outcomes = \[\]/u);
  assert.match(emailQueue, /EMAIL_JOB_WORKER_LIMIT = 5/u);
  assert.match(emailQueue, /EMAIL_JOB_WORKER_BUDGET_MS = 25_000/u);
  assert.match(emailQueue, /Date\.now\(\) >= workerDeadlineAt/u);
  assert.match(emailQueue, /code: "invalid_payload"/u);
  assert.match(emailQueue, /code: "completion_failed"/u);
  assert.match(emailJobsRoute, /outcomes: Array\.isArray\(result\.outcomes\)/u);
  assert.match(emailTransport, /connectionTimeout: 8_000/u);
  assert.match(emailTransport, /greetingTimeout: 8_000/u);
  assert.match(emailTransport, /socketTimeout: 15_000/u);
});

test("consumer checkout copy omits internal postage and package-cost details", () => {
  assert.doesNotMatch(storefront, /reserved live postage plus packaging/iu);
  assert.match(
    storefront,
    /The shipping charge shown above is included in the total charged today\./u
  );
});

test("repository security scanning includes Google Apps Script sources", () => {
  assert.match(repoSecurityChecks, /\[cm\]\?\[jt\]sx\?\|gs\|json/u);
  assert.match(
    repoSecurityChecks,
    /git[\s\S]*ls-files[\s\S]*--cached[\s\S]*--others[\s\S]*--exclude-standard/u
  );
});
