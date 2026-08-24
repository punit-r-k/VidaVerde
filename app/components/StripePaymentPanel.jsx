"use client";

import { useMemo, useState } from "react";
import {
  Elements,
  PaymentElement,
  useElements,
  useStripe
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { trackAnalyticsEvent } from "@/lib/analytics";

const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;
const ORDER_FINALIZE_MESSAGE = "Payment received. Finalizing your order...";
const PAYMENT_FALLBACK_ERROR_MESSAGE =
  "Payment didn't go through. Please check your payment details and try again.";
const PAYMENT_SETUP_ERROR_MESSAGE =
  "The secure payment form had trouble connecting. Please refresh the page and try again.";
const PAYMENT_NETWORK_ERROR_MESSAGE =
  "We couldn't reach the payment service. Please check your connection and try again.";

function AcceptedPaymentMethods() {
  return (
    <div className="accepted-payments" aria-label="Accepted payment methods">
      <span className="accepted-payments__label">Accepted payment methods</span>
      <ul className="accepted-payments__list">
        <li className="payment-method-badge payment-method-badge--amex" aria-label="American Express">
          <span aria-hidden="true">AM<br />EX</span>
        </li>
        <li className="payment-method-badge payment-method-badge--apple-pay" aria-label="Apple Pay">
          <span className="payment-method-badge__apple" aria-hidden="true" />
          <span aria-hidden="true">Pay</span>
        </li>
        <li className="payment-method-badge payment-method-badge--discover" aria-label="Discover">
          <span aria-hidden="true">DISC<span>O</span>VER</span>
        </li>
        <li className="payment-method-badge payment-method-badge--google-pay" aria-label="Google Pay">
          <span className="payment-method-badge__google" aria-hidden="true">G</span>
          <span aria-hidden="true">Pay</span>
        </li>
        <li className="payment-method-badge payment-method-badge--mastercard" aria-label="Mastercard">
          <span className="payment-method-badge__mastercard" aria-hidden="true">
            <i />
            <i />
          </span>
        </li>
        <li className="payment-method-badge payment-method-badge--visa" aria-label="Visa">
          <span aria-hidden="true">VISA</span>
        </li>
      </ul>
      <span className="accepted-payments__note">Wallet options appear on supported devices.</span>
    </div>
  );
}

const formatCurrency = (amountInCents) => {
  const amount = Number(amountInCents);
  if (!Number.isFinite(amount)) return "$0.00";
  return `$${(amount / 100).toFixed(2)}`;
};

const toOptional = (value) => {
  const text = String(value || "").trim();
  return text || undefined;
};

const getReturnUrl = (returnUrl) => {
  const text = String(returnUrl || "").trim();
  if (text) return text;
  if (typeof window === "undefined") return "";
  return new URL("/?checkout=success", window.location.origin).toString();
};

const buildBillingDetails = (billingDetails) => ({
  name: toOptional(billingDetails?.name),
  email: toOptional(billingDetails?.email),
  phone: toOptional(billingDetails?.phone),
  address: {
    line1: toOptional(billingDetails?.address1),
    line2: toOptional(billingDetails?.address2),
    city: toOptional(billingDetails?.city),
    state: toOptional(billingDetails?.state),
    postal_code: toOptional(billingDetails?.postalCode),
    country: "US"
  }
});

const normalizePaymentIntentResult = (result) => {
  if (typeof result === "string") {
    return { clientSecret: result, paymentIntentId: "", returnUrl: "" };
  }

  return {
    clientSecret: String(result?.clientSecret || "").trim(),
    paymentIntentId: String(result?.paymentIntentId || "").trim(),
    returnUrl: String(result?.returnUrl || "").trim()
  };
};

const getReadablePaymentErrorMessage = (
  error,
  fallback = PAYMENT_FALLBACK_ERROR_MESSAGE
) => {
  const message = String(error?.message || error?.error?.message || error || "").trim();
  if (!message) return fallback;

  if (/network|failed to fetch|load failed|timeout/i.test(message)) {
    return PAYMENT_NETWORK_ERROR_MESSAGE;
  }

  if (
    /returnUrl|return_url|confirm\(\)|client_secret|client secret|integrationerror|integration error|invalid_request_error/i.test(
      message
    )
  ) {
    return PAYMENT_SETUP_ERROR_MESSAGE;
  }

  return message;
};

function StripePaymentForm({
  onPaymentState,
  grossTotalCents,
  billingDetails,
  createPaymentIntent,
  isLocked = false
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const grossTotal = Number(grossTotalCents);
  const safeGrossTotalCents =
    Number.isFinite(grossTotal) && grossTotal > 0 ? Math.round(grossTotal) : 0;
  const payNowLabel = safeGrossTotalCents > 0
    ? `Pay Now | ${formatCurrency(safeGrossTotalCents)}`
    : "Pay Now";

  const failPayment = (error, fallback) => {
    const message = getReadablePaymentErrorMessage(error, fallback);
    setPaymentError(message);
    onPaymentState({ status: "error", message });
    setIsSubmitting(false);
  };

  const handleStripeSubmit = async () => {
    trackAnalyticsEvent({
      name: "payment_submit",
      sectionId: "shop",
      elementId: "payment_submit",
      checkoutStep: "payment",
      metadata: { subtotalCents: safeGrossTotalCents }
    });

    if (!stripe || !elements) {
      failPayment(null, "Payment form is still loading. Please try again.");
      return;
    }

    setIsSubmitting(true);
    setPaymentError("");
    onPaymentState({ status: "processing", message: "Processing payment securely..." });

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) {
        failPayment(submitError, "Enter valid payment details to continue.");
        return;
      }

      const paymentIntentDetails = normalizePaymentIntentResult(
        await createPaymentIntent()
      );
      if (!paymentIntentDetails.clientSecret) {
        failPayment(null, "We couldn't start payment. Please try again.");
        return;
      }

      const { error, paymentIntent } = await stripe.confirmPayment({
        elements,
        clientSecret: paymentIntentDetails.clientSecret,
        confirmParams: {
          return_url: getReturnUrl(paymentIntentDetails.returnUrl),
          payment_method_data: {
            billing_details: buildBillingDetails(billingDetails)
          }
        },
        redirect: "if_required"
      });

      if (error) {
        failPayment(error);
        return;
      }

      const paymentIntentId = paymentIntent?.id || paymentIntentDetails.paymentIntentId;
      const clientSecret =
        paymentIntent?.client_secret || paymentIntentDetails.clientSecret;
      if (paymentIntent?.status === "succeeded" && paymentIntentId) {
        onPaymentState({
          status: "finalizing",
          paymentIntentId,
          clientSecret,
          message: ORDER_FINALIZE_MESSAGE
        });
        setIsSubmitting(false);
        return;
      }

      if (
        ["processing", "requires_capture"].includes(paymentIntent?.status) &&
        paymentIntentId
      ) {
        onPaymentState({
          status: "finalizing",
          paymentIntentId,
          clientSecret,
          message:
            "Payment is processing. We will confirm your order as soon as Stripe finishes. Do not submit again."
        });
        setIsSubmitting(false);
        return;
      }

      if (!paymentIntent && !error) {
        onPaymentState({ status: "redirecting", message: "Finishing secure payment..." });
        setIsSubmitting(false);
        return;
      }

      failPayment(null, "Payment was not completed. Please try again.");
    } catch (error) {
      failPayment(error, "We couldn't complete payment. Please try again.");
    }
  };

  return (
    <div className="payment-form">
      <AcceptedPaymentMethods />
      <div className="payment-element-wrap">
        <PaymentElement
          options={{
            layout: { type: "tabs", defaultCollapsed: false },
            fields: {
              billingDetails: {
                name: "never",
                email: "never",
                phone: "never",
                address: "never"
              }
            }
          }}
        />
      </div>
      {paymentError ? (
        <div className="form__status form__status--error" role="status" aria-live="polite">
          {paymentError}
        </div>
      ) : null}
      <button
        className="button button--dark payment-element-submit"
        type="button"
        onClick={handleStripeSubmit}
        disabled={isSubmitting || isLocked || !stripe || !elements}
        aria-busy={isSubmitting}
        data-analytics-id="payment_submit"
        data-analytics-hover="true"
      >
        {isSubmitting ? "Processing..." : payNowLabel}
      </button>
    </div>
  );
}

export default function StripePaymentPanel(props) {
  const grossTotal = Number(props?.grossTotalCents);
  const elementsAmount =
    Number.isFinite(grossTotal) && grossTotal > 0 ? Math.round(grossTotal) : 1;
  const elementsOptions = useMemo(
    () => ({
      mode: "payment",
      amount: elementsAmount,
      currency: "usd",
      appearance: {
        variables: {
          colorText: "#29362f",
          colorDanger: "#a9383c",
          fontFamily: "inherit",
          borderRadius: "4px"
        }
      }
    }),
    [elementsAmount]
  );

  if (!stripePromise) {
    return (
      <div className="form__status form__status--error" role="status" aria-live="polite">
        Payment is not connected right now. Please contact us to complete your order.
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise} options={elementsOptions} key={`payment-${elementsAmount}`}>
      <StripePaymentForm {...props} />
    </Elements>
  );
}
