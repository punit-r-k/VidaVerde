import { secureAdminRoute } from "@/lib/apiSecurity";
import { buildPendingEmailQueueRows } from "@/lib/pendingEmailQueue";
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
const restorePayloadSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(254)
  })
  .strict();
const batchChangesPayloadSchema = z
  .object({
    remove_emails: z.array(z.string().trim().toLowerCase().email().max(254)).max(500),
    restore_emails: z.array(z.string().trim().toLowerCase().email().max(254)).max(500)
  })
  .strict()
  .refine(
    (value) => value.remove_emails.length > 0 || value.restore_emails.length > 0,
    "Select at least one email-list change."
  );

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

  const [
    signupsResult,
    suppressionsResult,
    confirmationJobsResult,
    preorderReleaseEventsResult
  ] = await Promise.all([
    supabaseAdmin
      .from("email_signups")
      .select("id, email, source, created_at")
      .order("created_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("do_not_market")
      .select("email, reason, unsubscribed_at")
      .order("unsubscribed_at", { ascending: false })
      .limit(limit),
    supabaseAdmin
      .from("email_jobs")
      .select(
        "id, type, status, order_id, shipment_id, attempts, max_attempts, available_at, claimed_at, last_error_code, created_at, orders!inner(customer_email, is_test_order)"
      )
      .in("type", ["order_confirmation", "shipment_tracking"])
      .in("status", ["pending", "processing", "failed"])
      .order("created_at", { ascending: true })
      .limit(limit),
    supabaseAdmin
      .from("preorder_release_events")
      .select(
        "id, order_id, created_at, ready_pickup_email_claim_token, ready_pickup_email_claimed_at, orders!inner(id, status, fulfillment, customer_email, is_test_order)"
      )
      .eq("orders.status", "paid")
      .is("ready_pickup_email_sent_at", null)
      .order("created_at", { ascending: true })
      .limit(limit)
  ]);

  const readError =
    signupsResult.error ||
    suppressionsResult.error ||
    confirmationJobsResult.error ||
    preorderReleaseEventsResult.error;
  if (readError) {
    console.error(
      "email signups admin read error:",
      readError
    );
    return respond.json(
      { error: "We couldn't load the email list or pending queue right now." },
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
    })),
    pending_emails: buildPendingEmailQueueRows({
      confirmationJobs: confirmationJobsResult.data || [],
      preorderReleaseEvents: preorderReleaseEventsResult.data || []
    })
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

export async function PATCH(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:email-signups:restore",
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
    return respond.json({ error: "We couldn't read that restore request." }, { status: 400 });
  }

  const parsed = restorePayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return respond.json({ error: "Provide a valid email address." }, { status: 400 });
  }

  const { error } = await supabaseAdmin.rpc("subscribe_email_address", {
    p_email: parsed.data.email,
    p_source: "admin_restore",
    p_ip_address: null,
    p_user_agent: null
  });

  if (error) {
    console.error("email signups admin restore error:", error);
    return respond.json({ error: "We couldn't add that address back right now." }, { status: 500 });
  }

  return respond.json({ ok: true });
}

export async function PUT(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:email-signups:batch-update",
    requiredRoles: ADMIN_EMAIL_SIGNUPS_ROLES,
    rateLimit: ADMIN_EMAIL_SIGNUPS_RATE_LIMIT,
    rateLimitExceededMessage: "Too many email list updates. Please wait and try again."
  });
  if (!security.ok) return security.response;

  const { respond } = security;
  if (!supabaseAdmin) {
    return respond.json({ error: "Email signups are not connected right now." }, { status: 500 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json({ error: "We couldn't read those email-list changes." }, { status: 400 });
  }

  const parsed = batchChangesPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    return respond.json(
      { error: parsed.error.issues[0]?.message || "Check the selected email-list changes." },
      { status: 400 }
    );
  }

  const { data, error } = await supabaseAdmin.rpc("apply_email_list_changes", {
    p_remove_emails: [...new Set(parsed.data.remove_emails)],
    p_restore_emails: [...new Set(parsed.data.restore_emails)]
  });

  if (error) {
    console.error("email signups batch update error:", error);
    return respond.json({ error: "We couldn't apply those email-list changes." }, { status: 500 });
  }

  return respond.json({ ok: true, ...data });
}
