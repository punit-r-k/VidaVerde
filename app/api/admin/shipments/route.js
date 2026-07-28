import { parseSearchParams, shipmentsQuerySchema } from "@/lib/adminSchemas";
import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ADMIN_SHIPMENTS_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_SHIPMENTS_GET", {
  windowMs: 60_000,
  ipMax: 120,
  userMax: 90
});

const ADMIN_SHIPMENTS_ROLES = ["admin", "ops_admin"];

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toUpperText = (value, fallback) => {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || fallback;
};

export const runtime = "nodejs";

export async function GET(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:shipments:get",
    requiredRoles: ADMIN_SHIPMENTS_ROLES,
    rateLimit: ADMIN_SHIPMENTS_RATE_LIMIT,
    rateLimitExceededMessage: "Too many shipment requests. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Shipments are not connected right now." },
      { status: 500 }
    );
  }

  const parsedQuery = shipmentsQuerySchema.safeParse(parseSearchParams(request));
  if (!parsedQuery.success) {
    return respond.json(
      { error: parsedQuery.error.issues[0]?.message || "Please check the shipment filters and try again." },
      { status: 400 }
    );
  }

  const { limit, status, refresh } = parsedQuery.data;

  let refreshedCount = 0;
  if (refresh) {
    const { data: syncCount, error: syncError } = await supabaseAdmin.rpc(
      "sync_all_shipments"
    );
    if (syncError) {
      console.error("sync_all_shipments error:", syncError);
      return respond.json(
        { error: "We couldn't refresh shipments right now." },
        { status: 500 }
      );
    }
    refreshedCount = toInt(syncCount, 0);
  }

  let query = supabaseAdmin
    .from("shipments")
    .select(
      "id, order_id, payment_session_id, payment_reference, status, label_provider, label_url, tracking_number, carrier, service, customer_name, customer_email, customer_phone, address1, address2, city, state, postal_code, country, items_summary, items_json, item_count, amount_total, currency, shipping_tier, shipping_option, shipping_option_label, shipping_estimate, sauerkraut_count, hot_sauce_count, notes, label_purchased_at, shipped_at, created_at, updated_at, orders(note), shipment_parcels(parcel_index, package_code, product_family, postage_cents, box_cost_cents, carrier, service, tracking_number, label_url, label_pdf_url, status)"
    )
    .order("created_at", { ascending: false })
    .limit(limit);

  if (status) {
    query = query.eq("status", status);
  }

  const { data, error } = await query;
  if (error) {
    console.error("shipments admin read error:", error);
    return respond.json(
      { error: "We couldn't load shipments right now." },
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
    shipping_tier: String(row.shipping_tier || ""),
    shipping_option: String(row.shipping_option || ""),
    shipping_option_label: String(row.shipping_option_label || ""),
    shipping_estimate: String(row.shipping_estimate || ""),
    sauerkraut_count: toInt(row.sauerkraut_count, 0),
    hot_sauce_count: toInt(row.hot_sauce_count, 0),
    notes: String(
      row.notes ||
        (Array.isArray(row.orders) ? row.orders[0]?.note : row.orders?.note) ||
        ""
    ),
    label_purchased_at: row.label_purchased_at || null,
    shipped_at: row.shipped_at || null,
    parcels: Array.isArray(row.shipment_parcels)
      ? row.shipment_parcels.sort((a, b) => a.parcel_index - b.parcel_index)
      : [],
    created_at: row.created_at,
    updated_at: row.updated_at
  }));

  return respond.json({
    refreshed_count: refreshedCount,
    shipments
  });
}
