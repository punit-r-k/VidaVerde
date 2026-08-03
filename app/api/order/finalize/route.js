import crypto from "node:crypto";
import { securePublicRoute } from "@/lib/apiSecurity";
import { getConsumerShippingDetails } from "@/lib/consumerShipping";
import { maybeSendCustomerConfirmationEmail } from "@/lib/orderConfirmationDispatch";
import { getAssignedPickupDateKey } from "@/lib/pickupDetails";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { readBoundedJsonBody } from "@/lib/requestBody";
import { autoPurchaseFastestShippingLabels } from "@/lib/shipmentLabelAutomation";
import {
  getShippingOptionsForCart,
  inferSelectedShippingOption,
  normalizeProductType
} from "@/lib/shippingPricing";
import { stripeConfig, stripeRequest } from "@/lib/stripe";
import { resolveStripePaymentIntentFinancialState } from "@/lib/stripeFinancialState";
import {
  getStripeChargePlacedAt,
  isPaymentIntentCheckoutFlow,
  parseStripeMetadataItems,
  validatePaymentIntentOrderIntegrity
} from "@/lib/stripeOrderIntegrity";
import { isEasyPostTestMode } from "@/lib/easypost";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFinancialTestOrder } from "@/lib/testOrders";
import { z } from "zod";

const ORDER_FINALIZE_RATE_LIMIT = getRouteRateLimitConfig("ORDER_FINALIZE_POST", {
  windowMs: 60_000,
  ipMax: 30
});
const ORDER_FINALIZE_BODY_MAX_BYTES = 64 * 1024;

const optionalStripeIdSchema = ({ pattern, message }) =>
  z.preprocess(
    (value) => String(value || "").trim(),
    z
      .string()
      .max(255, message)
      .refine((value) => !value || pattern.test(value), message)
  );

const payloadSchema = z
  .object({
    paymentIntentId: optionalStripeIdSchema({
      pattern: /^pi_[A-Za-z0-9_]+$/,
      message: "That payment link looks invalid. Please try checking out again."
    }),
    paymentIntentClientSecret: z.preprocess(
      (value) => String(value || "").trim(),
      z
        .string()
        .max(512, "That payment confirmation looks invalid. Please try checking out again.")
        .refine(
          (value) => !value || /^pi_[A-Za-z0-9_]+_secret_[A-Za-z0-9_]+$/.test(value),
          "That payment confirmation looks invalid. Please try checking out again."
        )
    )
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.paymentIntentId && !payload.paymentIntentClientSecret) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["paymentIntentClientSecret"],
        message: "We couldn't securely confirm that payment. Please try checking out again."
      });
      return;
    }

    if (payload.paymentIntentId) return;

    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["paymentIntentId"],
      message: "We couldn't find that payment. Please try checking out again."
    });
  });

const secretsMatch = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ""), "utf8");
  const rightBuffer = Buffer.from(String(right || ""), "utf8");
  return leftBuffer.length > 0 &&
    leftBuffer.length === rightBuffer.length &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

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

const toCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const toNonNegativeInteger = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
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

const parseExpectedPreorderMap = (source) => {
  const raw = toText(source?.metadata?.expected_preorder, 500);
  if (!raw) {
    return new Map();
  }

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((map, entry) => {
      const [rawSku, rawPreorderQty] = entry.split(":");
      const sku = String(rawSku || "").trim().toUpperCase();
      if (!sku) {
        return map;
      }

      map.set(sku, toCount(rawPreorderQty));
      return map;
    }, new Map());
};

const getRecordedOrderItems = async (orderId) => {
  if (!orderId) {
    return [];
  }

  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("sku, quantity, preorder_qty, products(name)")
    .eq("order_id", orderId);

  if (error) {
    console.error("order allocation read error:", error);
    return [];
  }

  return Array.isArray(data) ? data : [];
};

