const EMAIL_SEND_LEASE_MS = 30 * 60 * 1000;
const PREORDER_CONSOLIDATION_MS = 5 * 60 * 1000;

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);

const toTimestamp = (value) => {
  const parsed = Date.parse(toText(value, 64));
  return Number.isFinite(parsed) ? parsed : null;
};

const toIso = (value) => {
  const parsed = toTimestamp(value);
  return parsed === null ? null : new Date(parsed).toISOString();
};

const getEmbeddedOrder = (row) => {
  const order = Array.isArray(row?.orders) ? row.orders[0] : row?.orders;
  return order && typeof order === "object" ? order : {};
};

const getConfirmationFailureLabel = (code) => {
  switch (toText(code, 80).toLowerCase()) {
    case "smtp_failed":
      return "the mail server did not accept the send";
    case "configuration_unavailable":
      return "the email service is not configured";
    case "dependency_unavailable":
      return "required order information is temporarily unavailable";
    case "email_preparation_failed":
      return "the email content could not be prepared";
    case "invalid_payload":
      return "the saved confirmation details are invalid";
    case "order_ineligible":
      return "the order is no longer eligible for a confirmation";
    case "unknown_job_type":
      return "the saved email type is not recognized";
    case "completion_failed":
      return "the sent-email completion marker could not be saved";
    default:
      return "a temporary delivery problem occurred";
  }
};

const getFailedConfirmationAction = (code) => {
  switch (toText(code, 80).toLowerCase()) {
    case "invalid_payload":
      return "Review the saved order details before retrying.";
    case "order_ineligible":
      return "Review the order and payment status; this email should not send unless the order becomes eligible again.";
    case "unknown_job_type":
      return "Developer review is required before this email can send.";
    default:
      return "Use Retry Failed Confirmations.";
  }
};

const buildConfirmationQueueRow = (job, nowMs) => {
  const order = getEmbeddedOrder(job);
  const recipient = toText(order?.customer_email || job?.payload?.customer?.email, 254)
    .toLowerCase();
  const orderId = toText(job?.order_id || job?.payload?.orderId, 36);
  if (!recipient || !orderId) return null;

  const status = toText(job?.status, 32).toLowerCase();
  const availableAtMs = toTimestamp(job?.available_at);
  const claimedAtMs = toTimestamp(job?.claimed_at);
  const errorCode = toText(job?.last_error_code, 80);
  const failureLabel = getConfirmationFailureLabel(errorCode);
  const isTestOrder = order?.is_test_order === true || job?.payload?.isTestOrder === true;

  let displayStatus = "Pending";
  let pendingFor = "Waiting for the immediate automatic send attempt.";

  if (status === "processing") {
    const claimIsStale = claimedAtMs === null || claimedAtMs <= nowMs - EMAIL_SEND_LEASE_MS;
    displayStatus = claimIsStale ? "Recovery pending" : "Sending now";
    pendingFor = claimIsStale
      ? "The previous send was interrupted; waiting for automatic recovery."
      : "The automatic sender is delivering it now.";
  } else if (status === "failed") {
    displayStatus = "Needs attention";
    pendingFor = `Automatic attempts stopped because ${failureLabel}. ${getFailedConfirmationAction(errorCode)}`;
  } else if (errorCode) {
    const retryIsScheduled = availableAtMs !== null && availableAtMs > nowMs;
    displayStatus = retryIsScheduled ? "Retry scheduled" : "Pending retry";
    pendingFor = retryIsScheduled
      ? `Waiting for the scheduled automatic retry because ${failureLabel}.`
      : `Ready for automatic retry because ${failureLabel}.`;
  }

  return {
    id: `confirmation:${toText(job?.id, 36) || orderId}`,
    queued_at: toIso(job?.created_at),
    recipient,
    email_for: `Order confirmation${isTestOrder ? " (test order)" : ""}`,
    status: displayStatus,
    pending_for: pendingFor,
    order_id: orderId
  };
};

