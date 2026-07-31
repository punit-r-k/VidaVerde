import { shipmentIdSchema } from "@/lib/adminSchemas";
import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { autoPurchaseFastestShippingLabels } from "@/lib/shipmentLabelAutomation";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
const ROLES = ["admin", "ops_admin"];
const RATE_LIMIT = getRouteRateLimitConfig("ADMIN_SHIPMENT_LABELS_POST", {
  windowMs: 60_000,
  ipMax: 20,
  userMax: 10
});

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

  try {
    const result = await autoPurchaseFastestShippingLabels(id.data);
    if (result.state === "missing") {
      return respond.json({ error: "Shipment not found." }, { status: 404 });
    }
    if (result.state === "unavailable") {
      return respond.json(
        { error: "This shipment is not available for label purchase." },
        { status: 409 }
      );
    }
    return respond.json({
      shipment_id: id.data,
      state: result.state,
      parcels: result.parcels || []
    });
  } catch (purchaseError) {
    console.error(
      "Automatic EasyPost label purchase failed:",
      purchaseError?.message || purchaseError
    );
    return respond.json(
      { error: purchaseError?.message || "The fastest available label could not be purchased." },
      { status: 502 }
    );
  }
}
