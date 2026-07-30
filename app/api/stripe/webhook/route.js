import { securePublicRoute } from "@/lib/apiSecurity";
import { maybeSendCustomerConfirmationEmail } from "@/lib/orderConfirmationDispatch";
import { getAssignedPickupDateKey } from "@/lib/pickupDetails";
import {
  getShippingOptionsForCart,
  inferSelectedShippingOption,
  normalizeProductType
} from "@/lib/shippingPricing";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import {
  stripeConfig,
  stripeRequest,
  verifyStripeSignature
} from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isFinancialTestCharge } from "@/lib/testOrders";

export const runtime = "nodejs";

const STRIPE_WEBHOOK_RATE_LIMIT = getRouteRateLimitConfig("STRIPE_WEBHOOK_POST", {
  windowMs: 60_000,
  ipMax: 600
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

const resolveLatestCharge = async (source) => {
  const embeddedCharge =
    (typeof source?.latest_charge === "object" ? source.latest_charge : null) ||
    (typeof source?.payment_intent?.latest_charge === "object"
      ? source.payment_intent.latest_charge
      : null) ||
    (Array.isArray(source?.charges?.data) ? source.charges.data[0] : null);
  if (embeddedCharge) return embeddedCharge;

  const paymentIntentId = toText(
    source?.object === "payment_intent"
      ? source?.id
      : typeof source?.payment_intent === "string"
        ? source.payment_intent
        : source?.payment_intent?.id,
    255
  );
  if (!paymentIntentId) return {};

  const { ok, data, error } = await stripeRequest(
    `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}?expand[]=latest_charge`,
    { method: "GET" }
  );
  if (!ok) {
    console.error("stripe payment charge fetch error:", error);
    return {};
  }

  return typeof data?.latest_charge === "object" ? data.latest_charge : {};
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
  if (!orderId) return null;

  const { error } = await supabaseAdmin.rpc("sync_shipment_for_order", {
    p_order_id: orderId
  });

  return error;
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

  const shipmentError = await syncShipmentForOrder(orderId);
  if (shipmentError) {
    console.error("sync_shipment_for_order error:", shipmentError);
    return {
      ok: false,
      error: "Unable to sync shipment.",
      status: 500
    };
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

const handleCheckoutSessionEvent = async (session, eventType, eventPlacedAt = "") => {
  const isPaid =
    session?.payment_status === "paid" ||
    eventType === "checkout.session.async_payment_succeeded";
  if (!isPaid) {
    return { ok: true };
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
  const latestCharge = await resolveLatestCharge(session);

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
  const receiptNumber = getChargeReceiptNumber(latestCharge);
  const paymentMethodLabel =
    getChargePaymentMethodLabel(latestCharge) || getFallbackPaymentMethodLabel(session);
  const paymentSessionId = toText(session?.id, 255);
  const paymentReference = toText(
    typeof session?.payment_intent === "string"
      ? session.payment_intent
      : session?.payment_intent?.id,
    255
  );
  const placedAt =
    eventPlacedAt ||
    (typeof session?.created === "number"
      ? new Date(session.created * 1000).toISOString()
      : "");

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
    isTestOrder: isFinancialTestCharge(latestCharge)
  });

  if (recordResult.error) {
    console.error("record_paid_order error:", recordResult.error);
    return {
      ok: false,
      error: "We couldn't save the paid order.",
      status: 500
    };
  }

  return runOrderSideEffects({
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
    strictConfirmationEmailAutomation: true
  });
};

const handlePaymentIntentSucceeded = async (intent, eventPlacedAt = "") => {
  if (!intent || intent.object !== "payment_intent") {
    return { ok: true };
  }

  const metadata = intent?.metadata || {};
  if (metadata.checkout_flow === "checkout_session") {
    return { ok: true };
  }

  const items = parseItemsFromMetadata(intent);

  if (!Array.isArray(items) || items.length === 0) {
    console.error("Missing line items for PaymentIntent:", intent?.id);
    return { ok: false, error: "Missing line items.", status: 400 };
  }

  const shippingDetails = intent?.shipping || {};
  const shippingAddress = shippingDetails?.address || {};
  const latestCharge = await resolveLatestCharge(intent);
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
    eventPlacedAt ||
    (typeof intent?.created === "number"
      ? new Date(intent.created * 1000).toISOString()
      : "");
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
    isTestOrder: isFinancialTestCharge(latestCharge)
  });

  if (recordResult.error) {
    console.error("record_paid_order error:", recordResult.error);
    return {
      ok: false,
      error: "We couldn't save the paid order.",
      status: 500
    };
  }

  return runOrderSideEffects({
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
    strictConfirmationEmailAutomation: true
  });
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

  const body = await request.text();
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
  const eventPlacedAt =
    typeof event?.created === "number"
      ? new Date(event.created * 1000).toISOString()
      : "";

  if (
    eventType !== "checkout.session.completed" &&
    eventType !== "checkout.session.async_payment_succeeded" &&
    eventType !== "payment_intent.succeeded"
  ) {
    return respond.json({ ok: true });
  }

  if (
    eventType === "checkout.session.completed" ||
    eventType === "checkout.session.async_payment_succeeded"
  ) {
    const session = event?.data?.object;
    if (!session || session.object !== "checkout.session") {
      return respond.json({ ok: true });
    }

    const result = await handleCheckoutSessionEvent(session, eventType, eventPlacedAt);
    if (!result.ok) {
      return respond.json(
        { error: result.error || "We couldn't save the paid order." },
        { status: result.status || 500 }
      );
    }

    return respond.json({ ok: true });
  }

  const intent = event?.data?.object;
  const result = await handlePaymentIntentSucceeded(intent, eventPlacedAt);
  if (!result.ok) {
    return respond.json(
      { error: result.error || "We couldn't save the paid order." },
      { status: result.status || 500 }
    );
  }

  return respond.json({ ok: true });
}
