import { secureAdminRoute } from "@/lib/apiSecurity";
import {
  MARKET_TIMEZONE,
  formatMarketDate,
  getPickupDetails,
  getPrepSheetWeekInfo
} from "@/lib/pickupDetails";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const LOOKBACK_DAYS = 21;

const ADMIN_PREP_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_PREP_GET", {
  windowMs: 60_000,
  ipMax: 120,
  userMax: 90
});

const ADMIN_PREP_ROLES = ["admin", "ops_admin"];

const toQty = (value) => {
  const qty = Number.parseInt(value, 10);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
};

const normalizeSku = (value) => String(value || "").trim().toUpperCase();

export const runtime = "nodejs";

export async function GET(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:prep:get",
    requiredRoles: ADMIN_PREP_ROLES,
    rateLimit: ADMIN_PREP_RATE_LIMIT,
    rateLimitExceededMessage: "Too many prep requests. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const timezone = MARKET_TIMEZONE;
  const now = new Date();
  const weekInfo = getPrepSheetWeekInfo(timezone, now);
  const pickup = {
    ...getPickupDetails({ timeZone: timezone, now }),
    market_date: weekInfo.market_date,
    market_date_label: formatMarketDate(weekInfo.market_date, timezone)
  };
  const lookback = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

  const [productsResult, itemsResult] = await Promise.all([
    supabaseAdmin
      .from("products")
      .select("sku, name, sort_order, active")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("order_items")
      .select("sku, quantity, preorder_qty, orders!inner(fulfillment, created_at, status)")
      .gte("orders.created_at", lookback.toISOString())
      .eq("orders.status", "paid")
  ]);

  if (productsResult.error) {
    console.error("prep products read error:", productsResult.error);
    return respond.json(
      { error: "Unable to read products." },
      { status: 500 }
    );
  }

  if (itemsResult.error) {
    console.error("prep order_items read error:", itemsResult.error);
    return respond.json(
      { error: "Unable to read order items." },
      { status: 500 }
    );
  }

  const countsBySku = new Map();
  const collectionStartMs = Date.parse(weekInfo.collection_start_at || "");
  const collectionEndMs = Date.parse(weekInfo.collection_end_at || "");

  for (const row of itemsResult.data || []) {
    const sku = normalizeSku(row?.sku);
    const quantity = toQty(row?.quantity);
    if (!sku || quantity <= 0) continue;

    const orderData = Array.isArray(row?.orders) ? row.orders[0] : row?.orders;
    const createdAt = orderData?.created_at ? new Date(orderData.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;

    const createdAtMs = createdAt.getTime();
    if (Number.isFinite(collectionStartMs) && createdAtMs < collectionStartMs) continue;
    if (Number.isFinite(collectionEndMs) && createdAtMs >= collectionEndMs) continue;

    const fulfillment = orderData?.fulfillment === "market" ? "market" : "ship";
    const preorderQty = toQty(row?.preorder_qty);
    const current = countsBySku.get(sku) || {
      shipping_qty: 0,
      market_qty: 0,
      preorder_qty: 0
    };

    if (fulfillment === "market") {
      current.market_qty += quantity;
    } else {
      current.shipping_qty += quantity;
    }
    current.preorder_qty += preorderQty;

    countsBySku.set(sku, current);
  }

  const prepRows = [];
  const productMap = new Map();

  for (const product of productsResult.data || []) {
    const sku = normalizeSku(product?.sku);
    if (!sku) continue;

    productMap.set(sku, true);
    const counts = countsBySku.get(sku) || {
      shipping_qty: 0,
      market_qty: 0,
      preorder_qty: 0
    };
    const totalQty = counts.shipping_qty + counts.market_qty;
    if (totalQty <= 0) continue;

    prepRows.push({
      sku,
      name: String(product?.name || sku),
      shipping_qty: counts.shipping_qty,
      market_qty: counts.market_qty,
      preorder_qty: counts.preorder_qty,
      total_qty: totalQty
    });
  }

  const unknownSkus = [...countsBySku.keys()]
    .filter((sku) => !productMap.has(sku))
    .sort();

  for (const sku of unknownSkus) {
    const counts = countsBySku.get(sku) || {
      shipping_qty: 0,
      market_qty: 0,
      preorder_qty: 0
    };
    if (productMap.has(sku)) continue;

    const totalQty = counts.shipping_qty + counts.market_qty;
    if (totalQty <= 0) continue;

    prepRows.push({
      sku,
      name: sku,
      shipping_qty: counts.shipping_qty,
      market_qty: counts.market_qty,
      preorder_qty: counts.preorder_qty,
      total_qty: totalQty
    });
  }

  return respond.json({
    week: weekInfo,
    pickup,
    timezone,
    prep: prepRows
  });
}
