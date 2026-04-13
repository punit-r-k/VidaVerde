import { sendOrderConfirmationEmail } from "@/lib/orderConfirmationEmail";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
}) {
  const claim = await claimCustomerConfirmationEmail(orderId);
  if (claim.error) {
    console.error(
      "customer confirmation email claim error:",
      claim.error
    );
    return {
      ok: false,
      error: "Unable to reserve order confirmation email delivery.",
      status: 500
    };
  }

  if (!claim.claimed) {
    return { ok: true };
  }

  const emailResult = await sendOrderConfirmationEmail({
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
  });

  if (emailResult.skipped) {
    const releaseError = await releaseCustomerConfirmationEmailClaim(orderId);
    if (releaseError) {
      console.error(
        "customer confirmation email claim release error after skip:",
        releaseError
      );
    }
    return { ok: true };
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

  return { ok: true };
}
