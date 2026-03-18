import { securePublicRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { getShowStockSetting } from "@/lib/siteSettings";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const INVENTORY_RATE_LIMIT = getRouteRateLimitConfig("INVENTORY_GET", {
  windowMs: 60_000,
  ipMax: 180
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const security = await securePublicRoute(request, {
    scope: "inventory:get",
    rateLimit: INVENTORY_RATE_LIMIT,
    rateLimitExceededMessage: "Too many inventory requests. Please wait and try again."
  });
  if (!security.ok) {
    const response = security.response;
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const { respond } = security;

  if (!supabaseAdmin) {
    return respond.json({}, { headers: { "Cache-Control": "no-store" } });
  }

  const [{ data, error }, showStock] = await Promise.all([
    supabaseAdmin
      .from("inventory")
      .select("sku, on_hand, preorders_remaining, units_sold, expected_restock_date"),
    getShowStockSetting()
  ]);

  if (error) {
    console.error("inventory read error:", error);
    return respond.json({}, { headers: { "Cache-Control": "no-store" } });
  }

  const map = {};
  for (const row of data || []) {
    map[row.sku] = {
      on_hand: row.on_hand ?? 0,
      preorders_remaining: row.preorders_remaining ?? 0,
      units_sold: row.units_sold ?? 0,
      expected_restock_date: row.expected_restock_date || null,
      status: row.on_hand > 0 ? "In Stock" : "Out of Stock",
      show_stock: showStock
    };
  }

  return respond.json(map, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
