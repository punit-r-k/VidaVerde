"use client";

import { useState } from "react";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { trackAnalyticsEvent } from "@/lib/analytics";

const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

const ORDER_FINALIZE_MESSAGE = "Payment received. Finalizing your order...";

const formatCurrency = (amountInCents) => {
  const n = Number(amountInCents);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${(n / 100).toFixed(2)}`;
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
  const payNowLabel = Number.isFinite(Number(grossTotalCents)) && Number(grossTotalCents) > 0
    ? `Pay Now | ${formatCurrency(grossTotalCents)}`
    : "Pay Now";

  const toOptional = (value) => {
    const text = String(value || "").trim();
    return text || undefined;
  };

  const handleStripeSubmit = async () => {
    trackAnalyticsEvent({
      name: "payment_submit",
      sectionId: "shop",
      elementId: "payment_submit",
      checkoutStep: "payment",
      metadata: {
        subtotalCents: Number(grossTotalCents || 0)
      }
    });

    if (!stripe || !elements) {
      const message = "Payment form is still loading. Please try again.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      return;
    }

    const cardElement = elements.getElement(CardElement);
    if (!cardElement) {
      const message = "Card input is not ready yet. Please try again.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      return;
    }

    setIsSubmitting(true);
    setPaymentError("");
    onPaymentState({
      status: "processing",
      message: "Processing payment securely..."
    });

    const { error: paymentMethodError, paymentMethod } = await stripe.createPaymentMethod({
      type: "card",
      card: cardElement,
      billing_details: {
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
      }
    });

    if (paymentMethodError || !paymentMethod?.id) {
      const message = paymentMethodError?.message || "Enter valid card details to continue.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      setIsSubmitting(false);
      return;
    }

    let clientSecret;
    try {
      clientSecret = await createPaymentIntent();
    } catch (error) {
      const message = error?.message || "We couldn't start payment. Please try again.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      setIsSubmitting(false);
      return;
    }

    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: paymentMethod.id
    });

    if (error) {
      const message = error.message || "Payment didn't go through. Please check your card and try again.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      setIsSubmitting(false);
      return;
    }

    const intentStatus = paymentIntent?.status;
    if (intentStatus === "succeeded" && paymentIntent?.id) {
      onPaymentState({
        status: "finalizing",
        paymentIntentId: paymentIntent.id,
        message: ORDER_FINALIZE_MESSAGE
      });
      setIsSubmitting(false);
      return;
    }

    if (
      (intentStatus === "processing" || intentStatus === "requires_capture") &&
      paymentIntent?.id
    ) {
      onPaymentState({
        status: "finalizing",
        paymentIntentId: paymentIntent.id,
        message:
          "Payment is processing. We are finalizing your order as soon as Stripe confirms it. Do not submit again."
      });
      setIsSubmitting(false);
      return;
    }

    const message = "Payment was not completed. Please try again.";
    setPaymentError(message);
    onPaymentState({ status: "error", message });
    setIsSubmitting(false);
  };

  return (
    <div className="payment-form">
      <div className="card-element-wrap">
        <CardElement
          options={{
            hidePostalCode: true,
            style: {
              base: {
                fontSize: "16px",
                color: "#29362f",
                "::placeholder": {
                  color: "rgba(41, 54, 47, 0.54)"
                }
              },
              invalid: {
                color: "#a9383c"
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
        className="button button--dark"
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
  if (!stripePromise) {
    return (
      <div className="form__status form__status--error" role="status" aria-live="polite">
        Stripe publishable key is missing. Set NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
      </div>
    );
  }

  return (
    <Elements stripe={stripePromise}>
      <StripePaymentForm {...props} />
    </Elements>
  );
}