const buildPreorderQueueRows = (events, nowMs) => {
  const grouped = new Map();

  for (const event of Array.isArray(events) ? events : []) {
    const order = getEmbeddedOrder(event);
    const orderId = toText(event?.order_id || order?.id, 36);
    const recipient = toText(order?.customer_email, 254).toLowerCase();
    const createdAtMs = toTimestamp(event?.created_at);
    if (!orderId || !recipient || createdAtMs === null) continue;

    const existing = grouped.get(orderId) || {
      orderId,
      recipient,
      fulfillment: toText(order?.fulfillment, 16).toLowerCase(),
      isTestOrder: order?.is_test_order === true,
      firstCreatedAtMs: createdAtMs,
      latestCreatedAtMs: createdAtMs,
      claimedAtMs: null,
      hasClaim: false,
      firstEventId: toText(event?.id, 36)
    };

    existing.firstCreatedAtMs = Math.min(existing.firstCreatedAtMs, createdAtMs);
    existing.latestCreatedAtMs = Math.max(existing.latestCreatedAtMs, createdAtMs);
    if (toText(event?.ready_pickup_email_claim_token, 64)) {
      existing.hasClaim = true;
      const claimedAtMs = toTimestamp(event?.ready_pickup_email_claimed_at);
      if (claimedAtMs !== null) {
        existing.claimedAtMs = Math.max(existing.claimedAtMs || claimedAtMs, claimedAtMs);
      }
    }
    grouped.set(orderId, existing);
  }

  return [...grouped.values()].map((entry) => {
    const sendAfterMs = entry.latestCreatedAtMs + PREORDER_CONSOLIDATION_MS;
    const claimIsStale =
      entry.hasClaim &&
      (entry.claimedAtMs === null || entry.claimedAtMs <= nowMs - EMAIL_SEND_LEASE_MS);
    const isConsolidating = !entry.hasClaim && sendAfterMs > nowMs;

    let status = "Pending";
    let pendingFor =
      "The 5-minute consolidation window is complete; waiting for the automatic worker.";
    if (claimIsStale) {
      status = "Recovery pending";
      pendingFor = "The previous send was interrupted; waiting for automatic recovery.";
    } else if (entry.hasClaim) {
      status = "Sending now";
      pendingFor = "The automatic sender is delivering it now.";
    } else if (isConsolidating) {
      status = "Consolidating";
      pendingFor = "Waiting for the 5-minute consolidation window to combine newly ready items.";
    }

    const fulfillmentLabel = entry.fulfillment === "ship"
      ? "Pre-order ready-to-ship update"
      : "Pre-order ready-for-pickup update";

    return {
      id: `preorder:${entry.orderId}:${entry.firstEventId || "release"}`,
      queued_at: new Date(entry.firstCreatedAtMs).toISOString(),
      recipient: entry.recipient,
      email_for: `${fulfillmentLabel}${entry.isTestOrder ? " (test order)" : ""}`,
      status,
      pending_for: pendingFor,
      order_id: entry.orderId
    };
  });
};

export const buildPendingEmailQueueRows = ({
  confirmationJobs = [],
  preorderReleaseEvents = [],
  now = new Date()
} = {}) => {
  const nowMs = new Date(now).getTime();
  const safeNowMs = Number.isFinite(nowMs) ? nowMs : Date.now();
  const confirmationRows = (Array.isArray(confirmationJobs) ? confirmationJobs : [])
    .map((job) => buildConfirmationQueueRow(job, safeNowMs))
    .filter(Boolean);
  const preorderRows = buildPreorderQueueRows(preorderReleaseEvents, safeNowMs);

  return [...confirmationRows, ...preorderRows].sort((left, right) => {
    const leftTime = toTimestamp(left.queued_at) || 0;
    const rightTime = toTimestamp(right.queued_at) || 0;
    return leftTime - rightTime || left.recipient.localeCompare(right.recipient);
  });
};
