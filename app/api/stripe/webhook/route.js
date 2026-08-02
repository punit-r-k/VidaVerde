import { securePublicRoute } from "@/lib/apiSecurity";
import { maybeSendCustomerConfirmationEmail } from "@/lib/orderConfirmationDispatch";
import { getAssignedPickupDateKey } from "@/lib/pickupDetails";
import { readBoundedTextBody } from "@/lib/requestBody";
import {
  getShippingOptionsForCart,
  inferSelectedShippingOption,
  normalizeProductType
} from "@/lib/shippingPricing";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { autoPurchaseFastestShippingLabels } from "@/lib/shipmentLabelAutomation";
import {
  stripeConfig,
  stripeRequest,
  verifyStripeSignature
} from "@/lib/stripe";
import { resolveStripePaymentIntentFinancialState } from "@/lib/stripeFinancialState";
import {
  getStripeChargePlacedAt,
  getStripeDisputeAction,
  getStripePaymentIntentId,
  isPaymentIntentCheckoutFlow,
  isStripeChargeFullyRefunded,
  parseStripeMetadataItems,
  validatePaymentIntentOrderIntegrity
} from "@/lib/stripeOrderIntegrity";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFinancialTestOrder } from "@/lib/testOrders";

export const runtime = "nodejs";

const STRIPE_WEBHOOK_RATE_LIMIT = getRouteRateLimitConfig("STRIPE_WEBHOOK_POST", {
  windowMs: 60_000,
  ipMax: 600
});
const STRIPE_WEBHOOK_BODY_MAX_BYTES = 256 * 1024;
const STRIPE_DISPUTE_EVENT_TYPES = new Set([
  "charge.dispute.created",
  "charge.dispute.updated",
  "charge.dispute.closed",
  "charge.dispute.funds_withdrawn",
  "charge.dispute.funds_reinstated"
]);

const normalizeParsedItems = (items) =>
  items.map((item) => ({
    ...item,
    product_type: normalizeProductType(item.product_type, item.sku)
  }));

const parseItemsFromMetadata = (source) =>
  normalizeParsedItems(parseStripeMetadataItems(source));

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);

const toFulfillment = (value) => (value === "market" ? "market" : "ship");

const toTitleWords = (value) =>
  String(value || "")
    .trim()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");

const getFallbackPaymentMethodLabel = (source) => {
  const types = Array.isArray(source?.payment_method_types)
    ? source.payment_method_types
    : [];
  const primaryType = toText(types[0], 32).toLowerCase();

  if (primaryType === "card") {
    return "Card";
  }

  return primaryType ? toTitleWords(primaryType) : "";
};

const getChargePaymentMethodLabel = (charge) => {
  const details = charge?.payment_method_details || {};
  const type = toText(details?.type, 32).toLowerCase();

  if (type === "card") {
    const card = details?.card || {};
    const brand = toTitleWords(card?.brand);
    const last4 = toText(card?.last4, 4);
    const walletType = toTitleWords(card?.wallet?.type);
    const baseLabel =
      brand && last4
        ? `${brand} ending in ${last4}`
        : brand || (last4 ? `Card ending in ${last4}` : "Card");

    return walletType ? `${walletType} (${baseLabel})` : baseLabel;
  }

  if (type === "link") {
    return "Link";
  }

  return type ? toTitleWords(type) : "";
};

const getChargeReceiptNumber = (charge) =>
  toText(charge?.receipt_number || charge?.id, 255);

const toNonNegativeInteger = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const fetchPaymentIntent = async (paymentIntentId) => {
  const normalizedId = getStripePaymentIntentId({
    object: "payment_intent",
    id: paymentIntentId
  });
  if (!normalizedId) {
    return { ok: false, status: 400, error: "Invalid PaymentIntent identifier." };
  }

  const result = await stripeRequest(
    `/v1/payment_intents/${encodeURIComponent(normalizedId)}?expand[]=latest_charge`,
    { method: "GET" }
  );
  if (!result.ok) {
    console.error("Stripe operational PaymentIntent fetch failed:", {
      paymentIntentId: normalizedId,
      status: result.status
    });
  }
  return result;
};