const buildInventoryShiftWarning = (orderItems, expectedPreorderMap, fulfillment) => {
  if (!(expectedPreorderMap instanceof Map) || expectedPreorderMap.size === 0) {
    return null;
  }

  const shiftedItems = (Array.isArray(orderItems) ? orderItems : [])
    .map((item) => {
      const sku = toText(item?.sku, 64).toUpperCase();
      if (!sku) {
        return null;
      }

      const expectedPreorderQty = expectedPreorderMap.get(sku) ?? 0;
      const actualPreorderQty = Math.min(
        toCount(item?.quantity),
        toCount(item?.preorder_qty)
      );

      if (actualPreorderQty <= expectedPreorderQty) {
        return null;
      }

      return {
        name: toText(item?.products?.name || sku, 120),
        shiftedQty: actualPreorderQty - expectedPreorderQty
      };
    })
    .filter(Boolean);

  if (shiftedItems.length === 0) {
    return null;
  }

  const itemSummary = shiftedItems
    .slice(0, 3)
    .map(
      (item) =>
        `${item.name} (${item.shiftedQty} ${item.shiftedQty === 1 ? "unit" : "units"} now preorder)`
    )
    .join(", ");
  const hasMoreItems = shiftedItems.length > 3;
  const timingContext =
    toFulfillment(fulfillment) === "ship"
      ? "shipping and preorder timing"
      : "pickup and preorder split";

  return {
    code: "inventory_shifted_to_preorder",
    customerMessage: `Your payment was received and the order is confirmed. While payment was processing, live inventory changed and some items moved to preorder: ${itemSummary}${hasMoreItems ? ", plus additional items" : ""}. Your confirmation reflects the updated ${timingContext}.`,
    popupMessage:
      "Order confirmed. Some items moved to preorder while payment was processing."
  };
};

const buildInactivePaymentWarning = (status) => status === "refunded"
  ? {
      code: "payment_refunded",
      customerMessage: "This payment has already been refunded, so order preparation was stopped.",
      popupMessage: "Payment refunded. Order preparation was stopped."
    }
  : {
      code: "payment_disputed",
      customerMessage: "This payment is under review, so order preparation is paused.",
      popupMessage: "Payment under review. Order preparation is paused."
    };

