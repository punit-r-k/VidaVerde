import {
  enqueueOrderConfirmationEmail,
  processOrderConfirmationEmailJob,
  shouldQueueOrderConfirmationEmail
} from "@/lib/emailJobQueue";

const SUPPORT_PHONE_DISPLAY = "(713) 478-1878";

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);

const getShortOrderReference = (orderId) => {
  const normalizedOrderId = toText(orderId, 64).replace(/[^a-z0-9]/gi, "");
  return normalizedOrderId ? normalizedOrderId.slice(0, 8).toUpperCase() : "";
};

const buildConfirmationEmailWarning = ({
  orderId,
  code = "confirmation_email_delayed",
  retryable = true
} = {}) => {
  const orderReference = getShortOrderReference(orderId);
  const referenceLine = orderReference ? ` and mention order ${orderReference}` : "";

  return {
    code,
    retryable,
    orderReference,
    customerMessage:
      "Payment received. Your order is confirmed, but our confirmation email is delayed. " +
      `If it does not arrive within 15 minutes, text ${SUPPORT_PHONE_DISPLAY}${referenceLine}.`,
    popupMessage:
      "Your payment was received. Your order is confirmed, but the confirmation email is delayed."
  };
};

const buildAutomationFailure = ({
  orderId,
  code,
  retryable,
  failOnAutomationError,
  error,
  status = 500
}) => {
  if (!failOnAutomationError) {
    return {
      ok: true,
      automationWarnings: [
        buildConfirmationEmailWarning({ orderId, code, retryable })
      ]
    };
  }

  return { ok: false, error, status };
};

export async function maybeSendCustomerConfirmationEmail({
  orderId,
  fulfillment,
  currency,
  subtotal,
  tax,
  shipping,
  total,
  placedAt,
  receiptNumber,
  paymentMethodLabel,
  customer,
  items
}, { failOnAutomationError = false } = {}) {
  const emailPayload = {
    orderId,
    fulfillment,
    currency,
    subtotal,
    tax,
    shipping,
    total,
    placedAt,
    receiptNumber,
    paymentMethodLabel,
    customer,
    items
  };

  const queueResult = await enqueueOrderConfirmationEmail(emailPayload);
  if (!queueResult.ok) {
    console.error("order confirmation email queue error:", queueResult.error);
    return buildAutomationFailure({
      orderId,
      code: "confirmation_email_retry_pending",
      retryable: true,
      failOnAutomationError,
      error: "Unable to queue order confirmation email."
    });
  }

  if (!queueResult.jobId || shouldQueueOrderConfirmationEmail()) {
    return { ok: true, automationWarnings: [] };
  }

  const deliveryResult = await processOrderConfirmationEmailJob(queueResult.jobId);
  if (deliveryResult.ok && ["sent", "skipped"].includes(deliveryResult.outcome)) {
    return { ok: true, automationWarnings: [] };
  }

  const trackingPending = deliveryResult.code === "tracking_pending";
  const retryable = deliveryResult.outcome !== "failed" || trackingPending;
  const code = trackingPending
    ? "confirmation_email_tracking_pending"
    : retryable
      ? "confirmation_email_delayed"
      : "confirmation_email_automation_unavailable";

  if (deliveryResult.error) {
    console.error("order confirmation email delivery error:", deliveryResult.error);
  }

  return buildAutomationFailure({
    orderId,
    code,
    retryable,
    failOnAutomationError,
    error: trackingPending
      ? "Shipment tracking is not ready for the confirmation email."
      : "Unable to send order confirmation email."
  });
}
