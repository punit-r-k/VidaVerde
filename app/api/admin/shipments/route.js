import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getRateLimitHeaders,
  getRetryAfterSeconds,
  rateLimitByRequest
} from "@/lib/rateLimit";

const requireSecret = (request) => {
  const secret = request.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_RESTOCK_SECRET;
};

const toUpperText = (value, fallback) => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || fallback;
};

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};
const ADMIN_SHIPMENTS_WINDOW_MS = 60_000;
const ADMIN_SHIPMENTS_MAX = 90;

export const runtime = "nodejs";

export async function GET(request) {
  const rate = rateLimitByRequest(request, {
    scope: "admin:shipments:get",
    windowMs: ADMIN_SHIPMENTS_WINDOW_MS,
    max: ADMIN_SHIPMENTS_MAX
  });
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many shipment requests. Please wait and try again." },
      {
        status: 429,
        headers: {
          ...getRateLimitHeaders(rate, ADMIN_SHIPMENTS_MAX),
          "Retry-After": String(getRetryAfterSeconds(rate.resetAt))
        }
      }
    );
  }

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
  const refresh = searchParams.get("refresh") === "1";

  let refreshedCount = 0;
  if (refresh) {
    const { data: syncCount, error: syncError } = await supabaseAdmin.rpc(
      "sync_all_shipments"
    );
    if (syncError) {
      console.error("sync_all_shipments error:", syncError);
      return NextResponse.json(
        { error: "Unable to refresh shipments." },
        { status: 500 }
      );
    }
    refreshedCount = toInt(syncCount, 0);
  }

  let query = supabaseAdmin
    .from("shipments")
    .select(
      "id, order_id, payment_session_id, payment_reference, status, label_provider, label_url, tracking_number, carrier, service, customer_name, customer_email, customer_phone, address1, address2, city, state, postal_code, country, items_summary, items_json, item_count, amount_total, currency, notes, label_purchased_at, shipped_at, created_at, updated_at, orders(note)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("shipments admin read error:", error);
    return NextResponse.json(
      { error: "Unable to read shipments." },
      { status: 500 }
    );
  }

  const shipments = (data || []).map((row) => ({
    id: row.id,
    order_id: row.order_id,
    payment_session_id: row.payment_session_id,
    payment_reference: row.payment_reference || "",
    status: String(row.status || "pending_label"),
    label_provider: String(row.label_provider || ""),
    label_url: String(row.label_url || ""),
    tracking_number: String(row.tracking_number || ""),
    carrier: String(row.carrier || ""),
    service: String(row.service || ""),
    customer_name: String(row.customer_name || ""),
    customer_email: String(row.customer_email || ""),
    customer_phone: String(row.customer_phone || ""),
    address1: String(row.address1 || ""),
    address2: String(row.address2 || ""),
    city: String(row.city || ""),
    state: toUpperText(row.state, ""),
    postal_code: String(row.postal_code || ""),
    country: toUpperText(row.country, "US"),
    items_summary: String(row.items_summary || ""),
    items_json: Array.isArray(row.items_json) ? row.items_json : [],
    item_count: toInt(row.item_count, 0),
    amount_total: toInt(row.amount_total, 0),
    currency: toUpperText(row.currency, "USD"),
    notes: String(
      row.notes ||
      (Array.isArray(row.orders) ? row.orders[0]?.note : row.orders?.note) ||
      ""
    ),
    label_purchased_at: row.label_purchased_at || null,
    shipped_at: row.shipped_at || null,
    created_at: row.created_at,
    updated_at: row.updated_at
  }));

  return NextResponse.json({
    refreshed_count: refreshedCount,
    shipments
  });
}
