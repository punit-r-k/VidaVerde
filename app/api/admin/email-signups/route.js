import { secureAdminRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { z } from "zod";

const ADMIN_EMAIL_SIGNUPS_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_EMAIL_SIGNUPS_GET", {
  windowMs: 60_000,
  ipMax: 120,
  userMax: 90
});

const ADMIN_EMAIL_SIGNUPS_ROLES = ["admin", "ops_admin"];
const DEFAULT_LIMIT = 5000;
const unsubscribePayloadSchema = z
  .object({
    emails: z
      .array(z.string().trim().toLowerCase().email().max(254))
      .min(1)
      .max(100),
    reason: z.enum(["manual_sheet", "stop_reply"]).optional()
  })
  .strict();

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
      { error: "Email signups are not connected right now." },
      { status: 500 }
    );
  }

  const params = new URL(request.url).searchParams;
  const limit = Math.min(Math.max(toInt(params.get("limit"), DEFAULT_LIMIT), 1), DEFAULT_LIMIT);

  const [signupsResult, suppressionsResult] = await Promise.all([
    supabaseAdmin
      .from("email_signups")
      .select("id, email, source, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("do_not_market")
      .select("email, reason, unsubscribed_at")
      .order("unsubscribed_at", { ascending: false })
      .limit(limit)
  ]);

  if (signupsResult.error || suppressionsResult.error) {
    console.error(
      "email signups admin read error:",
      signupsResult.error || suppressionsResult.error
    );
    return respond.json(
      { error: "We couldn't load email signups right now." },
      { status: 500 }
    );
  }

  const email_signups = (signupsResult.data || []).map((row) => ({
    id: String(row?.id || ""),
    email: String(row?.email || ""),
    source: String(row?.source || "website"),
    created_at: row?.created_at || null
  }));

  return respond.json({
    email_signups,
    do_not_market: (suppressionsResult.data || []).map((row) => ({
      email: String(row?.email || ""),
      reason: String(row?.reason || "manual"),
      unsubscribed_at: row?.unsubscribed_at || null
    }))
  });
}

export async function DELETE(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:email-signups:delete",
    requiredRoles: ADMIN_EMAIL_SIGNUPS_ROLES,
    rateLimit: ADMIN_EMAIL_SIGNUPS_RATE_LIMIT,
    rateLimitExceededMessage: "Too many email list updates. Please wait and try again."
  });
  if (!security.ok) return security.response;

  const { respond } = security;
  if (!supabaseAdmin) {
    return respond.json(
      { error: "Email signups are not connected right now." },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json({ error: "We couldn't read that unsubscribe request." }, { status: 400 });
  }

  const parsed = unsubscribePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return respond.json({ error: "Provide at least one valid email address." }, { status: 400 });
  }

  const emails = [...new Set(parsed.data.emails)];
  const { data, error } = await supabaseAdmin.rpc("unsubscribe_email_addresses", {
    p_emails: emails,
    p_reason: parsed.data.reason || "manual_sheet",
    p_source_message_id: null
  });

  if (error) {
    console.error("email signups admin delete error:", error);
    return respond.json({ error: "We couldn't remove those email signups right now." }, { status: 500 });
  }

  return respond.json({ ok: true, removed_count: Number(data) || 0 });
}