const buildRetiredFulfillmentWarning = () => ({
  code: "fulfillment_review_required",
  customerMessage:
    "Your payment status was restored. We need to review the order before preparation can resume.",
  popupMessage: "Payment restored. Order preparation needs review."
});

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

  const rpcName = isEasyPostTestMode()
    ? "sync_shipment_for_order_with_test_labels"
    : "sync_shipment_for_order";
  const { data, error } = await supabaseAdmin.rpc(rpcName, {
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
  strictConfirmationEmailAutomation = false
}) => {
  if (!orderId) {
    return {
      ok: false,
      error: "We couldn't find that order after payment.",
      status: 500
    };
  }

  const { shipmentId, error: shipmentError } = await syncShipmentForOrder(orderId);
  if (shipmentError) {
    console.error("sync_shipment_for_order error:", shipmentError);
    return {
      ok: false,
      error: "We couldn't prepare shipping for that order yet.",
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

const finalizePaymentIntent = async (intent) => {
  if (!intent || intent.object !== "payment_intent") {
    return {
      ok: false,
      error: "That payment link looks invalid. Please try checking out again.",
      status: 400
    };
  }

  const paymentStatus = toText(intent?.status, 64).toLowerCase();
  if (paymentStatus !== "succeeded") {
    return {
      ok: true,
      recorded: false,
      paymentStatus,
      status: 202
    };
  }

  const metadata = intent?.metadata || {};
  if (!isPaymentIntentCheckoutFlow(intent)) {
    return {
      ok: false,
      error: "That payment was not created by this checkout. Please start checkout again.",
      status: 400
    };
  }

  const items = parseItemsFromMetadata(intent);

  if (!Array.isArray(items) || items.length === 0) {
    console.error("Missing line items for PaymentIntent:", intent?.id);
    return { ok: false, error: "Missing line items.", status: 400 };
  }

  const shippingDetails = intent?.shipping || {};
  const shippingAddress = shippingDetails?.address || {};
  const latestCharge =
    typeof intent?.latest_charge === "object"
      ? intent.latest_charge
      : Array.isArray(intent?.charges?.data)
        ? intent.charges.data[0] || {}
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
      error: "We couldn't verify the paid order details. Please contact us for help.",
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
      error: "We couldn't verify when that payment completed. Please try again shortly.",
      status: 502
    };
  }

  const stripeState = await resolveStripePaymentIntentFinancialState({
    intent,
    charge: latestCharge,
    paidEffectiveAt: placedAt
  });
  if (!stripeState.ok) {
    console.error("Stripe PaymentIntent financial-state check failed:", {
      paymentIntentId: paymentSessionId,
      code: stripeState.code
    });
    return {
      ok: false,
      error: "We couldn't verify the current payment state. Please try again shortly.",
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
      error: "We couldn't save your order after payment.",
      status: 500
    };
  }

  if (recordResult.status !== "paid" || recordResult.fulfillmentRetired) {
    const finalStatus = recordResult.status || stripeState.status;
    return {
      ok: true,
      recorded: true,
      paymentStatus,
      orderId: recordResult.orderId,
      fulfillment: toFulfillment(metadata.fulfillment),
      shippingOptionLabel: "",
      shippingEstimate: "",
      automationWarnings: [
        recordResult.fulfillmentRetired && finalStatus === "paid"
          ? buildRetiredFulfillmentWarning()
          : buildInactivePaymentWarning(finalStatus)
      ]
    };
  }

  const expectedPreorderMap = parseExpectedPreorderMap(intent);
  const recordedOrderItems = await getRecordedOrderItems(recordResult.orderId);
  const inventoryShiftWarning = buildInventoryShiftWarning(
    recordedOrderItems,
    expectedPreorderMap,
    metadata.fulfillment
  );

  const sideEffectsResult = await runOrderSideEffects({
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
    strictConfirmationEmailAutomation: false
  });

  if (!sideEffectsResult.ok) {
    return sideEffectsResult;
  }

  const consumerShipping = getConsumerShippingDetails(shippingRecordDetails);

  return {
    ok: true,
    recorded: true,
    paymentStatus,
    orderId: recordResult.orderId,
    fulfillment: toFulfillment(metadata.fulfillment),
    shippingOptionLabel:
      toFulfillment(metadata.fulfillment) === "ship" ? consumerShipping.label : "",
    shippingEstimate:
      toFulfillment(metadata.fulfillment) === "ship" ? consumerShipping.transitLabel : "",
    automationWarnings: [
      ...(inventoryShiftWarning ? [inventoryShiftWarning] : []),
      ...(Array.isArray(sideEffectsResult?.automationWarnings)
        ? sideEffectsResult.automationWarnings
        : [])
    ]
  };
};

export const runtime = "nodejs";

export async function POST(request) {
  const security = await securePublicRoute(request, {
    scope: "order:finalize",
    rateLimit: ORDER_FINALIZE_RATE_LIMIT,
    rateLimitExceededMessage: "Too many order finalization attempts. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!stripeConfig) {
    return respond.json(
      { error: "Checkout is not available right now. Please try again later." },
      { status: 500 }
    );
  }

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Checkout is not available right now. Please try again later." },
      { status: 500 }
    );
  }

  const bodyResult = await readBoundedJsonBody(request, {
    maxBytes: ORDER_FINALIZE_BODY_MAX_BYTES
  });
  if (!bodyResult.ok) {
    return respond.json(
      {
        error:
          bodyResult.status === 413
            ? "That payment confirmation is too large. Please try checking out again."
            : "We couldn't read that payment confirmation. Please try again."
      },
      { status: bodyResult.status }
    );
  }

  const payload = bodyResult.data;

  const parsedPayload = payloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return respond.json(
      {
        error:
          parsedPayload.error.issues[0]?.message ||
          "We couldn't read that payment confirmation. Please try again."
      },
      { status: 400 }
    );
  }

  const paymentIntentId = parsedPayload.data.paymentIntentId;
  const paymentIntentClientSecret = parsedPayload.data.paymentIntentClientSecret;
  const stripePath = `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}` +
    "?expand[]=latest_charge&expand[]=charges.data";
  const { ok, data, error } = await stripeRequest(stripePath, {
    method: "GET"
  });

  if (!ok) {
    console.error("stripe payment_intent verify error:", error);
    return respond.json(
      { error: "We couldn't confirm the payment yet. Please wait a moment and try again." },
      { status: 502 }
    );
  }

  if (!secretsMatch(data?.client_secret, paymentIntentClientSecret)) {
    return respond.json(
      { error: "We couldn't securely confirm that payment. Please try checking out again." },
      { status: 403 }
    );
  }

  const result = await finalizePaymentIntent(data);
  if (!result.ok) {
    return respond.json(
      { error: result.error || "We couldn't finish confirming your order. Please try again." },
      { status: result.status || 500 }
    );
  }

  if (!result.recorded) {
    return respond.json(
      {
        ok: true,
        recorded: false,
        paymentStatus: result.paymentStatus || ""
      },
      { status: result.status || 202 }
    );
  }

  return respond.json({
    ok: true,
    recorded: true,
    orderId: result.orderId || "",
    fulfillment: result.fulfillment || "",
    shippingOptionLabel: result.shippingOptionLabel || "",
    shippingEstimate: result.shippingEstimate || "",
    automationWarnings: Array.isArray(result.automationWarnings)
      ? result.automationWarnings
      : []
  });
}
