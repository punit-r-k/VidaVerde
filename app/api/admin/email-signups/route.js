import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ADMIN_EMAIL_SIGNUPS_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_EMAIL_SIGNUPS_GET", {
  windowMs: 60_000,
  ipMax: 120,
  userMax: 90
});

const ADMIN_EMAIL_SIGNUPS_ROLES = ["admin", "ops_admin"];
const DEFAULT_LIMIT = 5000;

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const runtime = "nodejs";

export async function GET(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:email-signups:get",
    requiredRoles: ADMIN_EMAIL_SIGNUPS_ROLES,
    rateLimit: ADMIN_EMAIL_SIGNUPS_RATE_LIMIT,
    rateLimitExceededMessage: "Too many email signup requests. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!supabaseAdmin) {
    return respond.json(
      { error: "Supabase is not configured." },
      { status: 500 }
    );
  }

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(toInt(params.get("limit"), DEFAULT_LIMIT), 1), DEFAULT_LIMIT);

  const { data, error } = await supabaseAdmin
    .from("email_signups")
    .select("id, email, source, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    console.error("email signups admin read error:", error);
    return respond.json(
      { error: "Unable to read email signups." },
      { status: 500 }
    );
  }

  const email_signups = (data || []).map((row) => ({
    id: String(row?.id || ""),
    email: String(row?.email || ""),
    source: String(row?.source || "website"),
    created_at: row?.created_at || null
  }));

  return respond.json({
    email_signups
  });
}
