import { shipmentIdSchema } from "@/lib/adminSchemas";
import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { createShippingLabelReleaseQuote } from "@/lib/shipmentLabelAutomation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

const ROLES = ["admin", "ops_admin"];
const RATE_LIMIT = getRouteRateLimitConfig("ADMIN_SHIPMENT_LABEL_QUOTES_POST", {
  windowMs: 60_000,
  ipMax: 20,
  userMax: 10
});

export async function POST(request, context) {
  const security = await secureAdminRoute(request, {
    scope: "admin:shipment-label-quotes:post",
    requiredRoles: ROLES,
    rateLimit: RATE_LIMIT,
    rateLimitExceededMessage: "Too many label previews. Please wait and try again."
  });
  if (!security.ok) return security.response;

  const { respond } = security;
  const id = shipmentIdSchema.safeParse((await context.params).id);
  if (!id.success) {
    return respond.json(
      { error: id.error.issues[0]?.message || "Invalid shipment." },
      { status: 400 }
    );
  }
  if (!supabaseAdmin) {
    return respond.json({ error: "Shipping data is not connected." }, { status: 500 });
  }

  try {
    const result = await createShippingLabelReleaseQuote(id.data);
    if (result.state === "missing") {
      return respond.json({ error: result.error || "Shipment not found." }, { status: 404 });
    }
    if (!result.ok) {
      return respond.json(
        { error: result.error || "This shipment cannot be released yet.", state: result.state },
        { status: 409 }
      );
    }
    return respond.json({ ok: true, state: result.state, resumed: result.resumed, ...result.summary });
  } catch (error) {
    console.error("EasyPost release quote failed:", error?.message || error);
    return respond.json(
      { error: error?.message || "The current label cost could not be previewed." },
      { status: 502 }
    );
  }
}
