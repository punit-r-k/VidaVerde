import { securePublicRoute } from "@/lib/apiSecurity";
import { maybeSendCustomerConfirmationEmail } from "@/lib/orderConfirmationDispatch";
import { getAssignedPickupDateKey } from "@/lib/pickupDetails";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { autoPurchaseFastestShippingLabels } from "@/lib/shipmentLabelAutomation";
import {
  getShippingOptionsForCart,
  inferSelectedShippingOption,
  normalizeProductType
} from "@/lib/shippingPricing";
import { stripeConfig, stripeRequest } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFinancialTestOrder } from "@/lib/testOrders";
import { z } from "zod";

const ORDER_FINALIZE_RATE_LIMIT = getRouteRateLimitConfig("ORDER_FINALIZE_POST", {
  windowMs: 60_000,
  ipMax: 30
});

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
    sessionId: optionalStripeIdSchema({
      pattern: /^cs_[A-Za-z0-9_]+$/,
      message: "That checkout session looks invalid. Please try checking out again."
    })
  })
  .strict()
  .superRefine((payload, context) => {
    if (payload.paymentIntentId || payload.sessionId) return;

    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["sessionId"],
      message: "We couldn't find that payment. Please try checking out again."
    });
  });

const parseItemsFromMetadata = (source) => {
  const raw = source?.metadata?.items;
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item) => ({
        sku: String(item?.sku || "").trim().toUpperCase(),
        quantity: Number.parseInt(item?.quantity, 10) || 0,
        price_cents: Number.parseInt(item?.price_cents, 10) || 0,
        product_type: normalizeProductType(item?.product_type, item?.sku)
      }))
      .filter((item) => item.sku && item.quantity > 0);
  } catch {
    return [];
  }
};

const parseItemsFromStripeLineItems = (lineItems) =>
  (lineItems || [])
    .map((item) => {
      const quantity = Number.parseInt(item?.quantity, 10) || 0;
      const product = item?.price?.product;
      const sku =
        (typeof product === "object" && String(product?.metadata?.sku || "").trim()) ||
        String(item?.price?.metadata?.sku || "").trim();
      const unitAmount = Number(item?.price?.unit_amount || 0);
      const inferredUnitAmount =
        quantity > 0 ? Math.round(Number(item?.amount_subtotal || 0) / quantity) : 0;

      return {
        sku: sku.toUpperCase(),
        quantity,
        price_cents: unitAmount > 0 ? unitAmount : inferredUnitAmount,
        product_type: normalizeProductType(
          typeof product === "object" ? product?.metadata?.product_type : "",
          sku
        )
      };
    })
    .filter((item) => item.sku && item.quantity > 0);

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