const findOrderForPaymentIntent = async (paymentIntentId) => {
  const columns =
    "id, status, payment_session_id, payment_reference, stripe_fulfillment_retired_at";
  const bySession = await supabaseAdmin
    .from("orders")
    .select(columns)
    .eq("payment_session_id", paymentIntentId)
    .maybeSingle();
  if (bySession.error || bySession.data) return bySession;

  return supabaseAdmin
    .from("orders")
    .select(columns)
    .eq("payment_reference", paymentIntentId)
    .maybeSingle();
};

const transitionOrderState = async ({
  orderId,
  status,
  effectiveAt,
  stateObservedAt,
  retireWork = true
}) => {
  const { data, error } = await supabaseAdmin.rpc("transition_stripe_order_state", {
    p_order_id: orderId,
    p_target_status: status,
    p_effective_at: effectiveAt,
    p_observed_at: stateObservedAt,
    p_retire_work: retireWork
  });

  return { status: typeof data === "string" ? data : "", error };
};

const cancelUnattachedCheckoutQuote = async (paymentIntentId, effectiveAt) => {
  const { error } = await supabaseAdmin
    .from("checkout_shipping_quotes")
    .update({ status: "cancelled", updated_at: effectiveAt })
    .eq("payment_session_id", paymentIntentId)
    .eq("status", "quoted");
  return error;
};

const getEventEffectiveAt = (event) => {
  if (!Number.isSafeInteger(event?.created) || event.created <= 0) {
    return new Date().toISOString();
  }

  const date = new Date(event.created * 1000);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
};

const getStripeObjectId = (value, prefix) => {
  const candidate = typeof value === "object" ? value?.id : value;
  const normalized = typeof candidate === "string" ? candidate.trim() : "";
  return new RegExp(`^${prefix}_[A-Za-z0-9_]+$`).test(normalized)
    ? normalized
    : "";
};

const fetchDispute = async (disputeId) => {
  const normalizedId = getStripeObjectId(disputeId, "du");
  if (!normalizedId) {
    return { ok: false, status: 400, error: "Invalid dispute identifier." };
  }

  const result = await stripeRequest(
    `/v1/disputes/${encodeURIComponent(normalizedId)}?expand[]=charge`,
    { method: "GET" }
  );
  if (!result.ok) {
    console.error("Stripe dispute fetch failed:", {
      disputeId: normalizedId,
      status: result.status
    });
  }
  return result;
};

const resolveOperationalPaymentIntent = async (source) => {
  const paymentIntentId = getStripePaymentIntentId(source);
  if (!paymentIntentId) return { ok: true, ignored: true };

  const result = await fetchPaymentIntent(paymentIntentId);
  if (!result.ok) {
    return {
      ok: false,
      error: "We couldn't verify the payment state with Stripe.",
      status: 502
    };
  }
  if (!isPaymentIntentCheckoutFlow(result.data)) {
    return { ok: true, ignored: true };
  }

  if (
    typeof source?.livemode === "boolean" &&
    typeof result.data?.livemode === "boolean" &&
    source.livemode !== result.data.livemode
  ) {
    return {
      ok: false,
      error: "Stripe payment mode did not match.",
      status: 409
    };
  }

  return { ok: true, paymentIntent: result.data, paymentIntentId };
};

const buildShippingRecordDetails = ({
  fulfillment,
  metadata,
  items,
  subtotal,
  shippingAmount,
  shippingRateMetadata = {}
}) => {
  if (toFulfillment(fulfillment) !== "ship") {
    return {
      shipping_tier: "",
      shipping_option: "",
      shipping_option_label: "",
      shipping_estimate: "",
      sauerkraut_count: 0,
      hot_sauce_count: 0
    };
  }

  const shipping = getShippingOptionsForCart({
    items,
    subtotalCents: subtotal
  });
  const selectedOption = inferSelectedShippingOption({
    shipping,
    amountCents: shippingAmount,
    shippingRateMetadata
  });

  return {
    shipping_tier: toText(
      shippingRateMetadata.shipping_tier || metadata?.shipping_tier || selectedOption.tier || shipping.tier,
      64
    ),
    shipping_option: toText(
      shippingRateMetadata.shipping_option || metadata?.shipping_option || selectedOption.id,
      64
    ),
    shipping_option_label: toText(
      shippingRateMetadata.shipping_option_label ||
        metadata?.shipping_option_label ||
        selectedOption.label,
      120
    ),
    shipping_estimate: toText(
      shippingRateMetadata.shipping_estimate ||
        metadata?.shipping_estimate ||
        selectedOption.transitLabel,
      180
    ),
    sauerkraut_count: toNonNegativeInteger(
      metadata?.sauerkraut_count || shipping.sauerkrautCount
    ),
    hot_sauce_count: toNonNegativeInteger(
      metadata?.hot_sauce_count || shipping.hotSauceCount
    )
  };
};

