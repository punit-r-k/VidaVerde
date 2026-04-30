import { secureAdminRoute } from "@/lib/apiSecurity";
import { processEmailJobs } from "@/lib/emailJobQueue";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";

const ADMIN_EMAIL_JOBS_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_EMAIL_JOBS_POST", {
  windowMs: 60_000,
  ipMax: 60,
  userMax: 24
});

const ADMIN_EMAIL_JOBS_ROLES = ["admin", "ops_admin"];

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const runtime = "nodejs";

export async function POST(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:email-jobs:post",
    requiredRoles: ADMIN_EMAIL_JOBS_ROLES,
    rateLimit: ADMIN_EMAIL_JOBS_RATE_LIMIT,
    rateLimitExceededMessage: "Too many email queue requests. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const result = await processEmailJobs({
    limit: Math.min(Math.max(toInt(payload?.limit, 10), 1), 25)
  });

  if (!result.ok) {
    console.error("email queue processing error:", result.errors || result.error);
    return respond.json(
      {
        ok: false,
        error: "Unable to process email queue.",
        processed: result.processed || 0,
        sentCount: result.sentCount || 0,
        failedCount: result.failedCount || 0,
        skippedCount: result.skippedCount || 0
      },
      { status: 500 }
    );
  }

  return respond.json({
    ok: true,
    deliveryOk: result.deliveryOk !== false,
    processed: result.processed || 0,
    sentCount: result.sentCount || 0,
    failedCount: result.failedCount || 0,
    skippedCount: result.skippedCount || 0
  });
}
