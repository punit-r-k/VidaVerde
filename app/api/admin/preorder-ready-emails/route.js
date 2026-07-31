import { secureAdminRoute } from "@/lib/apiSecurity";
import { sendPreorderReadyEmails } from "@/lib/preorderReadyEmail";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";

export const runtime = "nodejs";

const RATE_LIMIT = getRouteRateLimitConfig("ADMIN_PREORDER_READY_EMAILS_POST", {
  windowMs: 60_000,
  ipMax: 30,
  userMax: 20
});

export async function POST(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:preorder-ready-emails:post",
    requiredRoles: ["admin", "inventory_admin"],
    rateLimit: RATE_LIMIT,
    rateLimitExceededMessage: "Too many preorder email requests. Please wait and try again."
  });
  if (!security.ok) return security.response;

  const result = await sendPreorderReadyEmails();
  if (!result.ok) {
    console.error("preorder ready email error:", result.errors || result.error);
  }

  return security.respond.json(result, { status: result.ok ? 200 : 500 });
}
