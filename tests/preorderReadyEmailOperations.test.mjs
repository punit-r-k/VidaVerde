import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const preorderEmailSource = fs.readFileSync(
  new URL("../lib/preorderReadyEmail.js", import.meta.url),
  "utf8"
);
const appsScriptSource = fs.readFileSync(
  new URL("../apps-script/inventory-sync.gs", import.meta.url),
  "utf8"
);

test("preorder-ready emails use only canonical consumer shipping wording", () => {
  assert.doesNotMatch(preorderEmailSource, /shipping_option_label/u);
  assert.doesNotMatch(preorderEmailSource, /shippingOptionLabel/u);
  assert.doesNotMatch(preorderEmailSource, /\bcarrier\b|\bservice\b/iu);
  assert.match(preorderEmailSource, /getConsumerShippingDetails/u);
  assert.match(preorderEmailSource, /Estimated ship date/u);
  assert.match(preorderEmailSource, /Expected arrival/u);
  assert.match(preorderEmailSource, /Open and inspect the package/u);
  assert.match(preorderEmailSource, /Refrigerate upon arrival/u);
  assert.match(preorderEmailSource, /burp each jar to release any existing gas/u);
  assert.doesNotMatch(preorderEmailSource, /shipping label|postage|packaging/iu);
});

test("preorder-ready delivery claims the exact event batch before shipment or SMTP", () => {
  const loopStart = preorderEmailSource.indexOf(
    "for (let orderIndex = 0; orderIndex < readyOrders.length; orderIndex += 1)"
  );
  const loopSource = preorderEmailSource.slice(loopStart);
  const claimIndex = loopSource.indexOf("claimPreorderReadyEmailEvents(order");
  const shipmentIndex = loopSource.indexOf("prepareShippingOrder(enrichedOrder");
  const smtpIndex = loopSource.indexOf("await sendMail(");

  assert.ok(loopStart >= 0);
  assert.ok(claimIndex >= 0 && shipmentIndex > claimIndex && smtpIndex > shipmentIndex);
  assert.match(loopSource, /messageId: buildPreorderReadyMessageId\(order\)/u);
  assert.match(loopSource, /if \(!smtpAccepted\)[\s\S]*releasePreorderReadyEmailEvents/u);
  assert.match(loopSource, /completePreorderReadyEmailEvents\([\s\S]*continue;/u);
});

test("final live preorder shipments fail closed until tracking exists", () => {
  assert.match(
    preorderEmailSource,
    /if \(trackingResult\.numbers\.length === 0\)[\s\S]*Shipment tracking is not ready yet\./u
  );
  assert.match(
    preorderEmailSource,
    /if \(order\.isTestOrder && !isEasyPostTestMode\(\)\)[\s\S]*order\.trackingNumbers = \[\]/u
  );
  assert.match(preorderEmailSource, /sync_shipment_for_order_with_test_labels/u);
  assert.match(preorderEmailSource, /Not generated for this test order\./u);
  assert.match(preorderEmailSource, /Changes may no longer be possible\./u);
});

test("Apps Script installs one permanent trigger for each email worker", () => {
  assert.match(appsScriptSource, /resetEmailQueueTrigger_\(\);/u);
  assert.match(appsScriptSource, /resetPreorderReadyEmailTrigger_\(\);/u);
  assert.match(
    appsScriptSource,
    /function resetEmailQueueTrigger_\(\)[\s\S]*ScriptApp\.newTrigger\(handlerName\)[\s\S]*\.everyMinutes\(5\)/u
  );
  assert.match(
    appsScriptSource,
    /function resetPreorderReadyEmailTrigger_\(\)[\s\S]*ScriptApp\.newTrigger\(handlerName\)[\s\S]*\.everyMinutes\(5\)/u
  );
  assert.doesNotMatch(appsScriptSource, /schedulePreorderReadyEmails_/u);
  assert.match(appsScriptSource, /action: "retry_failed"/u);
});

test("preorder scanning and producer error reporting are bounded and structured", () => {
  assert.match(preorderEmailSource, /PREORDER_READY_EMAIL_DELAY_MS = 5 \* 60 \* 1000/u);
  assert.match(preorderEmailSource, /const cutoff = nowMs - PREORDER_READY_EMAIL_DELAY_MS/u);
  assert.match(preorderEmailSource, /PREORDER_READY_EMAIL_ORDER_LIMIT = 4/u);
  assert.match(preorderEmailSource, /PREORDER_READY_EMAIL_MAX_EVENTS_PER_ORDER = 200/u);
  assert.match(preorderEmailSource, /PREORDER_READY_EMAIL_WORKER_BUDGET_MS = 45_000/u);
  assert.match(preorderEmailSource, /get_preorder_ready_email_candidate_orders/u);
  assert.match(preorderEmailSource, /\.in\("order_id", candidateOrderIds\)/u);
  assert.match(preorderEmailSource, /Date\.now\(\) >= workerDeadlineAt/u);
  assert.doesNotMatch(preorderEmailSource, /\.lte\("created_at", cutoffIso\)/u);
  assert.match(preorderEmailSource, /error: errors\[0\]\?\.error \|\| null/u);

  const refreshPost = appsScriptSource.indexOf(
    "postJson_(\n    `${settings.apiBaseUrl}/api/admin/shipments`"
  );
  const reportGet = appsScriptSource.indexOf(
    "getJson_(\n    `${settings.apiBaseUrl}/api/admin/shipments?limit=1000`"
  );
  assert.ok(refreshPost >= 0 && reportGet > refreshPost);
  assert.match(appsScriptSource, /let refreshWarning = ""/u);
  assert.match(appsScriptSource, /toastIfAvailable_\(/u);
  assert.match(appsScriptSource, /const firstError = Array\.isArray\(response\?\.errors\)/u);
});
