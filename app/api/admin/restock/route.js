import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  const secret = request.headers.get("x-admin-secret");
  if (!secret || secret !== process.env.ADMIN_RESTOCK_SECRET) {
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
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { sku, restock } = payload || {};
  const cleanSku = String(sku || "").trim();
  const qty = Number.parseInt(restock, 10);

  if (!cleanSku || Number.isNaN(qty)) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("apply_restock", {
    p_sku: cleanSku,
    p_restock: qty
  });

  if (error) {
    console.error("apply_restock error:", error);
    return NextResponse.json({ error: "Unable to restock" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, inventory: data?.[0] || null });
}