const recordPaidOrder = async ({
  paymentSessionId,
  paymentReference,
  fulfillment,
  currency,
  subtotal,
  tax,
  shipping,
  total,
  shippingRecordDetails,
  customer,
  items,
  placedAt,
  isTestOrder = false,
  stripeState
}) => {
  const pickupDate = getAssignedPickupDateKey({
    fulfillment,
    placedAt
  });
  const customerPayload = {
    ...(customer || {}),
    ...(shippingRecordDetails || {}),
    placed_at: toText(placedAt, 64),
    pickup_date: pickupDate
  };

  const { data, error: recordError } = await supabaseAdmin.rpc("record_stripe_order_state", {
    p_session_id: paymentSessionId,
    p_payment_reference: paymentReference,
    p_payment_provider: "stripe",
    p_fulfillment: fulfillment,
    p_currency: currency,
    p_amount_subtotal: subtotal,
    p_amount_tax: tax,
    p_amount_shipping: shipping,
    p_amount_total: total,
    p_customer: customerPayload,
    p_items: items,
    p_is_test_order: isTestOrder === true,
    p_target_status: stripeState.status,
    p_state_effective_at: stripeState.effectiveAt,
    p_state_observed_at: stripeState.observedAt,
    p_retire_work: stripeState.retireWork === true
  });

  return {
    orderId: typeof data?.order_id === "string" ? data.order_id : null,
    status: typeof data?.status === "string" ? data.status : "",
    fulfillmentRetired: data?.fulfillment_retired === true,
    error: recordError
  };
};

const syncShipmentForOrder = async (orderId) => {
  if (!orderId) return { shipmentId: null, error: null };

  const { data, error } = await supabaseAdmin.rpc("sync_shipment_for_order", {
    p_order_id: orderId
  });

  return { shipmentId: typeof data === "string" ? data : null, error };
};

const runOrderSideEffects = async ({
  orderId,
  fulfillment,
  currency,
  subtotal,
  tax,
  shipping,
  total,
  placedAt,
  receiptNumber,
  paymentMethodLabel,
  customer,
  items,
  strictConfirmationEmailAutomation = true
}) => {
  if (!orderId) {
    return {
      ok: false,
      error: "Unable to resolve order id.",
      status: 500
    };
  }

  const { shipmentId, error: shipmentError } = await syncShipmentForOrder(orderId);
  if (shipmentError) {
    console.error("sync_shipment_for_order error:", shipmentError);
    return {
      ok: false,
      error: "Unable to sync shipment.",
      status: 500
    };
  }

  if (shipmentId) {
    try {
      await autoPurchaseFastestShippingLabels(shipmentId);
    } catch (labelError) {
      console.error("automatic EasyPost label purchase failed:", labelError?.message || labelError);
    }
  }

  return maybeSendCustomerConfirmationEmail({
    orderId,
    fulfillment,
    currency,
    subtotal,
    tax,
    shipping,
    total,
    placedAt,
    receiptNumber,
    paymentMethodLabel,
    customer,
    items
  }, {
    failOnAutomationError: strictConfirmationEmailAutomation
  });
};

