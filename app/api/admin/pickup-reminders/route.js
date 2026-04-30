import { secureAdminRoute } from "@/lib/apiSecurity";
import { sendPickupReminderEmails } from "@/lib/pickupReminderEmail";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";

export const runtime = "nodejs";

const ADMIN_PICKUP_REMINDERS_RATE_LIMIT = getRouteRateLimitConfig(
  "ADMIN_PICKUP_REMINDERS_POST",
  {
    windowMs: 60_000,
    ipMax: 60,
    userMax: 24
  }
);

const ADMIN_PICKUP_REMINDERS_ROLES = ["admin", "ops_admin"];

export async function POST(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:pickup-reminders:post",
    requiredRoles: ADMIN_PICKUP_REMINDERS_ROLES,
    rateLimit: ADMIN_PICKUP_REMINDERS_RATE_LIMIT,
    rateLimitExceededMessage: "Too many pickup reminder requests. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;
  const result = await sendPickupReminderEmails({
    now: new Date()
  });

  if (result.ok) {
    return respond.json({
      ok: true,
      sentCount: result.sentCount || 0,
      pickupDate: result.pickupDate || "",
      skipped: result.skipped === true,
      reason: result.reason || ""
    });
  }

  console.error("pickup reminder email error:", result.errors || result.error);

  return respond.json(
    {
      ok: false,
      error: "We couldn't send pickup reminder emails right now.",
      sentCount: result.sentCount || 0,
      pickupDate: result.pickupDate || "",
      details: result.errors || result.error || null
    },
    { status: 500 }
  );
}
