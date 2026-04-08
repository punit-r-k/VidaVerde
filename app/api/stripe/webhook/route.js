import { securePublicRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import {
  stripeConfig,
  stripeRequest,
  verifyStripeSignature
} from "@/lib/stripe";
import { sendOrderConfirmationEmail } from "@/lib/orderConfirmationEmail";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
        price_cents: Number.parseInt(item?.price_cents, 10) || 0
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
        price_cents: unitAmount > 0 ? unitAmount : inferredUnitAmount
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

const recordPaidOrder = async ({
  paymentSessionId,
  paymentReference,
  fulfillment,
  currency,
  subtotal,
  tax,
  shipping,
  total,
  customer,
  items
}) => {
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
    p_customer: customer,
    p_items: items
  });

  return {
    orderId: typeof orderId === "string" ? orderId : null,
    error: recordError
  };
};

const syncShipmentForOrder = async (orderId) => {
  if (!orderId) return null;

  const { error } = await supabaseAdmin.rpc("sync_shipment_for_order", {
    p_order_id: orderId
  });

  return error;
};

const hasCustomerConfirmationEmailBeenSent = async (orderId) => {
  if (!orderId) {
    return { sent: false, error: null };
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .select("customer_confirmation_email_sent_at")
    .eq("id", orderId)
    .maybeSingle();

  return {
    sent: Boolean(data?.customer_confirmation_email_sent_at),
    error
  };
};

const markCustomerConfirmationEmailSent = async (orderId) => {
  if (!orderId) return null;

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      customer_confirmation_email_sent_at: new Date().toISOString()
    })
    .eq("id", orderId)
    .is("customer_confirmation_email_sent_at", null);

  return error;
};

const maybeSendCustomerConfirmationEmail = async ({
  orderId,
  fulfillment,
  currency,
  subtotal,
  tax,
  shipping,
  total,
  receiptNumber,
  paymentMethodLabel,
  customer,
  items
}) => {
  const sentStatus = await hasCustomerConfirmationEmailBeenSent(orderId);
  if (sentStatus.error) {
    console.error(
      "customer confirmation email status check error:",
      sentStatus.error
    );
    return {
      ok: false,
      error: "Unable to check order email status.",
      status: 500
    };
  }

  if (sentStatus.sent) {
    return { ok: true };
  }

  const emailResult = await sendOrderConfirmationEmail({
    orderId,
    fulfillment,
    currency,
    subtotal,
    tax,
    shipping,
    total,
    receiptNumber,
    paymentMethodLabel,
    customer,
    items
  });

  if (emailResult.skipped) {
    return { ok: true };
  }

  if (!emailResult.ok) {
    console.error("order confirmation email error:", emailResult.error);
    return {
      ok: false,
      error: "Unable to send order confirmation email.",
      status: 500
    };
  }

  const markError = await markCustomerConfirmationEmailSent(orderId);
  if (markError) {
    console.error(
      "customer confirmation email sent marker error:",
      markError
    );
  }

  return { ok: true };
};

const runOrderSideEffects = async ({
  orderId,
  fulfillment,
  currency,
  subtotal,
  tax,
  shipping,
  total,
  receiptNumber,
  paymentMethodLabel,
  customer,
  items
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
    receiptNumber,
    paymentMethodLabel,
    customer,
    items
  });
};

const handleCheckoutSessionEvent = async (session, eventType) => {
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
        error: "Unable to read line items.",
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
  const customerAddress = customerDetails?.address || {};

  const customer = {
    name: toText(metadata.customer_name || customerDetails?.name, 120),
    email: toText(metadata.customer_email || customerDetails?.email, 254),
    phone: toText(metadata.customer_phone || customerDetails?.phone, 64),
    address1: toText(metadata.address1 || customerAddress?.line1, 120),
    address2: toText(metadata.address2 || customerAddress?.line2, 120),
    city: toText(metadata.city || customerAddress?.city, 120),
    state: toText(metadata.state || customerAddress?.state, 64),
    postal_code: toText(metadata.postal_code || customerAddress?.postal_code, 32),
    note: toText(metadata.note, 500)
  };

  const total = Number(session?.amount_total || 0);
  const subtotal = Number(session?.amount_subtotal || 0);
  const tax = Number(session?.total_details?.amount_tax || 0);
  const shipping = Number(session?.total_details?.amount_shipping || 0);
  const receiptNumber = "";
  const paymentMethodLabel = getFallbackPaymentMethodLabel(session);
  const paymentSessionId = toText(session?.id, 255);
  const paymentReference =
    typeof session?.payment_intent === "string" ? session.payment_intent : "";

  const recordResult = await recordPaidOrder({
    paymentSessionId,
    paymentReference,
    fulfillment: toFulfillment(metadata.fulfillment),
    currency: String(session?.currency || "usd").toUpperCase(),
    subtotal,
    tax,
    shipping,
    total,
    customer,
    items
  });

  if (recordResult.error) {
    console.error("record_paid_order error:", recordResult.error);
    return {
      ok: false,
      error: "Unable to record order.",
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
    receiptNumber,
    paymentMethodLabel,
    customer,
    items
  });
};

const handlePaymentIntentSucceeded = async (intent) => {
  if (!intent || intent.object !== "payment_intent") {
    return { ok: true };
  }

  const metadata = intent?.metadata || {};
  const items = parseItemsFromMetadata(intent);

  if (!Array.isArray(items) || items.length === 0) {
    console.error("Missing line items for PaymentIntent:", intent?.id);
    return { ok: false, error: "Missing line items.", status: 400 };
  }

  const shippingDetails = intent?.shipping || {};
  const shippingAddress = shippingDetails?.address || {};
  const latestCharge = intent?.charges?.data?.[0] || {};
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

  const total = Number(intent?.amount_received || intent?.amount || 0);
  const subtotal = Number(intent?.amount || 0);
  const tax = 0;
  const shipping = 0;
  const paymentSessionId = toText(intent?.id, 255);
  const paymentReference = toText(intent?.latest_charge, 255);

  const recordResult = await recordPaidOrder({
    paymentSessionId,
    paymentReference,
    fulfillment: toFulfillment(metadata.fulfillment),
    currency: String(intent?.currency || "usd").toUpperCase(),
    subtotal,
    tax,
    shipping,
    total,
    customer,
    items
  });

  if (recordResult.error) {
    console.error("record_paid_order error:", recordResult.error);
    return {
      ok: false,
      error: "Unable to record order.",
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
    receiptNumber,
    paymentMethodLabel,
    customer,
    items
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
      { error: "Stripe is not configured." },
      { status: 500 }
    );
  }

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Supabase is not configured." },
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
      { error: "Stripe webhook secret is not configured." },
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
    return respond.json({ error: "Invalid payload." }, { status: 400 });
  }

  const eventType = String(event?.type || "");

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

    const result = await handleCheckoutSessionEvent(session, eventType);
    if (!result.ok) {
      return respond.json(
        { error: result.error || "Unable to record order." },
        { status: result.status || 500 }
      );
    }

    return respond.json({ ok: true });
  }

  const intent = event?.data?.object;
  const result = await handlePaymentIntentSucceeded(intent);
  if (!result.ok) {
    return respond.json(
      { error: result.error || "Unable to record order." },
      { status: result.status || 500 }
    );
  }

  return respond.json({ ok: true });
}
