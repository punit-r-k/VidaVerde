import { securePublicRoute } from "@/lib/apiSecurity";
import { maybeSendCustomerConfirmationEmail } from "@/lib/orderConfirmationDispatch";
import { getAssignedPickupDateKey } from "@/lib/pickupDetails";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { stripeConfig, stripeRequest } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

const ORDER_FINALIZE_RATE_LIMIT = getRouteRateLimitConfig("ORDER_FINALIZE_POST", {
  windowMs: 60_000,
  ipMax: 30
});

const payloadSchema = z
  .object({
    paymentIntentId: z
      .string()
      .trim()
      .min(1, "Payment intent is required.")
      .max(255, "Payment intent is invalid.")
      .regex(/^pi_[A-Za-z0-9_]+$/, "Payment intent is invalid.")
  })
  .strict();

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

const buildInventoryShiftWarning = (orderItems, expectedPreorderMap) => {
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

  return {
    code: "inventory_shifted_to_preorder",
    customerMessage: `Your payment was received and the order is confirmed. While payment was processing, live inventory changed and some items moved to preorder: ${itemSummary}${hasMoreItems ? ", plus additional items" : ""}. Your confirmation reflects the updated pickup and preorder split.`,
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
  customer,
  items,
  placedAt
}) => {
  const pickupDate = getAssignedPickupDateKey({
    fulfillment,
    placedAt
  });
  const customerPayload = {
    ...(customer || {}),
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

const finalizePaymentIntent = async (intent) => {
  if (!intent || intent.object !== "payment_intent") {
    return { ok: false, error: "Payment intent is invalid.", status: 400 };
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

  const total = Number(intent?.amount_received || intent?.amount || 0);
  const subtotal = Number(intent?.amount || 0);
  const tax = 0;
  const shipping = 0;
  const paymentSessionId = toText(intent?.id, 255);
  const paymentReference = toText(
    typeof intent?.latest_charge === "string" ? intent.latest_charge : latestCharge?.id,
    255
  );
  const placedAt =
    typeof intent?.created === "number"
      ? new Date(intent.created * 1000).toISOString()
      : "";

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
    items,
    placedAt
  });

  if (recordResult.error) {
    console.error("record_paid_order error:", recordResult.error);
    return {
      ok: false,
      error: "Unable to record order.",
      status: 500
    };
  }

  const expectedPreorderMap = parseExpectedPreorderMap(intent);
  const recordedOrderItems = await getRecordedOrderItems(recordResult.orderId);
  const inventoryShiftWarning = buildInventoryShiftWarning(
    recordedOrderItems,
    expectedPreorderMap
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
    customer,
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

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json({ error: "Invalid payload." }, { status: 400 });
  }

  const parsedPayload = payloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return respond.json(
      { error: parsedPayload.error.issues[0]?.message || "Invalid payload." },
      { status: 400 }
    );
  }

  const paymentIntentId = parsedPayload.data.paymentIntentId;
  const stripePath =
    `/v1/payment_intents/${encodeURIComponent(paymentIntentId)}` +
    "?expand[]=latest_charge&expand[]=charges.data";
  const { ok, data, error } = await stripeRequest(stripePath, {
    method: "GET"
  });

  if (!ok) {
    console.error("stripe payment_intent verify error:", error);
    return respond.json(
      { error: "Unable to verify payment." },
      { status: 502 }
    );
  }

  const result = await finalizePaymentIntent(data);
  if (!result.ok) {
    return respond.json(
      { error: result.error || "Unable to finalize order." },
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
    automationWarnings: Array.isArray(result.automationWarnings)
      ? result.automationWarnings
      : []
  });
}
