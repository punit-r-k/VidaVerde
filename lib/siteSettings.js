import { supabaseAdmin } from "./supabaseAdmin";

const SETTINGS_ROW_ID = true;
const DEFAULT_SHOW_STOCK = true;

export async function getShowStockSetting() {
  if (!supabaseAdmin) return DEFAULT_SHOW_STOCK;

  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .select("show_stock")
    .eq("id", SETTINGS_ROW_ID)
    .maybeSingle();

  if (error) {
    console.error("site settings read error:", error);
    return DEFAULT_SHOW_STOCK;
  }

  if (!data || typeof data.show_stock !== "boolean") {
    return DEFAULT_SHOW_STOCK;
  }

  return data.show_stock;
}

export async function setShowStockSetting(nextValue) {
  if (!supabaseAdmin) {
    return DEFAULT_SHOW_STOCK;
  }

  const showStock = nextValue !== false;
  const { data, error } = await supabaseAdmin
    .from("site_settings")
    .upsert(
      {
        id: SETTINGS_ROW_ID,
        show_stock: showStock
      },
      {
        onConflict: "id"
      }
    )
    .select("show_stock")
    .single();

  if (error) {
    console.error("site settings update error:", error);
    throw error;
  }

  return data?.show_stock !== false;
}
