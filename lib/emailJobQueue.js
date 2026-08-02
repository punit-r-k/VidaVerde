import { randomUUID } from "node:crypto";
import { sendOrderConfirmationEmail } from "@/lib/orderConfirmationEmail";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ORDER_CONFIRMATION_JOB_TYPE = "order_confirmation";
const JOB_LEASE_MS = 30 * 60 * 1000;
const TRACKING_RETRY_DELAY_MS = 5 * 60 * 1000;
const DEFAULT_RETRY_DELAY_MS = 15 * 60 * 1000;
const MIN_RETRY_DELAY_MS = 60 * 1000;
const MAX_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;
export const EMAIL_JOB_WORKER_LIMIT = 5;
export const EMAIL_JOB_WORKER_BUDGET_MS = 25_000;

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toText = (value, max = 1000) =>
  String(value?.message || value?.details || value || "").trim().slice(0, max);

const toIsoAfter = (delayMs, now = Date.now()) =>
  new Date(now + delayMs).toISOString();

const toStaleBeforeIso = (now = Date.now()) =>
  new Date(now - JOB_LEASE_MS).toISOString();

const getRetryDelayMs = () => {
  const configured = toInt(
    process.env.EMAIL_JOB_RETRY_DELAY_MS,
    DEFAULT_RETRY_DELAY_MS
  );
  return Math.min(Math.max(configured, MIN_RETRY_DELAY_MS), MAX_RETRY_DELAY_MS);
};

