import {
  enqueueOrderConfirmationEmail,
  shouldQueueOrderConfirmationEmail
} from "@/lib/emailJobQueue";
import { sendOrderConfirmationEmail } from "@/lib/orderConfirmationEmail";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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

const claimCustomerConfirmationEmail = async (orderId) => {
  if (!orderId) {
    return { claimed: false, error: null };
  }

  const { data, error } = await supabaseAdmin
    .from("orders")
    .update({
      customer_confirmation_email_claimed_at: new Date().toISOString()
    })
    .eq("id", orderId)
    .is("customer_confirmation_email_sent_at", null)
    .is("customer_confirmation_email_claimed_at", null)
    .select("id")
    .maybeSingle();

  return {
    claimed: Boolean(data?.id),
    error
  };
};

const releaseCustomerConfirmationEmailClaim = async (orderId) => {
  if (!orderId) return null;

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      customer_confirmation_email_claimed_at: null
    })
    .eq("id", orderId)
    .is("customer_confirmation_email_sent_at", null);

  return error;
};

const markCustomerConfirmationEmailSent = async (orderId) => {
  if (!orderId) return null;

  const { error } = await supabaseAdmin
    .from("orders")
    .update({
      customer_confirmation_email_sent_at: new Date().toISOString(),
      customer_confirmation_email_claimed_at: null
    })
    .eq("id", orderId)
    .is("customer_confirmation_email_sent_at", null);

  return error;
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
  const claim = await claimCustomerConfirmationEmail(orderId);
  if (claim.error) {
    console.error(
      "customer confirmation email claim error:",
      claim.error
    );
    if (!failOnAutomationError) {
      return {
        ok: true,
        automationWarnings: [
          buildConfirmationEmailWarning({
            orderId,
            code: "confirmation_email_retry_pending",
            retryable: true
          })
        ]
      };
    }
    return {
      ok: false,
      error: "Unable to reserve order confirmation email delivery.",
      status: 500
    };
  }

  if (!claim.claimed) {
    return { ok: true, automationWarnings: [] };
  }

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

  if (shouldQueueOrderConfirmationEmail()) {
    const queueResult = await enqueueOrderConfirmationEmail(emailPayload);

    if (queueResult.ok) {
      return { ok: true, automationWarnings: [] };
    }

    const releaseError = await releaseCustomerConfirmationEmailClaim(orderId);
    if (releaseError) {
      console.error(
        "customer confirmation email claim release error after queue failure:",
        releaseError
      );
    }
    console.error("order confirmation email queue error:", queueResult.error);

    if (!failOnAutomationError) {
      return {
        ok: true,
        automationWarnings: [
          buildConfirmationEmailWarning({
            orderId,
            code: "confirmation_email_delayed",
            retryable: true
          })
        ]
      };
    }

    return {
      ok: false,
      error: "Unable to queue order confirmation email.",
      status: 500
    };
  }

  const emailResult = await sendOrderConfirmationEmail(emailPayload);

  if (emailResult.skipped) {
    const releaseError = await releaseCustomerConfirmationEmailClaim(orderId);
    if (releaseError) {
      console.error(
        "customer confirmation email claim release error after skip:",
        releaseError
      );
    }
    return {
      ok: true,
      automationWarnings: [
        buildConfirmationEmailWarning({
          orderId,
          code: "confirmation_email_automation_unavailable",
          retryable: false
        })
      ]
    };
  }

  if (!emailResult.ok) {
    const releaseError = await releaseCustomerConfirmationEmailClaim(orderId);
    if (releaseError) {
      console.error(
        "customer confirmation email claim release error after send failure:",
        releaseError
      );
    }
    console.error("order confirmation email error:", emailResult.error);
    if (!failOnAutomationError) {
      return {
        ok: true,
        automationWarnings: [
          buildConfirmationEmailWarning({
            orderId,
            code: "confirmation_email_delayed",
            retryable: true
          })
        ]
      };
    }
    return {
      ok: false,
      error: "Unable to send order confirmation email.",
      status: 500
    };
  }

  const markError = await markCustomerConfirmationEmailSent(orderId);
  if (markError) {
    console.error(
      "customer confirmation email sent marker error:",
      markError
    );
  }

  return { ok: true, automationWarnings: [] };
}