const getStripeShippingRateMetadata = async (shippingRateId) => {
  const normalizedId = toText(shippingRateId, 255);
  if (!normalizedId) return {};

  const { ok, data, error } = await stripeRequest(
    `/v1/shipping_rates/${encodeURIComponent(normalizedId)}`,
    { method: "GET" }
  );

  if (!ok) {
    console.error("stripe shipping rate fetch error:", error);
    return {};
  }

  return data?.metadata && typeof data.metadata === "object" ? data.metadata : {};
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
  isTestOrder = false
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

  const { data: orderId, error: recordError } = await supabaseAdmin.rpc("record_paid_order", {
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
    p_items: items
  });

  let testOrderError = null;
  if (!recordError && isTestOrder && typeof orderId === "string") {
    const { error } = await supabaseAdmin
      .from("orders")
      .update({ is_test_order: true })
      .eq("id", orderId);
    testOrderError = error;
  }

  return {
    orderId: typeof orderId === "string" ? orderId : null,
    error: recordError || testOrderError
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
  if (metadata.checkout_flow === "checkout_session") {
    return {
      ok: true,
      recorded: false,
      paymentStatus,
      status: 202
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
    email: toText(
      metadata.customer_email || intent?.receipt_email || billing?.email,
      254
    ),
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

  const total = toNonNegativeInteger(intent?.amount_received || intent?.amount || 0);
  const shipping = toNonNegativeInteger(metadata.amount_shipping);
  const subtotalFromMetadata = toNonNegativeInteger(metadata.amount_subtotal);
  const subtotal =
    subtotalFromMetadata > 0
      ? subtotalFromMetadata
      : Math.max(total - shipping, 0);
  const tax = 0;
  const paymentSessionId = toText(intent?.id, 255);
  const paymentReference = toText(
    typeof intent?.latest_charge === "string" ? intent.latest_charge : latestCharge?.id,
    255
  );
  const placedAt =
    typeof intent?.created === "number"
      ? new Date(intent.created * 1000).toISOString()
      : "";
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
    currency: String(intent?.currency || "usd").toUpperCase(),
    subtotal,
    tax,
    shipping,
    total,
    shippingRecordDetails,
    customer,
    items,
    placedAt,
    isTestOrder: isFinancialTestOrder({ charge: latestCharge, customer })
  });

  if (recordResult.error) {
    console.error("record_paid_order error:", recordResult.error);
    return {
      ok: false,
      error: "We couldn't save your order after payment.",
      status: 500
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
    currency: String(intent?.currency || "usd").toUpperCase(),
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

  return {
    ok: true,
    recorded: true,
    paymentStatus,
    orderId: recordResult.orderId,
    fulfillment: toFulfillment(metadata.fulfillment),
    customerEmail: customer.email,
    shippingOptionLabel: shippingRecordDetails.shipping_option_label,
    shippingEstimate: shippingRecordDetails.shipping_estimate,
    automationWarnings: [
      ...(inventoryShiftWarning ? [inventoryShiftWarning] : []),
      ...(Array.isArray(sideEffectsResult?.automationWarnings)
        ? sideEffectsResult.automationWarnings
        : [])
    ]
  };
};

const finalizeCheckoutSession = async (session) => {
  if (!session || session.object !== "checkout.session") {
    return {
      ok: false,
      error: "That checkout session looks invalid. Please try checking out again.",
      status: 400
    };
  }

  const paymentStatus = toText(session?.payment_status, 64).toLowerCase();
  if (paymentStatus !== "paid") {
    return {
      ok: true,
      recorded: false,
      paymentStatus,
      status: 202
    };
  }

  let items = parseItemsFromMetadata(session);
  if (items.length === 0) {
    const { ok, data, error } = await stripeRequest(
      `/v1/checkout/sessions/${session.id}/line_items?limit=100&expand[]=data.price.product`,
      { method: "GET" }
    );

    if (!ok) {
      console.error("stripe line items fetch error:", error);
      return {
        ok: false,
        error: "We couldn't read the order items from Stripe.",
        status: 500
      };
    }

    items = parseItemsFromStripeLineItems(data?.data || []);
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.error("Missing line items for Stripe session:", session?.id);
    return { ok: false, error: "Missing line items.", status: 400 };
  }

  const metadata = session?.metadata || {};
  const customerDetails = session?.customer_details || {};
  const shippingDetails = session?.shipping_details || {};
  const customerAddress = shippingDetails?.address || customerDetails?.address || {};
  const paymentIntent =
    typeof session?.payment_intent === "object" ? session.payment_intent : {};
  const latestCharge =
    typeof paymentIntent?.latest_charge === "object"
      ? paymentIntent.latest_charge
      : {};
  const receiptNumber = getChargeReceiptNumber(latestCharge);
  const paymentMethodLabel =
    getChargePaymentMethodLabel(latestCharge) || getFallbackPaymentMethodLabel(session);

  const customer = {
    name: toText(shippingDetails?.name || metadata.customer_name || customerDetails?.name, 120),
    email: toText(metadata.customer_email || customerDetails?.email, 254),
    phone: toText(shippingDetails?.phone || metadata.customer_phone || customerDetails?.phone, 64),
    address1: toText(customerAddress?.line1 || metadata.address1, 120),
    address2: toText(customerAddress?.line2 || metadata.address2, 120),
    city: toText(customerAddress?.city || metadata.city, 120),
    state: toText(customerAddress?.state || metadata.state, 64),
    postal_code: toText(customerAddress?.postal_code || metadata.postal_code, 32),
    note: toText(metadata.note, 500)
  };

  const totalFromSession = toNonNegativeInteger(session?.amount_total || 0);
  const totalFromMetadata = toNonNegativeInteger(metadata.amount_total);
  const total = totalFromSession > 0 ? totalFromSession : totalFromMetadata;
  const hasStripeShippingCost =
    Boolean(session?.shipping_cost) ||
    session?.total_details?.amount_shipping !== undefined;
  const shippingFromSession = toNonNegativeInteger(
    session?.shipping_cost?.amount_total ?? session?.total_details?.amount_shipping ?? 0
  );
  const shippingFromMetadata = toNonNegativeInteger(metadata.amount_shipping);
  const shipping = hasStripeShippingCost ? shippingFromSession : shippingFromMetadata;
  const subtotalFromMetadata = toNonNegativeInteger(metadata.amount_subtotal);
  const subtotal =
    subtotalFromMetadata > 0 && !hasStripeShippingCost
      ? subtotalFromMetadata
      : toNonNegativeInteger(session?.amount_subtotal || 0);
  const tax = toNonNegativeInteger(session?.total_details?.amount_tax || 0);
  const shippingRateId =
    typeof session?.shipping_cost?.shipping_rate === "string"
      ? session.shipping_cost.shipping_rate
      : "";
  const shippingRateMetadata = await getStripeShippingRateMetadata(shippingRateId);
  const shippingRecordDetails = buildShippingRecordDetails({
    fulfillment: toFulfillment(metadata.fulfillment),
    metadata,
    items,
    subtotal,
    shippingAmount: shipping,
    shippingRateMetadata
  });
  const paymentSessionId = toText(session?.id, 255);
  const paymentReference = toText(
    typeof session?.payment_intent === "string"
      ? session.payment_intent
      : paymentIntent?.id,
    255
  );
  const placedAt =
    typeof session?.created === "number"
      ? new Date(session.created * 1000).toISOString()
      : "";

  const recordResult = await recordPaidOrder({
    paymentSessionId,
    paymentReference,
    fulfillment: toFulfillment(metadata.fulfillment),
    currency: String(session?.currency || "usd").toUpperCase(),
    subtotal,
    tax,
    shipping,
    total,
    shippingRecordDetails,
    customer,
    items,
    placedAt,
    isTestOrder: isFinancialTestOrder({ charge: latestCharge, customer })
  });

  if (recordResult.error) {
    console.error("record_paid_order error:", recordResult.error);
    return {
      ok: false,
      error: "We couldn't save your order after payment.",
      status: 500
    };
  }

  const expectedPreorderMap = parseExpectedPreorderMap(session);
  const recordedOrderItems = await getRecordedOrderItems(recordResult.orderId);
  const inventoryShiftWarning = buildInventoryShiftWarning(
    recordedOrderItems,
    expectedPreorderMap,
    metadata.fulfillment
  );

  const sideEffectsResult = await runOrderSideEffects({
    orderId: recordResult.orderId,
    fulfillment: toFulfillment(metadata.fulfillment),
    currency: String(session?.currency || "usd").toUpperCase(),
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

  return {
    ok: true,
    recorded: true,
    paymentStatus,
    orderId: recordResult.orderId,
    fulfillment: toFulfillment(metadata.fulfillment),
    customerEmail: customer.email,
    shippingOptionLabel: shippingRecordDetails.shipping_option_label,
    shippingEstimate: shippingRecordDetails.shipping_estimate,
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

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json(
      { error: "We couldn't read that payment confirmation. Please try again." },
      { status: 400 }
    );
  }

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
  const sessionId = parsedPayload.data.sessionId;
  const stripePath = sessionId
    ? `/v1/checkout/sessions/${encodeURIComponent(sessionId)}` +
      "?expand[]=payment_intent.latest_charge"
    : `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}` +
      "?expand[]=latest_charge&expand[]=charges.data";
  const { ok, data, error } = await stripeRequest(stripePath, {
    method: "GET"
  });

  if (!ok) {
    console.error(
      sessionId ? "stripe checkout_session verify error:" : "stripe payment_intent verify error:",
      error
    );
    return respond.json(
      { error: "We couldn't confirm the payment yet. Please wait a moment and try again." },
      { status: 502 }
    );
  }

  const result = sessionId
    ? await finalizeCheckoutSession(data)
    : await finalizePaymentIntent(data);
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
    customerEmail: result.customerEmail || "",
    shippingOptionLabel: result.shippingOptionLabel || "",
    shippingEstimate: result.shippingEstimate || "",
    automationWarnings: Array.isArray(result.automationWarnings)
      ? result.automationWarnings
      : []
  });
}
