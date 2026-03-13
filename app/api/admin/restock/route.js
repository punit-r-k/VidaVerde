import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getRateLimitHeaders,
  getRetryAfterSeconds,
  rateLimitByRequest
} from "@/lib/rateLimit";

export const runtime = "nodejs";
const normalizeSku = (value) => String(value || "").trim().toUpperCase();
const ADMIN_RESTOCK_WINDOW_MS = 60_000;
const ADMIN_RESTOCK_MAX = 120;

export async function POST(request) {
  const limit = rateLimitByRequest(request, {
    scope: "admin:restock:post",
    windowMs: ADMIN_RESTOCK_WINDOW_MS,
    max: ADMIN_RESTOCK_MAX
  });

  if (!limit.ok) {
    return NextResponse.json(
      { error: "Too many restock requests. Please wait and try again." },
      {
        status: 429,
        headers: {
          ...getRateLimitHeaders(limit, ADMIN_RESTOCK_MAX),
          "Retry-After": String(getRetryAfterSeconds(limit.resetAt))
        }
      }
    );
  }

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
  const cleanSku = normalizeSku(sku);
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
