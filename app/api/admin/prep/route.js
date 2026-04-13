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
const toText = (value) => String(value || "").trim();
const buildEmptyCounts = () => ({
  shipping_qty: 0,
  market_qty: 0,
  shipping_preorder_qty: 0,
  market_preorder_qty: 0,
  preorder_qty: 0
});
const appendPickupItem = (order, item) => {
  if (!order || !item) return;

  const sku = normalizeSku(item?.sku);
  const name = toText(item?.name) || sku;
  const quantity = toQty(item?.quantity);
  if (!sku || quantity <= 0) return;

  const items = Array.isArray(order.items) ? order.items : [];
  const existing = items.find((entry) => normalizeSku(entry?.sku) === sku);

  if (existing) {
    existing.quantity = toQty(existing.quantity) + quantity;
    if (!toText(existing.name)) {
      existing.name = name;
    }
    return;
  }

  items.push({
    sku,
    name,
    quantity
  });
  order.items = items;
};

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

  const [productsResult, itemsResult, releasedPreordersResult] = await Promise.all([
    supabaseAdmin
      .from("products")
      .select("sku, name, sort_order, active")
      .eq("active", true)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true }),
    supabaseAdmin
      .from("order_items")
      .select(
        "order_id, sku, quantity, preorder_qty, products(name), orders!inner(id, fulfillment, created_at, status, customer_name, customer_email, customer_phone)"
      )
      .gte("orders.created_at", lookback.toISOString())
      .eq("orders.status", "paid"),
    supabaseAdmin
      .from("preorder_release_events")
      .select(
        "order_id, sku, quantity, created_at, products(name), orders!inner(id, fulfillment, status, customer_name, customer_email, customer_phone)"
      )
      .gte("created_at", weekInfo.collection_start_at)
      .lt("created_at", weekInfo.collection_end_at)
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

  if (releasedPreordersResult.error) {
    console.error(
      "prep released preorder read error:",
      releasedPreordersResult.error
    );
    return respond.json(
      { error: "Unable to read released preorders." },
      { status: 500 }
    );
  }

  const countsBySku = new Map();
  const productNameBySku = new Map();
  const releasedPickupOrdersById = new Map();
  const windowedItems = [];
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

    const orderId = toText(orderData?.id || row?.order_id);
    if (!orderId) continue;

    const fulfillment = orderData?.fulfillment === "market" ? "market" : "ship";
    const preorderQty = Math.min(toQty(row?.preorder_qty), quantity);
    const readyQty = Math.max(quantity - preorderQty, 0);
    const productData = Array.isArray(row?.products) ? row.products[0] : row?.products;
    const productName = toText(productData?.name) || sku;
    if (sku) {
      productNameBySku.set(sku, productName);
    }

    windowedItems.push({
      orderId,
      sku,
      quantity,
      preorderQty,
      readyQty,
      fulfillment,
      created_at: orderData?.created_at || null,
      customer_name: toText(orderData?.customer_name),
      customer_email: toText(orderData?.customer_email),
      customer_phone: toText(orderData?.customer_phone),
      product_name: productName
    });
  }

  const pickupOrdersById = new Map();

  for (const item of windowedItems) {
    const current = countsBySku.get(item.sku) || buildEmptyCounts();

    if (item.readyQty > 0) {
      if (item.fulfillment === "market") {
        current.market_qty += item.readyQty;
      } else {
        current.shipping_qty += item.readyQty;
      }
    }

    if (item.preorderQty > 0) {
      if (item.fulfillment === "market") {
        current.market_preorder_qty += item.preorderQty;
      } else {
        current.shipping_preorder_qty += item.preorderQty;
      }
      current.preorder_qty += item.preorderQty;
    }

    countsBySku.set(item.sku, current);

    if (item.fulfillment !== "market" || item.readyQty <= 0) continue;

    const pickupOrder = pickupOrdersById.get(item.orderId) || {
      id: item.orderId,
      created_at: item.created_at,
      customer_name: item.customer_name,
      customer_email: item.customer_email,
      customer_phone: item.customer_phone,
      items: []
    };

    appendPickupItem(pickupOrder, {
      sku: item.sku,
      name: item.product_name,
      quantity: item.readyQty
    });

    pickupOrdersById.set(item.orderId, pickupOrder);
  }

  const releasedPreorders = (releasedPreordersResult.data || []).reduce(
    (acc, row) => {
      const sku = normalizeSku(row?.sku);
      const quantity = toQty(row?.quantity);
      const releasedAt = toText(row?.created_at);
      if (!sku || quantity <= 0 || !releasedAt) return acc;

      const orderData = Array.isArray(row?.orders) ? row.orders[0] : row?.orders;
      const orderId = toText(orderData?.id || row?.order_id);
      if (!orderId) return acc;

      const fulfillment = orderData?.fulfillment === "market" ? "market" : "ship";
      const productData = Array.isArray(row?.products) ? row.products[0] : row?.products;
      const productName = toText(productData?.name) || sku;

      productNameBySku.set(sku, productName);
      acc.push({
        orderId,
        sku,
        quantity,
        created_at: releasedAt,
        fulfillment,
        customer_name: toText(orderData?.customer_name),
        customer_email: toText(orderData?.customer_email),
        customer_phone: toText(orderData?.customer_phone),
        product_name: productName
      });

      const pickupOrder = releasedPickupOrdersById.get(orderId) || {
        id: orderId,
        fulfillment,
        customer_name: toText(orderData?.customer_name),
        customer_email: toText(orderData?.customer_email),
        customer_phone: toText(orderData?.customer_phone),
        created_at: releasedAt,
        items: []
      };
      appendPickupItem(pickupOrder, {
        sku,
        name: productName,
        quantity
      });
      releasedPickupOrdersById.set(orderId, pickupOrder);

      return acc;
    },
    []
  );

  for (const releasedItem of releasedPreorders) {
    const current = countsBySku.get(releasedItem.sku) || buildEmptyCounts();

    if (releasedItem.fulfillment === "market") {
      current.market_qty += releasedItem.quantity;
    } else {
      current.shipping_qty += releasedItem.quantity;
    }

    countsBySku.set(releasedItem.sku, current);
  }

  for (const [orderId, order] of releasedPickupOrdersById.entries()) {
    if (order.fulfillment !== "market") continue;

    const pickupOrder = pickupOrdersById.get(orderId) || {
      id: order.id,
      created_at: order.created_at,
      customer_name: order.customer_name,
      customer_email: order.customer_email,
      customer_phone: order.customer_phone,
      items: []
    };

    for (const item of order.items || []) {
      appendPickupItem(pickupOrder, item);
    }

    pickupOrdersById.set(orderId, pickupOrder);
  }

  const prepRows = [];
  const productMap = new Map();

  for (const product of productsResult.data || []) {
    const sku = normalizeSku(product?.sku);
    if (!sku) continue;

    productMap.set(sku, true);
    productNameBySku.set(sku, toText(product?.name) || sku);
    const counts = countsBySku.get(sku) || buildEmptyCounts();
    const totalQty = counts.shipping_qty + counts.market_qty;
    if (totalQty <= 0 && counts.preorder_qty <= 0) continue;

    prepRows.push({
      sku,
      name: toText(product?.name) || sku,
      shipping_qty: counts.shipping_qty,
      market_qty: counts.market_qty,
      shipping_preorder_qty: counts.shipping_preorder_qty,
      market_preorder_qty: counts.market_preorder_qty,
      preorder_qty: counts.preorder_qty,
      total_qty: totalQty
    });
  }

  const unknownSkus = [...countsBySku.keys()]
    .filter((sku) => !productMap.has(sku))
    .sort();

  for (const sku of unknownSkus) {
    const counts = countsBySku.get(sku) || buildEmptyCounts();
    if (productMap.has(sku)) continue;

    const totalQty = counts.shipping_qty + counts.market_qty;
    if (totalQty <= 0 && counts.preorder_qty <= 0) continue;

    prepRows.push({
      sku,
      name: productNameBySku.get(sku) || sku,
      shipping_qty: counts.shipping_qty,
      market_qty: counts.market_qty,
      shipping_preorder_qty: counts.shipping_preorder_qty,
      market_preorder_qty: counts.market_preorder_qty,
      preorder_qty: counts.preorder_qty,
      total_qty: totalQty
    });
  }

  const pickupOrders = [...pickupOrdersById.values()]
    .map((order) => {
      const items = Array.isArray(order.items) ? order.items : [];
      const itemCount = items.reduce((sum, item) => sum + toQty(item?.quantity), 0);
      const itemsSummary = items
        .map((item) => {
          const label = toText(item?.name) || normalizeSku(item?.sku);
          const quantity = toQty(item?.quantity);
          if (!label || quantity <= 0) return "";
          return `${label} x${quantity}`;
        })
        .filter(Boolean)
        .join(", ");

      return {
        id: order.id,
        created_at: order.created_at,
        customer_name: order.customer_name,
        customer_email: order.customer_email,
        customer_phone: order.customer_phone,
        item_count: itemCount,
        items_summary: itemsSummary,
        items
      };
    })
    .sort((a, b) =>
      a.customer_name.localeCompare(b.customer_name, undefined, {
        sensitivity: "base"
      }) || toText(a.created_at).localeCompare(toText(b.created_at))
    );

  return respond.json({
    week: weekInfo,
    pickup,
    timezone,
    prep: prepRows,
    pickup_orders: pickupOrders
  });
}
