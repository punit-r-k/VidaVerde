import { inventoryPatchSchema } from "@/lib/adminSchemas";
import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { getShowStockSetting, setShowStockSetting } from "@/lib/siteSettings";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ADMIN_INVENTORY_GET_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_INVENTORY_GET", {
  windowMs: 60_000,
  ipMax: 180,
  userMax: 120
});

const ADMIN_INVENTORY_PATCH_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_INVENTORY_PATCH", {
  windowMs: 60_000,
  ipMax: 180,
  userMax: 120
});

const ADMIN_INVENTORY_ROLES = ["admin", "inventory_admin"];

const normalizeSku = (value) => String(value || "").trim().toUpperCase();

export const runtime = "nodejs";

export async function GET(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:inventory:get",
    requiredRoles: ADMIN_INVENTORY_ROLES,
    rateLimit: ADMIN_INVENTORY_GET_RATE_LIMIT,
    rateLimitExceededMessage: "Too many inventory admin requests. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Inventory is not connected right now." },
      { status: 500 }
    );
  }

  const [{ data, error }, { data: salesData, error: salesError }, showStock] = await Promise.all([
    supabaseAdmin
      .from("inventory")
      .select("sku, on_hand, preorders_remaining, units_sold, expected_restock_date"),
    supabaseAdmin.rpc("get_non_test_units_sold"),
    getShowStockSetting()
  ]);

  if (error || salesError) {
    console.error("inventory admin read error:", error || salesError);
    return respond.json({ error: "We couldn't load inventory right now." }, { status: 500 });
  }

  const nonTestSalesBySku = new Map(
    (salesData || []).map((row) => [normalizeSku(row?.sku), Number(row?.units_sold) || 0])
  );

  const inventory = (data || []).map((row) => ({
    sku: row.sku,
    on_hand: row.on_hand ?? 0,
    preorders_remaining: row.preorders_remaining ?? 0,
    units_sold: nonTestSalesBySku.get(normalizeSku(row.sku)) || 0,
    expected_restock_date: row.expected_restock_date || null,
    status: row.on_hand > 0 ? "In Stock" : "Out of Stock"
  }));

  return respond.json({
    inventory,
    settings: {
      show_stock: showStock
    }
  });
}

export async function PATCH(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:inventory:patch",
    requiredRoles: ADMIN_INVENTORY_ROLES,
    rateLimit: ADMIN_INVENTORY_PATCH_RATE_LIMIT,
    rateLimitExceededMessage: "Too many inventory admin updates. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Inventory is not connected right now." },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json(
      { error: "We couldn't read that inventory update. Please try again." },
      { status: 400 }
    );
  }

  const parsedPayload = inventoryPatchSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return respond.json(
      { error: parsedPayload.error.issues[0]?.message || "Please check that inventory update and try again." },
      { status: 400 }
    );
  }

  payload = parsedPayload.data;

  if (typeof payload?.show_stock === "boolean") {
    try {
      const showStock = await setShowStockSetting(payload.show_stock);
      return respond.json({
        ok: true,
        settings: {
          show_stock: showStock
        }
      });
    } catch (error) {
      console.error("show_stock update error:", error);
      return respond.json(
        { error: "We couldn't update the stock display setting right now." },
        { status: 500 }
      );
    }
  }

  const cleanSku = normalizeSku(payload?.sku);
  const hasPreordersField = Object.prototype.hasOwnProperty.call(
    payload || {},
    "preorders_remaining"
  );
  const hasRestockDateField = Object.prototype.hasOwnProperty.call(
    payload || {},
    "expected_restock_date"
  );

  if (hasPreordersField) {
    if (!cleanSku) {
      return respond.json({ error: "Choose an item before updating preorders." }, { status: 400 });
    }

    return respond.json({
      error:
        "Preorders are managed automatically from paid orders and cannot be edited directly. This keeps fulfillment first-come-first-served."
    }, { status: 409 });
  }

  if (!cleanSku) {
    return respond.json({ error: "Choose an item before updating its restock date." }, { status: 400 });
  }

  if (!hasRestockDateField) {
    return respond.json({ error: "Choose a restock date to update." }, { status: 400 });
  }

  const rawDate = payload?.expected_restock_date;
  const dateValue = rawDate ? String(rawDate).trim() : null;

  const { data, error } = await supabaseAdmin.rpc("set_expected_restock_date", {
    p_sku: cleanSku,
    p_date: dateValue
  });

  if (error) {
    console.error("set_expected_restock_date error:", error);
    return respond.json(
      { error: "We couldn't update the restock date right now." },
      { status: 500 }
    );
  }

  return respond.json({ ok: true, inventory: data?.[0] || null });
}