const handlePaymentIntentSucceeded = async (eventIntent, effectiveAt) => {
  if (!eventIntent || eventIntent.object !== "payment_intent") {
    return { ok: true };
  }

  if (!isPaymentIntentCheckoutFlow(eventIntent)) {
    return { ok: true };
  }

  const currentIntentResult = await fetchPaymentIntent(eventIntent.id);
  if (!currentIntentResult.ok) {
    return {
      ok: false,
      error: "We couldn't verify the current payment state with Stripe.",
      status: 502
    };
  }
  const intent = currentIntentResult.data;
  if (
    !isPaymentIntentCheckoutFlow(intent) ||
    toText(intent?.status, 64).toLowerCase() !== "succeeded" ||
    (
      typeof eventIntent.livemode === "boolean" &&
      typeof intent?.livemode === "boolean" &&
      eventIntent.livemode !== intent.livemode
    )
  ) {
    return {
      ok: false,
      error: "Stripe returned an inconsistent succeeded payment state.",
      status: 409
    };
  }

  const metadata = intent?.metadata || {};
  const items = parseItemsFromMetadata(intent);

  if (!Array.isArray(items) || items.length === 0) {
    console.error("Missing line items for PaymentIntent:", intent?.id);
    return { ok: false, error: "Missing line items.", status: 400 };
  }

  const shippingDetails = intent?.shipping || {};
  const shippingAddress = shippingDetails?.address || {};
  const latestCharge = typeof intent?.latest_charge === "object"
    ? intent.latest_charge
    : {};
  const billing = latestCharge?.billing_details || {};
  const billingAddress = billing?.address || {};
  const receiptNumber = getChargeReceiptNumber(latestCharge);
  const paymentMethodLabel =
    getChargePaymentMethodLabel(latestCharge) || getFallbackPaymentMethodLabel(intent);

  const customer = {
    name: toText(metadata.customer_name || shippingDetails?.name || billing?.name, 120),
    email: toText(metadata.customer_email || billing?.email, 254),
    phone: toText(metadata.customer_phone || shippingDetails?.phone || billing?.phone, 64),
    address1: toText(metadata.address1 || shippingAddress?.line1 || billingAddress?.line1, 120),
    address2: toText(metadata.address2 || shippingAddress?.line2 || billingAddress?.line2, 120),
    city: toText(metadata.city || shippingAddress?.city || billingAddress?.city, 120),
    state: toText(metadata.state || shippingAddress?.state || billingAddress?.state, 64),
    postal_code: toText(
      metadata.postal_code || shippingAddress?.postal_code || billingAddress?.postal_code,
      32
    ),
    note: toText(metadata.note, 500)
  };

  const integrity = validatePaymentIntentOrderIntegrity({
    intent,
    charge: latestCharge,
    items
  });
  if (!integrity.ok) {
    console.error("Stripe PaymentIntent accounting check failed:", {
      paymentIntentId: toText(intent?.id, 255),
      code: integrity.code
    });
    return {
      ok: false,
      error: "We couldn't verify the paid order details.",
      status: 400
    };
  }

  const { currency, subtotal, shipping, tax, total } = integrity;
  const paymentSessionId = toText(intent?.id, 255);
  const paymentReference = toText(
    typeof intent?.latest_charge === "string" ? intent.latest_charge : latestCharge?.id,
    255
  );
  const placedAt = getStripeChargePlacedAt(latestCharge);
  if (!placedAt) {
    console.error("Stripe PaymentIntent latest charge is missing a creation time:", {
      paymentIntentId: paymentSessionId
    });
    return {
      ok: false,
      error: "We couldn't verify when that payment completed.",
      status: 502
    };
  }

  const stripeState = await resolveStripePaymentIntentFinancialState({
    intent,
    charge: latestCharge,
    paidEffectiveAt: effectiveAt || placedAt
  });
  if (!stripeState.ok) {
    console.error("Stripe PaymentIntent financial-state check failed:", {
      paymentIntentId: paymentSessionId,
      code: stripeState.code
    });
    return {
      ok: false,
      error: "We couldn't verify the current payment state.",
      status: 502
    };
  }

  const shippingRecordDetails = buildShippingRecordDetails({
    fulfillment: toFulfillment(metadata.fulfillment),
    metadata,
    items,
    subtotal,
    shippingAmount: shipping,
    shippingRateMetadata: {}
  });

  const recordResult = await recordPaidOrder({
    paymentSessionId,
    paymentReference,
    fulfillment: toFulfillment(metadata.fulfillment),
    currency,
    subtotal,
    tax,
    shipping,
    total,
    shippingRecordDetails,
    customer,
    items,
    placedAt,
    isTestOrder: isFinancialTestOrder({ charge: latestCharge, source: intent }),
    stripeState
  });

  if (recordResult.error) {
    console.error("record_paid_order error:", recordResult.error);
    return {
      ok: false,
      error: "We couldn't save the paid order.",
      status: 500
    };
  }

  if (recordResult.status !== "paid" || recordResult.fulfillmentRetired) {
    if (recordResult.fulfillmentRetired && recordResult.status === "paid") {
      console.error("Stripe payment recovered after fulfillment work was retired:", {
        orderId: recordResult.orderId,
        paymentIntentId: paymentSessionId
      });
    }
    return {
      ok: true,
      orderId: recordResult.orderId,
      finalStatus: recordResult.status || stripeState.status,
      fulfillmentRetired: recordResult.fulfillmentRetired
    };
  }

  return runOrderSideEffects({
    orderId: recordResult.orderId,
    fulfillment: toFulfillment(metadata.fulfillment),
    currency,
    subtotal,
    tax,
    shipping,
    total,
    placedAt,
    receiptNumber,
    paymentMethodLabel,
    customer: {
      ...customer,
      ...shippingRecordDetails
    },
    items,
    strictConfirmationEmailAutomation: true
  });
};

