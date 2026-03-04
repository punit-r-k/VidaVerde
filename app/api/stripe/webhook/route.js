import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  stripeConfig,
  stripeRequest,
  verifyStripeSignature
} from "@/lib/stripe";

export const runtime = "nodejs";

const parseItemsFromMetadata = (session) => {
  const raw = session?.metadata?.items;
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

export async function POST(request) {
  if (!stripeConfig) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 500 }
    );
  }

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const signatureHeader = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signatureHeader) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  if (!webhookSecret) {
    return NextResponse.json(
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
    return NextResponse.json({ error: verification.error }, { status: 400 });
  }

  let event;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const eventType = String(event?.type || "");
  if (
    eventType !== "checkout.session.completed" &&
    eventType !== "checkout.session.async_payment_succeeded"
  ) {
    return NextResponse.json({ ok: true });
  }

  const session = event?.data?.object;
  if (!session || session.object !== "checkout.session") {
    return NextResponse.json({ ok: true });
  }

  const isPaid =
    session?.payment_status === "paid" ||
    eventType === "checkout.session.async_payment_succeeded";
  if (!isPaid) {
    return NextResponse.json({ ok: true });
  }

  let items = parseItemsFromMetadata(session);
  if (items.length === 0) {
    const { ok, data, error } = await stripeRequest(
      `/v1/checkout/sessions/${session.id}/line_items?limit=100&expand[]=data.price.product`,
      { method: "GET" }
    );

    if (!ok) {
      console.error("stripe line items fetch error:", error);
      return NextResponse.json(
        { error: "Unable to read line items." },
        { status: 500 }
      );
    }

    items = parseItemsFromStripeLineItems(data?.data || []);
  }

  if (!Array.isArray(items) || items.length === 0) {
    console.error("Missing line items for Stripe session:", session?.id);
    return NextResponse.json({ error: "Missing line items." }, { status: 400 });
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
  const paymentSessionId = toText(session?.id, 255);
  const paymentReference =
    typeof session?.payment_intent === "string" ? session.payment_intent : "";

  const { error: recordError } = await supabaseAdmin.rpc("record_paid_order", {
    p_session_id: paymentSessionId,
    p_payment_reference: paymentReference,
    p_payment_provider: "stripe",
    p_fulfillment: toFulfillment(metadata.fulfillment),
    p_currency: String(session?.currency || "usd").toUpperCase(),
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
