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
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const [{ data, error }, showStock] = await Promise.all([
    supabaseAdmin
      .from("inventory")
      .select("sku, on_hand, preorders_remaining, units_sold, expected_restock_date"),
    getShowStockSetting()
  ]);

  if (error) {
    console.error("inventory admin read error:", error);
    return respond.json({ error: "Unable to read inventory." }, { status: 500 });
  }

  const inventory = (data || []).map((row) => ({
    sku: row.sku,
    on_hand: row.on_hand ?? 0,
    preorders_remaining: row.preorders_remaining ?? 0,
    units_sold: row.units_sold ?? 0,
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
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json({ error: "Invalid payload." }, { status: 400 });
  }

  const parsedPayload = inventoryPatchSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return respond.json(
      { error: parsedPayload.error.issues[0]?.message || "Invalid payload." },
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
        { error: "Unable to update stock display setting." },
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
    const parsedPreorders = Number.parseInt(payload?.preorders_remaining, 10);

    if (!cleanSku || Number.isNaN(parsedPreorders) || parsedPreorders < 0) {
      return respond.json({ error: "Invalid payload." }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from("inventory")
      .update({ preorders_remaining: parsedPreorders })
      .eq("sku", cleanSku)
      .select("sku, on_hand, preorders_remaining, units_sold, expected_restock_date")
      .single();

    if (error) {
      console.error("preorders update error:", error);
      return respond.json(
        { error: "Unable to update preorder count." },
        { status: 500 }
      );
    }

    if (!data) {
      return respond.json({ error: "SKU not found." }, { status: 404 });
    }

    return respond.json({
      ok: true,
      inventory: {
        sku: data.sku,
        on_hand: data.on_hand ?? 0,
        preorders_remaining: data.preorders_remaining ?? 0,
        units_sold: data.units_sold ?? 0,
        expected_restock_date: data.expected_restock_date || null,
        status: (data.on_hand ?? 0) > 0 ? "In Stock" : "Out of Stock"
      }
    });
  }

  if (!cleanSku) {
    return respond.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (!hasRestockDateField) {
    return respond.json({ error: "Invalid payload." }, { status: 400 });
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
      { error: "Unable to update restock date." },
      { status: 500 }
    );
  }

  return respond.json({ ok: true, inventory: data?.[0] || null });
}
