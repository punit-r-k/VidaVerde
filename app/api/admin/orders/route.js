import { ordersQuerySchema, parseSearchParams } from "@/lib/adminSchemas";
import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ADMIN_ORDERS_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_ORDERS_GET", {
  windowMs: 60_000,
  ipMax: 120,
  userMax: 90
});

const ADMIN_ORDERS_ROLES = ["admin", "ops_admin"];

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
  const security = await secureAdminRoute(request, {
    scope: "admin:orders:get",
    requiredRoles: ADMIN_ORDERS_ROLES,
    rateLimit: ADMIN_ORDERS_RATE_LIMIT,
    rateLimitExceededMessage: "Too many admin order requests. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Orders are not connected right now." },
      { status: 500 }
    );
  }

  const parsedQuery = ordersQuerySchema.safeParse(parseSearchParams(request));
  if (!parsedQuery.success) {
    return respond.json(
      { error: parsedQuery.error.issues[0]?.message || "Please check the order filters and try again." },
      { status: 400 }
    );
  }

  const { limit, status, fulfillment } = parsedQuery.data;

  let ordersQuery = supabaseAdmin
    .from("orders")
    .select(
      "id, payment_session_id, payment_reference, payment_provider, status, fulfillment, customer_name, customer_email, customer_phone, address1, address2, city, state, postal_code, note, currency, amount_subtotal, amount_tax, amount_shipping, amount_total, shipping_tier, shipping_option, shipping_option_label, shipping_estimate, sauerkraut_count, hot_sauce_count, is_test_order, pickup_date, created_at"
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
    return respond.json(
      { error: "We couldn't load orders right now." },
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
      return respond.json(
        { error: "We couldn't load the items for those orders." },
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
      shipping_tier: String(row.shipping_tier || ""),
      shipping_option: String(row.shipping_option || ""),
      shipping_option_label: String(row.shipping_option_label || ""),
      shipping_estimate: String(row.shipping_estimate || ""),
      sauerkraut_count: toInt(row.sauerkraut_count, 0),
      hot_sauce_count: toInt(row.hot_sauce_count, 0),
      is_test_order: row.is_test_order === true,
      pickup_date: String(row.pickup_date || ""),
      item_count: itemCount,
      items_summary: itemsSummary,
      items_json: items,
      created_at: row.created_at
    };
  });

  return respond.json({
    orders
  });
}
