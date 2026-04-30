import { sendOrderConfirmationEmail } from "@/lib/orderConfirmationEmail";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ORDER_CONFIRMATION_EMAIL_MODE = String(
  process.env.ORDER_CONFIRMATION_EMAIL_MODE || ""
).trim().toLowerCase();
const ORDER_CONFIRMATION_JOB_TYPE = "order_confirmation";
const DEFAULT_RETRY_DELAY_MS = 15 * 60 * 1000;

const toInt = (value, fallback = 0) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const toText = (value, max = 1000) =>
  String(value || "").trim().slice(0, max);

const getRetryDelayMs = () => {
  const configured = toInt(process.env.EMAIL_JOB_RETRY_DELAY_MS, DEFAULT_RETRY_DELAY_MS);
  return configured > 0 ? configured : DEFAULT_RETRY_DELAY_MS;
};

const getNextAvailableAt = () =>
  new Date(Date.now() + getRetryDelayMs()).toISOString();

const isUniqueViolation = (error) =>
  String(error?.code || "") === "23505" ||
  String(error?.message || "").toLowerCase().includes("duplicate key");

export const shouldQueueOrderConfirmationEmail = () =>
  ORDER_CONFIRMATION_EMAIL_MODE === "queue";

export async function enqueueOrderConfirmationEmail(orderPayload) {
  if (!supabaseAdmin) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const orderId = toText(orderPayload?.orderId, 36);
  if (!orderId) {
    return { ok: false, error: "Order id is required." };
  }

  const { data, error } = await supabaseAdmin
    .from("email_jobs")
    .insert({
      type: ORDER_CONFIRMATION_JOB_TYPE,
      status: "pending",
      order_id: orderId,
      payload: orderPayload || {},
      available_at: new Date().toISOString()
    })
    .select("id")
    .maybeSingle();

  if (error) {
    if (isUniqueViolation(error)) {
      return { ok: true, duplicate: true, jobId: "" };
    }

    return { ok: false, error };
  }

  return { ok: true, jobId: String(data?.id || "") };
}

const selectPendingEmailJobs = async (limit) => {
  const nowIso = new Date().toISOString();
  const fetchLimit = Math.min(Math.max(limit * 3, limit), 75);

  const { data, error } = await supabaseAdmin
    .from("email_jobs")
    .select("id, type, status, order_id, payload, attempts, max_attempts, available_at")
    .in("status", ["pending", "failed"])
    .lte("available_at", nowIso)
    .order("available_at", { ascending: true })
    .order("created_at", { ascending: true })
    .limit(fetchLimit);

  if (error) {
    return { ok: false, error };
  }

  const jobs = (data || [])
    .filter((job) => toInt(job?.attempts, 0) < toInt(job?.max_attempts, 1))
    .slice(0, limit);

  return { ok: true, jobs };
};

const claimEmailJob = async (job) => {
  const attempts = toInt(job?.attempts, 0) + 1;
  const nowIso = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("email_jobs")
    .update({
      status: "processing",
      attempts,
      claimed_at: nowIso,
      last_error: null
    })
    .eq("id", job.id)
    .in("status", ["pending", "failed"])
    .lte("available_at", nowIso)
    .lt("attempts", toInt(job?.max_attempts, 1))
    .select("id, type, order_id, payload, attempts, max_attempts")
    .maybeSingle();

  if (error) {
    return { ok: false, error };
  }

  if (!data?.id) {
    return { ok: true, claimed: false };
  }

  return { ok: true, claimed: true, job: data };
};

const markEmailJobSent = async (job) => {
  const sentAt = new Date().toISOString();

  const { error: jobError } = await supabaseAdmin
    .from("email_jobs")
    .update({
      status: "sent",
      processed_at: sentAt,
      claimed_at: null,
      last_error: null
    })
    .eq("id", job.id);

  const orderId = toText(job?.order_id || job?.payload?.orderId, 36);
  if (!orderId) {
    return jobError;
  }

  const { error: orderError } = await supabaseAdmin
    .from("orders")
    .update({
      customer_confirmation_email_sent_at: sentAt,
      customer_confirmation_email_claimed_at: null
    })
    .eq("id", orderId)
    .is("customer_confirmation_email_sent_at", null);

  return jobError || orderError;
};

const markEmailJobFailed = async (job, error) => {
  const attempts = toInt(job?.attempts, 0);
  const maxAttempts = toInt(job?.max_attempts, 1);
  const exhausted = attempts >= maxAttempts;

  const { error: updateError } = await supabaseAdmin
    .from("email_jobs")
    .update({
      status: "failed",
      claimed_at: null,
      processed_at: exhausted ? new Date().toISOString() : null,
      available_at: exhausted ? new Date().toISOString() : getNextAvailableAt(),
      last_error: toText(error?.message || error?.error || error, 1000)
    })
    .eq("id", job.id);

  return updateError;
};

const processEmailJob = async (candidate) => {
  const claim = await claimEmailJob(candidate);
  if (!claim.ok) {
    return { ok: false, skipped: false, error: claim.error };
  }

  if (!claim.claimed) {
    return { ok: true, skipped: true };
  }

  const job = claim.job;
  if (job.type !== ORDER_CONFIRMATION_JOB_TYPE) {
    const updateError = await markEmailJobFailed(job, "Unknown email job type.");
    return {
      ok: false,
      skipped: false,
      error: updateError || "Unknown email job type."
    };
  }

  const sendResult = await sendOrderConfirmationEmail(job.payload || {});
  if (sendResult.skipped) {
    const updateError = await markEmailJobFailed(job, sendResult.reason || sendResult.error);
    return {
      ok: false,
      skipped: true,
      error: updateError || sendResult.reason || sendResult.error
    };
  }

  if (!sendResult.ok) {
    const updateError = await markEmailJobFailed(job, sendResult.error);
    return {
      ok: false,
      skipped: false,
      error: updateError || sendResult.error
    };
  }

  const markError = await markEmailJobSent(job);
  if (markError) {
    return { ok: false, skipped: false, error: markError };
  }

  return { ok: true, skipped: false };
};

export async function processEmailJobs({ limit = 10 } = {}) {
  if (!supabaseAdmin) {
    return { ok: false, error: "Supabase is not configured." };
  }

  const safeLimit = Math.min(Math.max(toInt(limit, 10), 1), 25);
  const selected = await selectPendingEmailJobs(safeLimit);
  if (!selected.ok) {
    return selected;
  }

  const errors = [];
  let processed = 0;
  let sentCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  for (const job of selected.jobs) {
    const result = await processEmailJob(job);
    if (result.skipped) {
      skippedCount += 1;
    }

    if (result.ok && !result.skipped) {
      sentCount += 1;
    }

    if (!result.ok) {
      failedCount += 1;
      errors.push({
        jobId: String(job?.id || ""),
        error: result.error
      });
    }

    processed += 1;
  }

  return {
    ok: true,
    deliveryOk: errors.length === 0,
    processed,
    sentCount,
    failedCount,
    skippedCount,
    errors
  };
}

export async function getEmailJobStatusCounts() {
  if (!supabaseAdmin) {
    return { ok: false, error: "Supabase is not configured." };
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
      continue;
    }

    counts[status] = count || 0;
  }

  if (errors.length > 0) {
    return { ok: false, counts, error: errors[0] };
  }

  return { ok: true, counts };
}
