import { securePublicRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { getInventoryMap } from "@/lib/stock";

const INVENTORY_RATE_LIMIT = getRouteRateLimitConfig("INVENTORY_GET", {
  windowMs: 60_000,
  ipMax: 180
});

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const security = await securePublicRoute(request, {
    scope: "inventory:get",
    rateLimit: INVENTORY_RATE_LIMIT,
    rateLimitExceededMessage: "Too many inventory requests. Please wait and try again."
  });
  if (!security.ok) {
    const response = security.response;
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const { respond } = security;
  const inventory = await getInventoryMap();

  if (!inventory) {
    return respond.json(
      { error: "Inventory is temporarily unavailable." },
      {
        status: 503,
        headers: { "Cache-Control": "no-store" }
      }
    );
  }

  return respond.json(inventory, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
