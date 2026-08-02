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

const readRpcRow = async (query) => {
  const { data, error } = await query;
  if (error) return { ok: false, row: null, error };
  const row = Array.isArray(data) ? data[0] || null : data || null;
  return { ok: true, row, error: null };
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
  const staleLabelBefore = new Date(Date.now() - 15 * 60 * 1000).toISOString();
  const staleEmailBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  const preorderEmailCutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();

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
    emailJobCounts,
    shipmentLabelErrors,
    staleLabelClaims,
    stalePreorderEmailClaims,
    preorderEmailBacklog
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
    getEmailJobStatusCounts(),
    readCount(
      supabaseAdmin
        .from("shipments")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending_label", "purchasing_label"])
        .not("label_purchase_error", "is", null)
        .neq("label_purchase_error", "")
    ),
    readCount(
      supabaseAdmin
        .from("shipments")
        .select("id", { count: "exact", head: true })
        .eq("status", "purchasing_label")
        .or(
          `label_purchase_started_at.is.null,label_purchase_started_at.lte.${staleLabelBefore}`
        )
    ),
    readCount(
      supabaseAdmin
        .from("preorder_release_events")
        .select("id", { count: "exact", head: true })
        .is("ready_pickup_email_sent_at", null)
        .not("ready_pickup_email_claim_token", "is", null)
        .or(
          `ready_pickup_email_claimed_at.is.null,ready_pickup_email_claimed_at.lte.${staleEmailBefore}`
        )
    ),
    readRpcRow(
      supabaseAdmin.rpc("get_preorder_ready_email_backlog_health", {
        p_cutoff: preorderEmailCutoff,
        p_max_events_per_order: 200
      })
    )
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
      key: "shipment_label_errors",
      label: "Shipments needing label attention",
      status: shipmentLabelErrors.ok
        ? statusFromCount(shipmentLabelErrors.count)
        : "warning",
      value: shipmentLabelErrors.ok ? String(shipmentLabelErrors.count) : "Unknown",
      detail: shipmentLabelErrors.ok
        ? "Review the Shipments sheet Label Error column."
        : toErrorText(shipmentLabelErrors.error)
    },
    {
      key: "stale_label_claims",
      label: "Stale label purchases",
      status: staleLabelClaims.ok ? statusFromCount(staleLabelClaims.count) : "warning",
      value: staleLabelClaims.ok ? String(staleLabelClaims.count) : "Unknown",
      detail: staleLabelClaims.ok
        ? "Label purchases should not remain claimed for more than 15 minutes."
        : toErrorText(staleLabelClaims.error)
    },
    {
      key: "confirmation_claims",
      label: "Orphan confirmation claims",
      status: emailJobCounts.ok
        ? statusFromCount(emailCounts.orphanClaims || 0)
        : claimedConfirmations.ok
          ? statusFromCount(claimedConfirmations.count)
          : "warning",
      value: emailJobCounts.ok
        ? String(emailCounts.orphanClaims || 0)
        : claimedConfirmations.ok
          ? String(claimedConfirmations.count)
          : "Unknown",
      detail: emailJobCounts.ok
        ? "Only claimed orders without an active email job are counted."
        : claimedConfirmations.ok
          ? "Email queue details were unavailable, so every unsent claim is shown."
          : toErrorText(claimedConfirmations.error)
    },
    {
      key: "stale_email_jobs",
      label: "Stale email job claims",
      status: emailJobCounts.ok
        ? statusFromCount(emailCounts.staleProcessing || 0)
        : "warning",
      value: emailJobCounts.ok ? String(emailCounts.staleProcessing || 0) : "Unknown",
      detail: emailJobCounts.ok
        ? "Processing jobs older than the 30-minute lease are recoverable by the next worker."
        : toErrorText(emailJobCounts.error)
    },
    {
      key: "stale_preorder_email_claims",
      label: "Stale preorder email claims",
      status: stalePreorderEmailClaims.ok
        ? statusFromCount(stalePreorderEmailClaims.count)
        : "warning",
      value: stalePreorderEmailClaims.ok
        ? String(stalePreorderEmailClaims.count)
        : "Unknown",
      detail: stalePreorderEmailClaims.ok
        ? "Preorder email claims older than 30 minutes can be recovered safely."
        : toErrorText(stalePreorderEmailClaims.error)
    },
    {
      key: "oversized_preorder_email_batches",
      label: "Oversized preorder email batches",
      status: preorderEmailBacklog.ok
        ? statusFromCount(preorderEmailBacklog.row?.poisoned_order_count || 0)
        : "warning",
      value: preorderEmailBacklog.ok
        ? String(preorderEmailBacklog.row?.poisoned_order_count || 0)
        : "Unknown",
      detail: preorderEmailBacklog.ok
        ? `${Number(preorderEmailBacklog.row?.poisoned_event_count || 0)} release events need operator review.`
        : toErrorText(preorderEmailBacklog.error)
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
