import { shipmentIdSchema } from "@/lib/adminSchemas";
import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { readBoundedJsonBody } from "@/lib/requestBody";
import { purchaseReleasedShippingLabels } from "@/lib/shipmentLabelAutomation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

export const runtime = "nodejs";
export const maxDuration = 60;
const ROLES = ["admin", "ops_admin"];
const RATE_LIMIT = getRouteRateLimitConfig("ADMIN_SHIPMENT_LABELS_POST", {
  windowMs: 60_000,
  ipMax: 20,
  userMax: 10
});
const payloadSchema = z.object({ quote_id: z.uuid("Choose a valid release quote.") }).strict();

export async function POST(request, context) {
  const security = await secureAdminRoute(request, {
    scope: "admin:shipment-labels:post",
    requiredRoles: ROLES,
    rateLimit: RATE_LIMIT
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

  const bodyResult = await readBoundedJsonBody(request, { maxBytes: 4 * 1024 });
  if (!bodyResult.ok) {
    return respond.json({ error: "Please send a valid release confirmation." }, { status: bodyResult.status });
  }
  const payload = payloadSchema.safeParse(bodyResult.data);
  if (!payload.success) {
    return respond.json(
      { error: payload.error.issues[0]?.message || "Choose a valid release quote." },
      { status: 400 }
    );
  }

  try {
    const result = await purchaseReleasedShippingLabels(id.data, {
      quoteId: payload.data.quote_id
    });
    if (result.state === "missing") {
      return respond.json({ error: "Shipment not found." }, { status: 404 });
    }
    if (result.state === "unavailable") {
      return respond.json(
        { error: result.error || "This shipment is not available for label purchase." },
        { status: 409 }
      );
    }
    return respond.json({
      ok: true,
      shipment_id: id.data,
      state: result.state,
      parcels: result.parcels || [],
      tracking_email: { state: "disabled" }
    });
  } catch (purchaseError) {
    console.error(
      "EasyPost shipment release failed:",
      purchaseError?.message || purchaseError
    );
    return respond.json(
      { error: purchaseError?.message || "The confirmed shipping labels could not be purchased." },
      { status: 502 }
    );
  }
}