const applyOperationalOrderState = async ({
  source,
  chargeId,
  targetStatus,
  effectiveAt,
  stateObservedAt,
  retireWork = true,
  resolvedPayment = null
}) => {
  const resolved = resolvedPayment || await resolveOperationalPaymentIntent(source);
  if (!resolved.ok || resolved.ignored) return resolved;

  const expectedChargeId = getStripeObjectId(
    resolved.paymentIntent?.latest_charge,
    "ch"
  );
  if (chargeId && (!expectedChargeId || expectedChargeId !== chargeId)) {
    console.error("Stripe operational event charge did not match PaymentIntent:", {
      paymentIntentId: resolved.paymentIntentId,
      chargeId
    });
    return {
      ok: false,
      error: "Stripe payment references did not match.",
      status: 409
    };
  }

  const { data: order, error: orderError } = await findOrderForPaymentIntent(
    resolved.paymentIntentId
  );
  if (orderError) {
    console.error("Stripe operational order lookup failed:", {
      paymentIntentId: resolved.paymentIntentId,
      message: orderError.message
    });
    return { ok: false, error: "We couldn't find the local order.", status: 500 };
  }
  if (!order?.id) {
    console.error("Stripe operational event arrived before its local order:", {
      paymentIntentId: resolved.paymentIntentId,
      targetStatus
    });
    return {
      ok: false,
      error: "The local order is not available yet.",
      status: 503
    };
  }

  const transition = await transitionOrderState({
    orderId: order.id,
    status: targetStatus,
    effectiveAt,
    stateObservedAt,
    retireWork
  });
  if (transition.error) {
    console.error("Stripe operational order transition failed:", {
      orderId: order.id,
      targetStatus,
      message: transition.error.message
    });
    return {
      ok: false,
      error: "We couldn't update the local order state.",
      status: 500
    };
  }

  if (!transition.status) {
    console.error("Stripe operational order transition returned no state:", {
      orderId: order.id,
      targetStatus
    });
    return {
      ok: false,
      error: "We couldn't verify the updated local order state.",
      status: 500
    };
  }

  return {
    ok: true,
    orderId: order.id,
    finalStatus: transition.status,
    fulfillmentRetired: Boolean(order.stripe_fulfillment_retired_at)
  };
};

