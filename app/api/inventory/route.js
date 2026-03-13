import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getShowStockSetting } from "@/lib/siteSettings";
import {
  getRateLimitHeaders,
  getRetryAfterSeconds,
  rateLimitByRequest
} from "@/lib/rateLimit";

const INVENTORY_WINDOW_MS = 60_000;
const INVENTORY_MAX = 180;

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const limit = rateLimitByRequest(request, {
    scope: "inventory:get",
    windowMs: INVENTORY_WINDOW_MS,
    max: INVENTORY_MAX
  });

  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many inventory requests. Please wait and try again." },
      {
        status: 429,
        headers: {
          ...getRateLimitHeaders(limit, INVENTORY_MAX),
          "Retry-After": String(getRetryAfterSeconds(limit.resetAt)),
          "Cache-Control": "no-store"
        }
      }
    );
  }

  const rateHeaders = getRateLimitHeaders(limit, INVENTORY_MAX);

  if (!supabaseAdmin) {
    return NextResponse.json({}, { headers: { ...rateHeaders, "Cache-Control": "no-store" } });
  }

  const [{ data, error }, showStock] = await Promise.all([
    supabaseAdmin
      .from("inventory")
      .select("sku, on_hand, preorders_remaining, units_sold, expected_restock_date"),
    getShowStockSetting()
  ]);

  if (error) {
    console.error("inventory read error:", error);
    return NextResponse.json({}, { headers: { ...rateHeaders, "Cache-Control": "no-store" } });
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

  return NextResponse.json(map, {
    headers: {
      ...rateHeaders,
      "Cache-Control": "no-store"
    }
  });
}
