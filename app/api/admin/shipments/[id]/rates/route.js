import { shipmentIdSchema } from "@/lib/adminSchemas";
import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { getEasyPostQuotes } from "@/lib/shippingQuotes";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
const ROLES = ["admin", "ops_admin"];
const RATE_LIMIT = getRouteRateLimitConfig("ADMIN_SHIPMENT_RATES_POST", { windowMs: 60_000, ipMax: 30, userMax: 20 });

export async function POST(request, context) {
  const security = await secureAdminRoute(request, { scope: "admin:shipment-rates:post", requiredRoles: ROLES, rateLimit: RATE_LIMIT });
  if (!security.ok) return security.response;
  const { respond } = security;
  const id = shipmentIdSchema.safeParse((await context.params).id);
  if (!id.success) return respond.json({ error: id.error.issues[0]?.message }, { status: 400 });
  if (!supabaseAdmin) return respond.json({ error: "Shipping data is not connected." }, { status: 500 });

  const { data: shipment, error } = await supabaseAdmin.from("shipments").select("*").eq("id", id.data).maybeSingle();
  if (error || !shipment) return respond.json({ error: "Shipment not found." }, { status: 404 });
  if (shipment.status !== "pending_label") return respond.json({ error: "Rates can only be requested before a label is purchased." }, { status: 409 });

  try {
    const quotes = await getEasyPostQuotes(shipment);
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { data: saved, error: saveError } = await supabaseAdmin.from("shipment_quotes").insert(
      quotes.map((quote) => ({ shipment_id: shipment.id, provider: "easypost", plan_key: quote.planKey, postage_cents: quote.postageCents, box_cost_cents: quote.boxCostCents, total_cost_cents: quote.totalCostCents, currency: "USD", quote_json: quote, expires_at: expiresAt }))
    ).select("id, plan_key, postage_cents, box_cost_cents, total_cost_cents, currency, quote_json, expires_at");
    if (saveError) throw saveError;
    return respond.json({ quotes: saved });
  } catch (quoteError) {
    console.error("EasyPost rate request failed:", quoteError?.message || quoteError);
    return respond.json({ error: quoteError?.message || "EasyPost rates could not be retrieved." }, { status: 502 });
  }
}
