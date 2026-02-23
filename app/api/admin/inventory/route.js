import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getShowStockSetting, setShowStockSetting } from "@/lib/siteSettings";

const requireSecret = (request) => {
  const secret = request.headers.get("x-admin-secret");
  return secret && secret === process.env.ADMIN_RESTOCK_SECRET;
};

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

  const [{ data, error }, showStock] = await Promise.all([
    supabaseAdmin
      .from("inventory")
      .select("sku, on_hand, preorders_remaining, units_sold, expected_restock_date"),
    getShowStockSetting()
  ]);

  if (error) {
    console.error("inventory admin read error:", error);
    return NextResponse.json({ error: "Unable to read inventory." }, { status: 500 });
  }

  const inventory = (data || []).map((row) => ({
    sku: row.sku,
    on_hand: row.on_hand ?? 0,
    preorders_remaining: row.preorders_remaining ?? 0,
    units_sold: row.units_sold ?? 0,
    expected_restock_date: row.expected_restock_date || null,
    status: row.on_hand > 0 ? "In Stock" : "Out of Stock"
  }));

  return NextResponse.json({
    inventory,
    settings: {
      show_stock: showStock
    }
  });
}

export async function PATCH(request) {
  if (!requireSecret(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!supabaseAdmin) {
    return NextResponse.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  if (typeof payload?.show_stock === "boolean") {
    try {
      const showStock = await setShowStockSetting(payload.show_stock);
      return NextResponse.json({
        ok: true,
        settings: {
          show_stock: showStock
        }
      });
    } catch (error) {
      console.error("show_stock update error:", error);
      return NextResponse.json(
        { error: "Unable to update stock display setting." },
        { status: 500 }
      );
    }
  }

  const cleanSku = String(payload?.sku || "").trim();
  const rawDate = payload?.expected_restock_date;

  if (!cleanSku) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const dateValue = rawDate ? String(rawDate).trim() : null;
  const isValidDate = !dateValue || /^\d{4}-\d{2}-\d{2}$/.test(dateValue);

  if (!isValidDate) {
    return NextResponse.json({ error: "Invalid date format." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("set_expected_restock_date", {
    p_sku: cleanSku,
    p_date: dateValue
  });

  if (error) {
    console.error("set_expected_restock_date error:", error);
    return NextResponse.json(
      { error: "Unable to update restock date." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, inventory: data?.[0] || null });
}
