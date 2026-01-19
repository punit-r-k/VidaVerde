import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  if (!stripe) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 500 }
    );
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json(
      { error: "Missing Stripe signature." },
      { status: 400 }
    );
  }

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    return NextResponse.json(
      { error: "Stripe webhook secret is not configured." },
      { status: 500 }
    );
  }

  let event;
  const body = await request.text();

  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (error) {
    console.error("stripe webhook signature error:", error);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    if (session.payment_status !== "paid") {
      return NextResponse.json({ ok: true });
    }

    if (!supabaseAdmin) {
      console.error("Supabase is not configured.");
      return NextResponse.json(
        { error: "Supabase is not configured." },
        { status: 500 }
      );
    }

    const metadata = session.metadata || {};
    let items = [];

    try {
      items = JSON.parse(metadata.items || "[]");
    } catch {
      items = [];
    }

    if (!Array.isArray(items) || items.length === 0) {
      try {
        const lineItems = await stripe.checkout.sessions.listLineItems(
          session.id,
          { limit: 100, expand: ["data.price.product"] }
        );

        items = (lineItems.data || [])
          .map((item) => {
            const sku = item.price?.product?.metadata?.sku;
            if (!sku) return null;

            return {
              sku,
              quantity: item.quantity || 0,
              price_cents: item.price?.unit_amount || 0
            };
          })
          .filter(Boolean);
      } catch (error) {
        console.error("stripe line item fallback error:", error);
      }
    }

    if (!Array.isArray(items) || items.length === 0) {
      console.error("Missing line items for session:", session.id);
      return NextResponse.json({ error: "Missing line items." }, { status: 400 });
    }

    const shippingAddress = session.shipping_details?.address || {};
    const customerDetails = session.customer_details || {};

    const customer = {
      name: metadata.customer_name || customerDetails.name || "",
      email: metadata.customer_email || customerDetails.email || "",
      phone: metadata.customer_phone || customerDetails.phone || "",
      address1: metadata.address1 || shippingAddress.line1 || "",
      address2: metadata.address2 || shippingAddress.line2 || "",
      city: metadata.city || shippingAddress.city || "",
      state: metadata.state || shippingAddress.state || "",
      postal_code: metadata.postal_code || shippingAddress.postal_code || "",
      note: metadata.note || ""
    };

    const { error } = await supabaseAdmin.rpc("record_paid_order", {
      p_session_id: session.id,
      p_payment_intent: session.payment_intent || "",
      p_fulfillment: metadata.fulfillment || "ship",
      p_currency: session.currency || "usd",
      p_amount_subtotal: session.amount_subtotal || 0,
      p_amount_tax: session.total_details?.amount_tax || 0,
      p_amount_shipping: session.total_details?.amount_shipping || 0,
      p_amount_total: session.amount_total || 0,
      p_customer: customer,
      p_items: items
    });

    if (error) {
      console.error("record_paid_order error:", error);
      return NextResponse.json(
        { error: "Unable to record order." },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}
