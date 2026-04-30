import { secureAdminRoute } from "@/lib/apiSecurity";
import { processEmailJobs } from "@/lib/emailJobQueue";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { z } from "zod";

const ADMIN_EMAIL_JOBS_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_EMAIL_JOBS_POST", {
  windowMs: 60_000,
  ipMax: 60,
  userMax: 24
});

const ADMIN_EMAIL_JOBS_ROLES = ["admin", "ops_admin"];

const parseLimit = (value) => {
  if (value === undefined || value === null || value === "") return 10;
  if (typeof value === "number") return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number(value.trim());
  }
  return Number.NaN;
};

const payloadSchema = z
  .object({
    limit: z.preprocess(
      parseLimit,
      z
        .number("Use a whole number for the job limit.")
        .int("Use a whole number for the job limit.")
        .min(1, "Run at least 1 email job.")
        .max(25, "Run 25 email jobs or fewer at a time.")
    )
  })
  .strict();

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

  const parsedPayload = payloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return respond.json(
      { error: parsedPayload.error.issues[0]?.message || "Please check the email job request and try again." },
      { status: 400 }
    );
  }

  const result = await processEmailJobs({
    limit: parsedPayload.data.limit
  });

  if (!result.ok) {
    console.error("email queue processing error:", result.errors || result.error);
    return respond.json(
      {
        ok: false,
        error: "We couldn't process the email queue right now.",
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
