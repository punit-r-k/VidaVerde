import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const requireSecret = (request) => {
  const secret = request.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_RESTOCK_SECRET;
};

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toUpperText = (value, fallback = "") => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || fallback;
};

const normalizeFulfillment = (value) => (value === "market" ? "market" : "ship");

export const runtime = "nodejs";

export async function GET(request) {
  if (!requireSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const requestedLimit = toInt(searchParams.get("limit"), 500);
  const limit = Math.min(Math.max(requestedLimit, 1), 2000);
  const status = String(searchParams.get("status") || "").trim();
  const fulfillmentFilter = String(searchParams.get("fulfillment") || "").trim();
  const fulfillment =
    fulfillmentFilter === "market" || fulfillmentFilter === "ship"
      ? fulfillmentFilter
      : "";

  let ordersQuery = supabaseAdmin
    .from("orders")
    .select(
      "id, payment_session_id, payment_reference, payment_provider, status, fulfillment, customer_name, customer_email, customer_phone, address1, address2, city, state, postal_code, note, currency, amount_subtotal, amount_tax, amount_shipping, amount_total, created_at"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    ordersQuery = ordersQuery.eq("status", status);
  }

  if (fulfillment) {
    ordersQuery = ordersQuery.eq("fulfillment", fulfillment);
  }

  const { data: ordersData, error: ordersError } = await ordersQuery;
  if (ordersError) {
    console.error("orders admin read error:", ordersError);
    return NextResponse.json(
      { error: "Unable to read orders." },
      { status: 500 }
    );
  }

  const orderIds = (ordersData || []).map((row) => String(row.id || "")).filter(Boolean);
  let itemsByOrderId = new Map();

  if (orderIds.length > 0) {
    const { data: itemsData, error: itemsError } = await supabaseAdmin
      .from("order_items")
      .select("order_id, sku, quantity, price_cents, products(name)")
      .in("order_id", orderIds)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true });

    if (itemsError) {
      console.error("orders admin items read error:", itemsError);
      return NextResponse.json(
        { error: "Unable to read order items." },
        { status: 500 }
      );
    }

    itemsByOrderId = (itemsData || []).reduce((acc, row) => {
      const orderId = String(row?.order_id || "");
      if (!orderId) return acc;

      const quantity = toInt(row?.quantity, 0);
      if (quantity <= 0) return acc;

      const product = Array.isArray(row?.products) ? row.products[0] : row?.products;
      const sku = toUpperText(row?.sku);
      const name = String(product?.name || "").trim() || sku;

      const current = acc.get(orderId) || [];
      current.push({
        sku,
        name,
        quantity,
        price_cents: toInt(row?.price_cents, 0),
        line_total_cents: quantity * toInt(row?.price_cents, 0)
      });
      acc.set(orderId, current);
      return acc;
    }, new Map());
  }

  const orders = (ordersData || []).map((row) => {
    const orderId = String(row.id || "");
    const items = itemsByOrderId.get(orderId) || [];
    const itemCount = items.reduce((sum, item) => sum + toInt(item.quantity, 0), 0);
    const itemsSummary = items
      .map((item) => `${item.name} x${item.quantity}`)
      .join(", ");

    return {
      id: orderId,
      payment_session_id: String(row.payment_session_id || ""),
      payment_reference: String(row.payment_reference || ""),
      payment_provider: String(row.payment_provider || "stripe"),
      status: String(row.status || "paid"),
      fulfillment: normalizeFulfillment(row.fulfillment),
      customer_name: String(row.customer_name || ""),
      customer_email: String(row.customer_email || ""),
      customer_phone: String(row.customer_phone || ""),
      address1: String(row.address1 || ""),
      address2: String(row.address2 || ""),
      city: String(row.city || ""),
      state: toUpperText(row.state, ""),
      postal_code: String(row.postal_code || ""),
      note: String(row.note || ""),
      currency: toUpperText(row.currency, "USD"),
      amount_subtotal: toInt(row.amount_subtotal, 0),
      amount_tax: toInt(row.amount_tax, 0),
      amount_shipping: toInt(row.amount_shipping, 0),
      amount_total: toInt(row.amount_total, 0),
      item_count: itemCount,
      items_summary: itemsSummary,
      items_json: items,
      created_at: row.created_at
    };
  });

  return NextResponse.json({
    orders
  });
}
