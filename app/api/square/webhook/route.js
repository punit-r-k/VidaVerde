import crypto from "crypto";
import { NextResponse } from "next/server";
import { squareConfig, squareRequest } from "@/lib/square";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const timingSafeEqual = (a, b) => {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

const parseSquareItems = (order) => {
  const metadataItems = order?.metadata?.items;
  if (metadataItems) {
    try {
      const parsed = JSON.parse(metadataItems);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      // fall through to line items.
    }
  }

  return (order?.line_items || [])
    .map((item) => ({
      sku: String(item?.name || "").trim(),
      quantity: Number.parseInt(item?.quantity, 10) || 0,
      price_cents: item?.base_price_money?.amount || 0
    }))
    .filter((item) => item.sku && item.quantity > 0);
};

export async function POST(request) {
  if (!squareConfig) {
    return NextResponse.json(
      { error: "Square is not configured." },
      { status: 500 }
    );
  }

  const signature = request.headers.get("x-square-signature");
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  const webhookUrl = process.env.SQUARE_WEBHOOK_URL;

  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  if (!signatureKey || !webhookUrl) {
    return NextResponse.json(
      { error: "Square webhook signature is not configured." },
      { status: 500 }
    );
  }

  const body = await request.text();
  const expected = crypto
    .createHmac("sha256", signatureKey)
    .update(webhookUrl + body)
    .digest("base64");

  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");

  if (!timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  let event = null;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const payment = event?.data?.object?.payment;
  if (!payment) {
    return NextResponse.json({ ok: true });
  }

  if (payment.status !== "COMPLETED") {
    return NextResponse.json({ ok: true });
  }

  if (!supabaseAdmin) {
    console.error("Supabase is not configured.");
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const orderId = payment.order_id || payment.order_ids?.[0];
  if (!orderId) {
    console.error("Square payment missing order id:", payment.id);
    return NextResponse.json({ ok: true });
  }

  const { ok, data, error } = await squareRequest(`/v2/orders/${orderId}`);
  if (!ok) {
    console.error("square order fetch error:", error);
    return NextResponse.json({ error: "Unable to read order." }, { status: 500 });
  }

  const order = data?.order;
  const items = parseSquareItems(order);

  if (!Array.isArray(items) || items.length === 0) {
    console.error("Missing line items for Square order:", orderId);
    return NextResponse.json({ error: "Missing line items." }, { status: 400 });
  }

  const metadata = order?.metadata || {};
  const customer = {
    name: metadata.customer_name || "",
    email: metadata.customer_email || payment?.buyer_email_address || "",
    phone: metadata.customer_phone || "",
    address1: metadata.address1 || "",
    address2: metadata.address2 || "",
    city: metadata.city || "",
    state: metadata.state || "",
    postal_code: metadata.postal_code || "",
    note: metadata.note || ""
  };

  const subtotal = order?.total_money?.amount || 0;
  const tax = order?.total_tax_money?.amount || 0;
  const shipping = order?.total_service_charge_money?.amount || 0;
  const total = order?.total_money?.amount || payment?.amount_money?.amount || 0;

  const { error: recordError } = await supabaseAdmin.rpc("record_paid_order", {
    p_session_id: payment.id,
    p_payment_reference: payment.id,
    p_payment_provider: "square",
    p_fulfillment: metadata.fulfillment || "ship",
    p_currency: payment?.amount_money?.currency || "USD",
    p_amount_subtotal: subtotal,
    p_amount_tax: tax,
    p_amount_shipping: shipping,
    p_amount_total: total,
    p_customer: customer,
    p_items: items
  });

  if (recordError) {
    console.error("record_paid_order error:", recordError);
    return NextResponse.json(
      { error: "Unable to record order." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
