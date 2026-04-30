import { secureAdminRoute } from "@/lib/apiSecurity";
import { getEmailJobStatusCounts } from "@/lib/emailJobQueue";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ADMIN_HEALTH_RATE_LIMIT = getRouteRateLimitConfig("ADMIN_HEALTH_GET", {
  windowMs: 60_000,
  ipMax: 120,
  userMax: 60
});

const ADMIN_HEALTH_ROLES = ["admin", "ops_admin"];

const toErrorText = (error) =>
  String(error?.message || error?.details || error || "Unknown error").slice(0, 500);

const isMissingDatabaseObjectError = (error) => {
  const text = toErrorText(error).toLowerCase();
  return text.includes("does not exist") || text.includes("could not find");
};

const statusFromCount = (count, warningThreshold = 1) =>
  Number(count || 0) >= warningThreshold ? "warning" : "ok";

const readCount = async (query) => {
  const { count, error } = await query;
  if (error) {
    return { ok: false, count: null, error };
  }

  return { ok: true, count: count || 0 };
};

const readLatestValue = async (query, field) => {
  const { data, error } = await query;
  if (error) {
    return { ok: false, value: "", error };
  }

  return { ok: true, value: data?.[field] || "" };
};

const maxIsoValue = (...values) =>
  values
    .map((value) => String(value || "").trim())
    .filter(Boolean)
    .sort()
    .at(-1) || "";

export const runtime = "nodejs";

export async function GET(request) {
  const security = await secureAdminRoute(request, {
    scope: "admin:health:get",
    requiredRoles: ADMIN_HEALTH_ROLES,
    rateLimit: ADMIN_HEALTH_RATE_LIMIT,
    rateLimitExceededMessage: "Too many health check requests. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;
  const generatedAt = new Date().toISOString();

  if (!supabaseAdmin) {
    return respond.json(
      {
        ok: false,
        generatedAt,
        checks: [
          {
            key: "database",
            label: "Database",
            status: "error",
            value: "Not configured",
            detail: "Supabase service settings are missing."
          }
        ]
      },
      { status: 500 }
    );
  }

  const [
    latestOrder,
    missingPickupDates,
    claimedConfirmations,
    latestRestock,
    latestOrderReminder,
    latestPreorderReminder,
    emailJobCounts
  ] = await Promise.all([
    readLatestValue(
      supabaseAdmin
        .from("orders")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "created_at"
    ),
    readCount(
      supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "paid")
        .eq("fulfillment", "market")
        .is("pickup_date", null)
    ),
    readCount(
      supabaseAdmin
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "paid")
        .is("customer_confirmation_email_sent_at", null)
        .not("customer_confirmation_email_claimed_at", "is", null)
    ),
    readLatestValue(
      supabaseAdmin
        .from("restock_events")
        .select("created_at")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "created_at"
    ),
    readLatestValue(
      supabaseAdmin
        .from("orders")
        .select("pickup_reminder_email_sent_at")
        .not("pickup_reminder_email_sent_at", "is", null)
        .order("pickup_reminder_email_sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "pickup_reminder_email_sent_at"
    ),
    readLatestValue(
      supabaseAdmin
        .from("preorder_release_events")
        .select("pickup_reminder_email_sent_at")
        .not("pickup_reminder_email_sent_at", "is", null)
        .order("pickup_reminder_email_sent_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      "pickup_reminder_email_sent_at"
    ),
    getEmailJobStatusCounts()
  ]);

  const latestReminder = maxIsoValue(
    latestOrderReminder.value,
    latestPreorderReminder.value
  );
  const emailCounts = emailJobCounts.counts || {};
  const emailQueueMissing =
    !emailJobCounts.ok && isMissingDatabaseObjectError(emailJobCounts.error);

  const checks = [
    {
      key: "database",
      label: "Database",
      status: "ok",
      value: "Connected",
      detail: ""
    },
    {
      key: "latest_order",
      label: "Latest order",
      status: latestOrder.ok ? "ok" : "warning",
      value: latestOrder.value || "No orders yet",
      detail: latestOrder.ok ? "" : toErrorText(latestOrder.error)
    },
    {
      key: "pickup_date_backfill",
      label: "Market orders missing pickup date",
      status: missingPickupDates.ok
        ? statusFromCount(missingPickupDates.count)
        : "warning",
      value: missingPickupDates.ok ? String(missingPickupDates.count) : "Unknown",
      detail: missingPickupDates.ok
        ? "Preorder-only market orders may intentionally stay blank until inventory is ready."
        : toErrorText(missingPickupDates.error)
    },
    {
      key: "confirmation_claims",
      label: "Claimed confirmations not sent",
      status: claimedConfirmations.ok
        ? statusFromCount(claimedConfirmations.count)
        : "warning",
      value: claimedConfirmations.ok ? String(claimedConfirmations.count) : "Unknown",
      detail: claimedConfirmations.ok
        ? "These are orders reserved for confirmation email delivery but not yet marked sent."
        : toErrorText(claimedConfirmations.error)
    },
    {
      key: "email_queue",
      label: "Email queue",
      status: emailJobCounts.ok ? "ok" : "warning",
      value: emailJobCounts.ok
        ? `pending ${emailCounts.pending || 0}, failed ${emailCounts.failed || 0}`
        : "Unavailable",
      detail: emailJobCounts.ok
        ? `processing ${emailCounts.processing || 0}, sent ${emailCounts.sent || 0}`
        : emailQueueMissing
          ? "Run the email jobs migration to enable queued confirmation emails."
          : toErrorText(emailJobCounts.error)
    },
    {
      key: "email_queue_failures",
      label: "Failed email jobs",
      status: emailJobCounts.ok ? statusFromCount(emailCounts.failed || 0) : "warning",
      value: emailJobCounts.ok ? String(emailCounts.failed || 0) : "Unknown",
      detail: emailJobCounts.ok ? "" : toErrorText(emailJobCounts.error)
    },
    {
      key: "latest_restock",
      label: "Latest restock update",
      status: latestRestock.ok ? "ok" : "warning",
      value: latestRestock.value || "No restock events yet",
      detail: latestRestock.ok ? "" : toErrorText(latestRestock.error)
    },
    {
      key: "latest_pickup_reminder",
      label: "Latest pickup reminder",
      status:
        latestOrderReminder.ok && latestPreorderReminder.ok ? "ok" : "warning",
      value: latestReminder || "No pickup reminders sent yet",
      detail:
        latestOrderReminder.ok && latestPreorderReminder.ok
          ? ""
          : [latestOrderReminder.error, latestPreorderReminder.error]
              .filter(Boolean)
              .map(toErrorText)
              .join(" | ")
    }
  ];

  return respond.json({
    ok: checks.every((check) => check.status !== "error"),
    generatedAt,
    checks
  });
}
