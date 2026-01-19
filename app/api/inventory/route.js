import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  if (!supabaseAdmin) {
    return NextResponse.json({}, { headers: { "Cache-Control": "no-store" } });
  }

  const { data, error } = await supabaseAdmin
    .from("inventory")
    .select("sku, on_hand, preorders_remaining, units_sold, expected_restock_date");

  if (error) {
    console.error("inventory read error:", error);
    return NextResponse.json({}, { headers: { "Cache-Control": "no-store" } });
  }

  const map = {};
  for (const row of data || []) {
    map[row.sku] = {
      on_hand: row.on_hand ?? 0,
      preorders_remaining: row.preorders_remaining ?? 0,
      units_sold: row.units_sold ?? 0,
      expected_restock_date: row.expected_restock_date || null,
      status: row.on_hand > 0 ? "In Stock" : "Out of Stock"
    };
  }

  return NextResponse.json(map, {
    headers: { "Cache-Control": "no-store" }
  });
}
