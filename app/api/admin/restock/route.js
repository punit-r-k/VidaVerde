import { restockPayloadSchema } from "@/lib/adminSchemas";
import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

const ADMIN_RESTOCK_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_RESTOCK_POST", {
  windowMs: 60_000,
  ipMax: 180,
  userMax: 120
});

const ADMIN_RESTOCK_ROLES = ["admin", "inventory_admin"];

const normalizeSku = (value) => String(value || "").trim().toUpperCase();

export async function POST(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:restock:post",
    requiredRoles: ADMIN_RESTOCK_ROLES,
    rateLimit: ADMIN_RESTOCK_RATE_LIMIT,
    rateLimitExceededMessage: "Too many restock requests. Please wait and try again."
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
      { error: "We couldn't read that restock update. Please try again." },
      { status: 400 }
    );
  }

  const parsedPayload = restockPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return respond.json(
      { error: parsedPayload.error.issues[0]?.message || "Please check that restock update and try again." },
      { status: 400 }
    );
  }

  const { sku, restock } = parsedPayload.data;
  const cleanSku = normalizeSku(sku);
  const qty = Number.parseInt(restock, 10);

  if (!cleanSku || Number.isNaN(qty)) {
    return respond.json({ error: "Choose an item and a restock amount before updating." }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin.rpc("apply_restock", {
    p_sku: cleanSku,
    p_restock: qty
  });

  if (error) {
    console.error("apply_restock error:", error);
    return respond.json({ error: "We couldn't update stock right now." }, { status: 500 });
  }

  return respond.json({
    ok: true,
    inventory: data?.[0] || null,
    preorder_ready_email_queued: qty > 0,
    preorder_ready_emails_sent: 0,
    preorder_ready_pickup_emails_sent: 0,
    preorder_ready_shipping_emails_sent: 0
  });
}