const handlePaymentIntentCanceled = async (intent, effectiveAt, stateObservedAt) => {
  if (!isPaymentIntentCheckoutFlow(intent)) return { ok: true };

  const paymentIntentId = getStripePaymentIntentId(intent);
  if (!paymentIntentId) {
    return { ok: false, error: "Invalid PaymentIntent cancellation.", status: 400 };
  }

  const { data: order, error: orderError } = await findOrderForPaymentIntent(
    paymentIntentId
  );
  if (orderError) {
    console.error("Canceled PaymentIntent order lookup failed:", {
      paymentIntentId,
      message: orderError.message
    });
    return { ok: false, error: "We couldn't check the local order.", status: 500 };
  }

  if (!order?.id) {
    const quoteError = await cancelUnattachedCheckoutQuote(paymentIntentId, effectiveAt);
    if (quoteError) {
      console.error("Canceled PaymentIntent quote cleanup failed:", {
        paymentIntentId,
        message: quoteError.message
      });
      return { ok: false, error: "We couldn't cancel checkout work.", status: 500 };
    }
    return { ok: true };
  }

  if (order.status === "cancelled") return { ok: true };
  if (order.status !== "pending") {
    console.error("Refusing to regress a recorded order from PaymentIntent cancellation:", {
      orderId: order.id,
      status: order.status,
      paymentIntentId
    });
    return {
      ok: false,
      error: "A recorded order cannot be cancelled by this event.",
      status: 409
    };
  }

  const transition = await transitionOrderState({
    orderId: order.id,
    status: "cancelled",
    effectiveAt,
    stateObservedAt
  });
  if (transition.error) {
    console.error("Canceled PaymentIntent order transition failed:", {
      orderId: order.id,
      message: transition.error.message
    });
    return { ok: false, error: "We couldn't cancel checkout work.", status: 500 };
  }

  return { ok: true };
};

const handleChargeRefunded = async (charge, effectiveAt, stateObservedAt) => {
  if (!charge || charge.object !== "charge") return { ok: true };

  if (!isStripeChargeFullyRefunded(charge)) {
    if (charge.refunded === true) {
      return {
        ok: false,
        error: "The full refund amount could not be verified.",
        status: 409
      };
    }

    console.warn("Partial Stripe refund preserved fulfillment:", {
      chargeId: getStripeObjectId(charge, "ch"),
      amount: charge.amount,
      amountRefunded: charge.amount_refunded
    });
    return { ok: true };
  }

  const chargeId = getStripeObjectId(charge, "ch");
  if (!chargeId) return { ok: false, error: "Invalid refunded charge.", status: 400 };

  return applyOperationalOrderState({
    source: charge,
    chargeId,
    targetStatus: "refunded",
    effectiveAt,
    stateObservedAt
  });
};

const handleDisputeLifecycle = async (dispute, effectiveAt) => {
  if (!dispute || dispute.object !== "dispute") return { ok: true };

  const disputeId = getStripeObjectId(dispute, "du");
  if (!disputeId) return { ok: false, error: "Invalid dispute.", status: 400 };

  const disputeResult = await fetchDispute(disputeId);
  if (!disputeResult.ok) {
    return {
      ok: false,
      error: "We couldn't verify the dispute state with Stripe.",
      status: 502
    };
  }

  const currentDispute = disputeResult.data;
  if (
    currentDispute?.object !== "dispute" ||
    getStripeObjectId(currentDispute, "du") !== disputeId
  ) {
    return {
      ok: false,
      error: "Stripe returned an invalid dispute state.",
      status: 502
    };
  }

  if (
    typeof dispute.livemode === "boolean" &&
    typeof currentDispute.livemode === "boolean" &&
    dispute.livemode !== currentDispute.livemode
  ) {
    return {
      ok: false,
      error: "Stripe dispute mode did not match.",
      status: 409
    };
  }

  const action = getStripeDisputeAction(currentDispute.status);
  if (!action) {
    console.error("Unsupported Stripe dispute status:", {
      disputeId,
      status: currentDispute?.status
    });
    return {
      ok: false,
      error: "The Stripe dispute status is not supported.",
      status: 409
    };
  }

  const chargeId = getStripeObjectId(currentDispute?.charge, "ch");
  if (!chargeId) return { ok: false, error: "Invalid disputed charge.", status: 400 };

  const paymentSource = getStripePaymentIntentId(currentDispute)
    ? currentDispute
    : currentDispute.charge;

  const resolved = await resolveOperationalPaymentIntent(paymentSource);
  if (!resolved.ok || resolved.ignored) return resolved;

  const latestCharge = resolved.paymentIntent?.latest_charge;
  if (
    latestCharge?.object !== "charge" ||
    getStripeObjectId(latestCharge, "ch") !== chargeId
  ) {
    return {
      ok: false,
      error: "Stripe payment references did not match.",
      status: 409
    };
  }

  // Resolve every current dispute for the charge. A closed dispute must not
  // restore fulfillment while another dispute is still active or was lost.
  const financialState = await resolveStripePaymentIntentFinancialState({
    intent: resolved.paymentIntent,
    charge: latestCharge,
    paidEffectiveAt: effectiveAt
  });
  if (!financialState.ok) {
    console.error("Stripe dispute aggregate-state check failed:", {
      disputeId,
      code: financialState.code
    });
    return {
      ok: false,
      error: "We couldn't verify the current dispute state with Stripe.",
      status: 502
    };
  }

  const transition = await applyOperationalOrderState({
    source: paymentSource,
    chargeId,
    targetStatus: financialState.status,
    effectiveAt: financialState.effectiveAt,
    stateObservedAt: financialState.observedAt,
    retireWork: financialState.retireWork,
    resolvedPayment: resolved
  });
  if (!transition.ok || transition.finalStatus !== "paid") {
    return transition;
  }

  if (transition.fulfillmentRetired) {
    console.error("Late dispute recovery requires fulfillment reconciliation:", {
      disputeId,
      orderId: transition.orderId
    });
    return {
      ...transition,
      warning: "Fulfillment work was retired and requires operator reconciliation."
    };
  }

  // Re-enter the idempotent succeeded path so a safe recovery resumes both
  // shipping and confirmation-email work, including an order first recorded
  // while the dispute was active.
  return handlePaymentIntentSucceeded(
    resolved.paymentIntent,
    financialState.effectiveAt
  );
};

