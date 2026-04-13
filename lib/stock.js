import { supabaseAdmin } from "./supabaseAdmin";
import { getShowStockSetting } from "./siteSettings";

const buildInventoryMap = (rows, showStock) => {
  const map = {};

  for (const row of rows || []) {
    map[row.sku] = {
      on_hand: row.on_hand ?? 0,
      preorders_remaining: row.preorders_remaining ?? 0,
      units_sold: row.units_sold ?? 0,
      expected_restock_date: row.expected_restock_date || null,
      status: row.on_hand > 0 ? "In Stock" : "Out of Stock",
      show_stock: showStock
    };
  }

  return map;
};

export async function getInventoryMap() {
  if (!supabaseAdmin) {
    return null;
  }

  const [{ data, error }, showStock] = await Promise.all([
    supabaseAdmin
      .from("inventory")
      .select("sku, on_hand, preorders_remaining, units_sold, expected_restock_date"),
    getShowStockSetting()
  ]);

  if (error) {
    console.error("inventory read error:", error);
    return null;
  }

  return buildInventoryMap(data, showStock);
}