const normalizeRpcObject = (value) => {
  if (!value) return null;
  if (Array.isArray(value)) return normalizeRpcObject(value[0]);
  if (typeof value === "string") {
    try {
      return normalizeRpcObject(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return typeof value === "object" ? value : null;
};

const getMessageIdDomain = () => {
  const from = String(process.env.ORDER_EMAIL_FROM || "").trim();
  const fromMatch = /@([a-z0-9.-]+)(?:>|\s|$)/i.exec(from);
  if (fromMatch?.[1]) return fromMatch[1].toLowerCase();

  for (const candidate of [process.env.SITE_URL, process.env.NEXT_PUBLIC_SITE_URL]) {
    try {
      const hostname = new URL(String(candidate || "").trim()).hostname;
      if (hostname) return hostname.toLowerCase();
    } catch {
      // Try the next configured source.
    }
  }

  return "vidaverde.invalid";
};

export const buildOrderConfirmationMessageId = (orderId) => {
  const normalizedOrderId = toText(orderId, 64)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (!normalizedOrderId) return "";
  return `<order-confirmation.${normalizedOrderId}@${getMessageIdDomain()}>`;
};

export const shouldQueueOrderConfirmationEmail = () => {
  const mode = String(process.env.ORDER_CONFIRMATION_EMAIL_MODE || "")
    .trim()
    .toLowerCase();
  return process.env.NODE_ENV === "production" || mode !== "inline";
};

export const getEmailJobDeliveryPolicy = (sendResult = {}) => {
  if (sendResult?.ok && !sendResult?.skipped) {
    return {
      outcome: "sent",
      code: "sent",
      consumeAttempt: false,
      terminal: false,
      retryDelayMs: 0
    };
  }

  const code = toText(
    sendResult?.code || (sendResult?.skipped ? "configuration_unavailable" : "email_failed"),
    80
  ).toLowerCase();

  if (code === "tracking_pending") {
    return {
      outcome: "deferred",
      code,
      consumeAttempt: false,
      terminal: false,
      retryDelayMs: TRACKING_RETRY_DELAY_MS
    };
  }

  if (code === "smtp_failed") {
    return {
      outcome: "failed",
      code,
      consumeAttempt: true,
      terminal: false,
      retryDelayMs: getRetryDelayMs()
    };
  }

  if (["invalid_payload", "order_ineligible", "unknown_job_type"].includes(code)) {
    return {
      outcome: "failed",
      code,
      consumeAttempt: false,
      terminal: true,
      retryDelayMs: 0
    };
  }

  return {
    outcome: "deferred",
    code: code || "email_failed",
    consumeAttempt: false,
    terminal: false,
    retryDelayMs: getRetryDelayMs()
  };
};

export async function enqueueOrderConfirmationEmail(orderPayload) {
  if (!supabaseAdmin) {
    return { ok: false, error: "The email queue is not connected right now." };
  }

  const orderId = toText(orderPayload?.orderId, 36);
  if (!orderId) {
    return { ok: false, error: "Choose an order before queueing an email." };
  }

  const claimToken = randomUUID();
  const messageId = buildOrderConfirmationMessageId(orderId);
  const { data, error } = await supabaseAdmin.rpc(
    "enqueue_order_confirmation_email",
    {
      p_order_id: orderId,
      p_payload: orderPayload || {},
      p_claim_token: claimToken,
      p_message_id: messageId
    }
  );

  if (error) {
    return { ok: false, error };
  }

  const jobId = typeof data === "string"
    ? data
    : toText(data?.id || data?.job_id, 36);

  return {
    ok: true,
    duplicate: !jobId,
    jobId: toText(jobId, 36),
    messageId
  };
}

const selectPendingEmailJobs = async (limit) => {
  const nowIso = new Date().toISOString();
  const staleBeforeIso = toStaleBeforeIso();
  const fetchLimit = Math.min(Math.max(limit * 3, limit), 75);

  const [pendingResult, staleResult] = await Promise.all([
    supabaseAdmin
      .from("email_jobs")
      .select("id, available_at, created_at")
      .eq("type", ORDER_CONFIRMATION_JOB_TYPE)
      .eq("status", "pending")
      .lte("available_at", nowIso)
      .order("available_at", { ascending: true })
      .order("created_at", { ascending: true })
      .limit(fetchLimit),
    supabaseAdmin
      .from("email_jobs")
      .select("id, available_at, created_at")
      .eq("type", ORDER_CONFIRMATION_JOB_TYPE)
      .eq("status", "processing")
      .lte("claimed_at", staleBeforeIso)
      .order("claimed_at", { ascending: true })
      .limit(fetchLimit)
  ]);

  if (pendingResult.error || staleResult.error) {
    return { ok: false, error: pendingResult.error || staleResult.error };
  }

  const jobsById = new Map();
  for (const job of [...(staleResult.data || []), ...(pendingResult.data || [])]) {
    const id = toText(job?.id, 36);
    if (id) jobsById.set(id, job);
  }

  const jobs = [...jobsById.values()]
    .sort((left, right) => {
      const leftTime = Date.parse(left?.available_at || left?.created_at || 0) || 0;
      const rightTime = Date.parse(right?.available_at || right?.created_at || 0) || 0;
      return leftTime - rightTime;
    })
    .slice(0, limit);

  return { ok: true, jobs, staleBeforeIso };
};

const claimEmailJob = async (jobId, staleBeforeIso) => {
  const claimToken = randomUUID();
  const { data, error } = await supabaseAdmin.rpc("claim_email_job", {
    p_job_id: toText(jobId, 36),
    p_stale_before: staleBeforeIso || toStaleBeforeIso(),
    p_claim_token: claimToken
  });

  if (error) {
    return { ok: false, error };
  }

  const job = normalizeRpcObject(data);
  if (!job?.id) {
    return { ok: true, claimed: false };
  }

  return {
    ok: true,
    claimed: true,
    job: {
      ...job,
      claim_token: toText(job.claim_token, 36) || claimToken,
      message_id:
        toText(job.message_id, 320) ||
        buildOrderConfirmationMessageId(job.order_id || job?.payload?.orderId)
    }
  };
};

const rescheduleOrFailEmailJob = async (job, sendResult) => {
  const policy = getEmailJobDeliveryPolicy(sendResult);
  const nextAvailableAt = policy.terminal
    ? null
    : toIsoAfter(policy.retryDelayMs || getRetryDelayMs());
  const errorText = toText(
    sendResult?.error || sendResult?.reason || "Email delivery did not complete.",
    1000
  );

  const { data, error } = await supabaseAdmin.rpc(
    "reschedule_or_fail_email_job",
    {
      p_job_id: toText(job?.id, 36),
      p_claim_token: toText(job?.claim_token, 36),
      p_error_code: policy.code,
      p_error: errorText,
      p_consume_attempt: policy.consumeAttempt,
      p_next_available_at: nextAvailableAt
    }
  );

  if (error) {
    return { ok: false, error, policy };
  }

  const state = normalizeRpcObject(data);
  if (!state?.status) {
    return {
      ok: false,
      error: "The claimed email job could not be rescheduled or failed safely.",
      policy
    };
  }
  return {
    ok: true,
    policy,
    status: toText(state.status, 32),
    attempts: toInt(state.attempts, toInt(job?.attempts, 0)),
    exhausted: Boolean(state.exhausted) || toText(state.status, 32) === "failed"
  };
};

const completeEmailJob = async (job) => {
  const { data, error } = await supabaseAdmin.rpc("complete_email_job", {
    p_job_id: toText(job?.id, 36),
    p_claim_token: toText(job?.claim_token, 36),
    p_sent_at: new Date().toISOString()
  });

  if (error) return { ok: false, error };
  if (data !== true) {
    return {
      ok: false,
      error: "The sent email could not be atomically marked complete."
    };
  }

  return { ok: true };
};

const processEmailJob = async (candidate, staleBeforeIso) => {
  const claim = await claimEmailJob(candidate?.id, staleBeforeIso);
  if (!claim.ok) {
    return {
      ok: false,
      skipped: false,
      outcome: "failed",
      code: "claim_failed",
      error: claim.error
    };
  }

  if (!claim.claimed) {
    return {
      ok: true,
      skipped: true,
      outcome: "skipped",
      code: "claim_skipped"
    };
  }

  const job = claim.job;
  if (job.type !== ORDER_CONFIRMATION_JOB_TYPE || !job.payload || typeof job.payload !== "object") {
    const update = await rescheduleOrFailEmailJob(job, {
      ok: false,
      code: "invalid_payload",
      error: "Unknown email job type or invalid payload."
    });
    return {
      ok: update.ok,
      skipped: false,
      outcome: "failed",
      code: "invalid_payload",
      error: update.ok ? "Invalid email job payload." : update.error
    };
  }

  let sendResult;
  try {
    sendResult = await sendOrderConfirmationEmail(job.payload, {
      messageId: job.message_id
    });
  } catch (error) {
    sendResult = {
      ok: false,
      code: "email_preparation_failed",
      error
    };
  }

  const policy = getEmailJobDeliveryPolicy(sendResult);
  if (policy.outcome !== "sent") {
    const update = await rescheduleOrFailEmailJob(job, sendResult);
    if (!update.ok) {
      return { ok: false, skipped: false, outcome: "failed", error: update.error };
    }

    return {
      ok: true,
      skipped: false,
      outcome: update.status === "failed" ? "failed" : policy.outcome,
      code: policy.code,
      error: sendResult?.error || sendResult?.reason || "",
      exhausted: update.exhausted
    };
  }

  const completed = await completeEmailJob(job);
  if (!completed.ok) {
    return {
      ok: false,
      skipped: false,
      outcome: "completion_failed",
      code: "completion_failed",
      error: completed.error
    };
  }

  return { ok: true, skipped: false, outcome: "sent", code: "sent" };
};

export async function processOrderConfirmationEmailJob(jobId) {
  if (!supabaseAdmin) {
    return { ok: false, error: "The email queue is not connected right now." };
  }

  const normalizedJobId = toText(jobId, 36);
  if (!normalizedJobId) {
    return { ok: false, error: "Choose an email job before processing it." };
  }

  return processEmailJob({ id: normalizedJobId }, toStaleBeforeIso());
}

export async function processEmailJobs({ limit = 10 } = {}) {
  if (!supabaseAdmin) {
    return { ok: false, error: "The email queue is not connected right now." };
  }

  const safeLimit = Math.min(
    Math.max(toInt(limit, EMAIL_JOB_WORKER_LIMIT), 1),
    EMAIL_JOB_WORKER_LIMIT
  );
  const selected = await selectPendingEmailJobs(safeLimit);
  if (!selected.ok) return selected;

  const errors = [];
  let sentCount = 0;
  let failedCount = 0;
  let deferredCount = 0;
  let trackingPendingCount = 0;
  let skippedCount = 0;
  const outcomes = [];
  const workerDeadlineAt = Date.now() + EMAIL_JOB_WORKER_BUDGET_MS;
  let deadlineDeferredCount = 0;

  for (let jobIndex = 0; jobIndex < selected.jobs.length; jobIndex += 1) {
    if (Date.now() >= workerDeadlineAt) {
      deadlineDeferredCount += selected.jobs.length - jobIndex;
      break;
    }
    const job = selected.jobs[jobIndex];
    const result = await processEmailJob(job, selected.staleBeforeIso);
    outcomes.push({
      jobId: toText(job?.id, 36),
      outcome: toText(result.outcome || (result.ok ? "processed" : "failed"), 32),
      code: toText(result.code || (result.ok ? "processed" : "processing_failed"), 80)
    });
    if (result.skipped) skippedCount += 1;
    if (result.outcome === "sent") sentCount += 1;
    if (result.outcome === "failed" || result.outcome === "completion_failed") {
      failedCount += 1;
    }
    if (result.outcome === "deferred") deferredCount += 1;
    if (result.code === "tracking_pending") trackingPendingCount += 1;

    if (!result.ok) {
      errors.push({
        jobId: toText(job?.id, 36),
        error: toText(result.error, 1000)
      });
    }
  }

  return {
    ok: true,
    deliveryOk: errors.length === 0 && failedCount === 0,
    processed: outcomes.length,
    sentCount,
    failedCount,
    deferredCount,
    trackingPendingCount,
    skippedCount,
    deadlineDeferredCount,
    outcomes,
    errors
  };
}

export async function retryFailedEmailJobs({ limit = 10 } = {}) {
  if (!supabaseAdmin) {
    return { ok: false, error: "The email queue is not connected right now." };
  }

  const safeLimit = Math.min(Math.max(toInt(limit, 10), 1), 25);
  const { data, error } = await supabaseAdmin
    .from("email_jobs")
    .select("id")
    .eq("type", ORDER_CONFIRMATION_JOB_TYPE)
    .eq("status", "failed")
    .order("processed_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(safeLimit);

  if (error) return { ok: false, error };

  let retriedCount = 0;
  let skippedCount = 0;
  const errors = [];
  const availableAt = new Date().toISOString();

  for (const row of data || []) {
    const { data: retried, error: retryError } = await supabaseAdmin.rpc(
      "retry_failed_email_job",
      {
        p_job_id: toText(row?.id, 36),
        p_available_at: availableAt
      }
    );

    if (retryError) {
      errors.push({ jobId: toText(row?.id, 36), error: toText(retryError, 1000) });
    } else if (retried === true) {
      retriedCount += 1;
    } else {
      skippedCount += 1;
    }
  }

  return {
    ok: errors.length === 0,
    requested: (data || []).length,
    retriedCount,
    skippedCount,
    errors,
    error: errors[0]?.error || null
  };
}

export async function getEmailJobStatusCounts({ staleBefore = "" } = {}) {
  if (!supabaseAdmin) {
    return { ok: false, error: "The email queue is not connected right now." };
  }

  const counts = {};
  const errors = [];

  for (const status of ["pending", "processing", "sent", "failed"]) {
    const { count, error } = await supabaseAdmin
      .from("email_jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", status);

    if (error) {
      errors.push(error);
      counts[status] = null;
    } else {
      counts[status] = count || 0;
    }
  }

  const parsedStaleBefore = Date.parse(String(staleBefore || ""));
  const staleBeforeIso = Number.isFinite(parsedStaleBefore)
    ? new Date(parsedStaleBefore).toISOString()
    : toStaleBeforeIso();
  const { count: staleProcessing, error: staleError } = await supabaseAdmin
    .from("email_jobs")
    .select("id", { count: "exact", head: true })
    .eq("status", "processing")
    .lte("claimed_at", staleBeforeIso);
  if (staleError) errors.push(staleError);
  counts.staleProcessing = staleError ? null : staleProcessing || 0;

  const { data: claimedOrders, error: claimedError } = await supabaseAdmin
    .from("orders")
    .select("id")
    .is("customer_confirmation_email_sent_at", null)
    .lte("customer_confirmation_email_claimed_at", staleBeforeIso)
    .limit(1000);

  if (claimedError) {
    errors.push(claimedError);
    counts.orphanClaims = null;
  } else {
    const claimedIds = (claimedOrders || []).map((row) => toText(row?.id, 36)).filter(Boolean);
    if (claimedIds.length === 0) {
      counts.orphanClaims = 0;
    } else {
      const { data: activeJobs, error: jobsError } = await supabaseAdmin
        .from("email_jobs")
        .select("order_id")
        .in("order_id", claimedIds)
        .in("status", ["pending", "processing"]);

      if (jobsError) {
        errors.push(jobsError);
        counts.orphanClaims = null;
      } else {
        const activeOrderIds = new Set(
          (activeJobs || []).map((row) => toText(row?.order_id, 36)).filter(Boolean)
        );
        counts.orphanClaims = claimedIds.filter((id) => !activeOrderIds.has(id)).length;
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, counts, error: errors[0] };
  }

  return { ok: true, counts };
}