export async function POST(request) {
  const security = await securePublicRoute(request, {
    scope: "stripe:webhook:post",
    rateLimit: STRIPE_WEBHOOK_RATE_LIMIT,
    rateLimitExceededMessage: "Too many webhook requests. Please wait and retry."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!stripeConfig) {
    return respond.json(
      { error: "Stripe webhooks are not connected right now." },
      { status: 500 }
    );
  }

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Order storage is not connected right now." },
      { status: 500 }
    );
  }

  const signatureHeader = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signatureHeader) {
    return respond.json({ error: "Missing signature." }, { status: 400 });
  }

  if (!webhookSecret) {
    return respond.json(
      { error: "Stripe webhooks are not set up right now." },
      { status: 500 }
    );
  }

  const bodyResult = await readBoundedTextBody(request, {
    maxBytes: STRIPE_WEBHOOK_BODY_MAX_BYTES
  });
  if (!bodyResult.ok) {
    return respond.json(
      {
        error:
          bodyResult.status === 413
            ? "Webhook payload is too large."
            : "We couldn't read the Stripe webhook payload."
      },
      { status: bodyResult.status }
    );
  }

  const body = bodyResult.text;
  const verification = verifyStripeSignature({
    payload: body,
    signatureHeader,
    secret: webhookSecret
  });

  if (!verification.ok) {
    return respond.json({ error: verification.error }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return respond.json(
      { error: "We couldn't read the Stripe webhook payload." },
      { status: 400 }
    );
  }

  const eventType = String(event?.type || "");
  const eventObject = event?.data?.object;
  const effectiveAt = getEventEffectiveAt(event);
  const stateObservedAt = new Date().toISOString();

  let result = { ok: true };
  if (eventType === "payment_intent.succeeded") {
    result = await handlePaymentIntentSucceeded(eventObject, effectiveAt);
  } else if (eventType === "payment_intent.canceled") {
    result = await handlePaymentIntentCanceled(eventObject, effectiveAt, stateObservedAt);
  } else if (eventType === "charge.refunded") {
    result = await handleChargeRefunded(eventObject, effectiveAt, stateObservedAt);
  } else if (STRIPE_DISPUTE_EVENT_TYPES.has(eventType)) {
    result = await handleDisputeLifecycle(eventObject, effectiveAt);
  }

  if (!result.ok) {
    return respond.json(
      { error: result.error || "We couldn't process the Stripe payment event." },
      { status: result.status || 500 }
    );
  }

  return respond.json({ ok: true });
}
