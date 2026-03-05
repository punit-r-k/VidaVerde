import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const DEFAULT_TIMEZONE = "America/Chicago";
const LOOKBACK_DAYS = 21;
const WEEKDAY_INDEX = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};

const requireSecret = (request) => {
  const secret = request.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_RESTOCK_SECRET;
};

const toDateKeyUTC = (date) => {
  return date.toISOString().slice(0, 10);
};

const getDatePartsInTimezone = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
  const parts = formatter.formatToParts(date);

  const partValue = (type) => parts.find((part) => part.type === type)?.value || "";
  return {
    year: Number.parseInt(partValue("year"), 10),
    month: Number.parseInt(partValue("month"), 10),
    day: Number.parseInt(partValue("day"), 10),
    weekday: partValue("weekday").toLowerCase()
  };
};

const getDateKeyInTimezone = (date, timeZone) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);
  const partValue = (type) => parts.find((part) => part.type === type)?.value || "";
  return `${partValue("year")}-${partValue("month")}-${partValue("day")}`;
};

const getWeekInfo = (timeZone) => {
  const now = new Date();
  const parts = getDatePartsInTimezone(now, timeZone);
  const weekdayPrefix = (parts.weekday || "").slice(0, 3);
  const weekdayIndex = WEEKDAY_INDEX[weekdayPrefix] ?? 0;
  const daysFromMonday = (weekdayIndex + 6) % 7;

  const monday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - daysFromMonday)
  );
  const saturday = new Date(monday);
  saturday.setUTCDate(monday.getUTCDate() + 5);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    week_start_date: toDateKeyUTC(monday),
    week_end_date: toDateKeyUTC(sunday),
    market_date: toDateKeyUTC(saturday)
  };
};

const toQty = (value) => {
  const qty = Number.parseInt(value, 10);
  return Number.isFinite(qty) && qty > 0 ? qty : 0;
};

const normalizeSku = (value) => String(value || "").trim().toUpperCase();

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

  const timezone = DEFAULT_TIMEZONE;
  const weekInfo = getWeekInfo(timezone);
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
      .select("sku, quantity, orders!inner(fulfillment, created_at, status)")
      .gte("orders.created_at", lookback.toISOString())
      .eq("orders.status", "paid")
  ]);

  if (productsResult.error) {
    console.error("prep products read error:", productsResult.error);
    return NextResponse.json(
      { error: "Unable to read products." },
      { status: 500 }
    );
  }

  if (itemsResult.error) {
    console.error("prep order_items read error:", itemsResult.error);
    return NextResponse.json(
      { error: "Unable to read order items." },
      { status: 500 }
    );
  }

  const countsBySku = new Map();
  const startKey = weekInfo.week_start_date;
  const endKey = weekInfo.week_end_date;

  for (const row of itemsResult.data || []) {
    const sku = normalizeSku(row?.sku);
    const quantity = toQty(row?.quantity);
    if (!sku || quantity <= 0) continue;

    const orderData = Array.isArray(row?.orders) ? row.orders[0] : row?.orders;
    const createdAt = orderData?.created_at ? new Date(orderData.created_at) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) continue;

    const localDateKey = getDateKeyInTimezone(createdAt, timezone);
    if (localDateKey < startKey || localDateKey > endKey) continue;

    const fulfillment = orderData?.fulfillment === "market" ? "market" : "ship";
    const current = countsBySku.get(sku) || { shipping_qty: 0, market_qty: 0 };

    if (fulfillment === "market") {
      current.market_qty += quantity;
    } else {
      current.shipping_qty += quantity;
    }

    countsBySku.set(sku, current);
  }

  const prepRows = [];
  const productMap = new Map();

  for (const product of productsResult.data || []) {
    const sku = normalizeSku(product?.sku);
    if (!sku) continue;

    productMap.set(sku, true);
    const counts = countsBySku.get(sku) || { shipping_qty: 0, market_qty: 0 };
    const totalQty = counts.shipping_qty + counts.market_qty;
    if (totalQty <= 0) continue;

    prepRows.push({
      sku,
      name: String(product?.name || sku),
      shipping_qty: counts.shipping_qty,
      market_qty: counts.market_qty,
      total_qty: totalQty
    });
  }

  const unknownSkus = [...countsBySku.keys()]
    .filter((sku) => !productMap.has(sku))
    .sort();

  for (const sku of unknownSkus) {
    const counts = countsBySku.get(sku) || { shipping_qty: 0, market_qty: 0 };
    if (productMap.has(sku)) continue;

    const totalQty = counts.shipping_qty + counts.market_qty;
    if (totalQty <= 0) continue;

    prepRows.push({
      sku,
      name: sku,
      shipping_qty: counts.shipping_qty,
      market_qty: counts.market_qty,
      total_qty: totalQty
    });
  }

  return NextResponse.json({
    week: weekInfo,
    timezone,
    prep: prepRows
  });
}
