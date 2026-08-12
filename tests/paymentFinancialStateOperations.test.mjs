import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const finalizeRoute = fs.readFileSync(
  new URL("../app/api/order/finalize/route.js", import.meta.url),
  "utf8"
);
const webhookRoute = fs.readFileSync(
  new URL("../app/api/stripe/webhook/route.js", import.meta.url),
  "utf8"
);
const financialStateHelper = fs.readFileSync(
  new URL("../lib/stripeFinancialState.js", import.meta.url),
  "utf8"
);
const confirmationEmail = fs.readFileSync(
  new URL("../lib/orderConfirmationEmail.js", import.meta.url),
  "utf8"
);

test("succeeded reconciliation records current Stripe state before side effects", () => {
  for (const source of [finalizeRoute, webhookRoute]) {
    const resolveIndex = source.indexOf("resolveStripePaymentIntentFinancialState({");
    const recordIndex = source.indexOf("const recordResult = await recordPaidOrder({", resolveIndex);
    const sideEffectIndex = source.indexOf("runOrderSideEffects({", recordIndex);

    assert.ok(resolveIndex >= 0, "current charge state must be resolved");
    assert.ok(recordIndex > resolveIndex, "state resolution must precede order recording");
    assert.ok(sideEffectIndex > recordIndex, "recording must precede fulfillment side effects");
    assert.match(source, /recordResult\.status !== "paid" \|\| recordResult\.fulfillmentRetired/u);
    assert.match(source, /rpc\("record_stripe_order_state"/u);
  }
});

test("verified payments attempt confirmation delivery before shipment automation", () => {
  for (const source of [finalizeRoute, webhookRoute]) {
    const sideEffectsStart = source.indexOf("const runOrderSideEffects");
    const sideEffectsEnd = source.indexOf("const handlePaymentIntentSucceeded", sideEffectsStart) >= 0
      ? source.indexOf("const handlePaymentIntentSucceeded", sideEffectsStart)
      : source.indexOf("const finalizePaymentIntent", sideEffectsStart);
    const sideEffects = source.slice(sideEffectsStart, sideEffectsEnd);
    const confirmationIndex = sideEffects.indexOf("await maybeSendCustomerConfirmationEmail({");
    const shipmentIndex = sideEffects.indexOf("await syncShipmentForOrder(orderId)");

    assert.ok(confirmationIndex >= 0, "confirmation delivery must be attempted");
    assert.ok(
      shipmentIndex > confirmationIndex,
      "confirmation delivery must not wait for shipment or label automation"
    );
    assert.match(source, /export const maxDuration = 60/u);
  }
});

test("event time is preserved independently from lookup completion time", () => {
  assert.match(financialStateHelper, /effectiveAt: normalizedPaidEffectiveAt/u);
  assert.match(financialStateHelper, /observedAt/u);
  assert.doesNotMatch(
    financialStateHelper,
    /effectiveAt:\s*state\.status === "paid"\s*\?/u
  );
});

test("dispute recovery aggregates all disputes and resumes the full idempotent path", () => {
  const disputeHandler = webhookRoute.slice(
    webhookRoute.indexOf("const handleDisputeLifecycle"),
    webhookRoute.indexOf("export async function POST")
  );

  assert.match(disputeHandler, /resolveStripePaymentIntentFinancialState\(/u);
  assert.match(disputeHandler, /resolvedPayment: resolved/u);
  assert.match(disputeHandler, /transition\.fulfillmentRetired/u);
  assert.match(disputeHandler, /operator reconciliation/u);
  assert.match(disputeHandler, /return handlePaymentIntentSucceeded\(/u);
  for (const eventType of [
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
    "charge.dispute.funds_withdrawn",
    "charge.dispute.funds_reinstated"
  ]) {
    assert.match(webhookRoute, new RegExp(eventType.replaceAll(".", "\\."), "u"));
  }
});

test("inactive finalization uses fulfillment-neutral consumer copy", () => {
  const warningBuilder = finalizeRoute.slice(
    finalizeRoute.indexOf("const buildInactivePaymentWarning"),
    finalizeRoute.indexOf("const recordPaidOrder")
  );

  assert.match(warningBuilder, /order preparation was stopped/u);
  assert.match(warningBuilder, /order preparation is paused/u);
  assert.doesNotMatch(warningBuilder, /shipment/u);
});

test("retired fulfillment is ineligible for confirmation rendering", () => {
  const contextLookup = confirmationEmail.slice(
    confirmationEmail.indexOf("const getAuthoritativeOrderEmailContext"),
    confirmationEmail.indexOf("const getOrderPreorderStatus")
  );

  assert.match(contextLookup, /stripe_fulfillment_retired_at/u);
  assert.match(
    contextLookup,
    /status !== "paid" \|\| data\.stripe_fulfillment_retired_at/u
  );
  assert.match(contextLookup, /code: "order_ineligible"/u);
});
