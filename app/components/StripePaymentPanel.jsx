"use client";

import { useMemo, useState } from "react";
import {
  CardElement,
  Elements,
  ExpressCheckoutElement,
  useElements,
  useStripe
} from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { trackAnalyticsEvent } from "@/lib/analytics";

const stripePublishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = stripePublishableKey ? loadStripe(stripePublishableKey) : null;
const ORDER_FINALIZE_MESSAGE = "Payment received. Finalizing your order...";
const PAYMENT_FALLBACK_ERROR_MESSAGE =
  "Payment didn't go through. Please check your card and try again.";
const PAYMENT_SETUP_ERROR_MESSAGE =
  "The secure payment form had trouble connecting. Please refresh the page and try again.";
const PAYMENT_NETWORK_ERROR_MESSAGE =
  "We couldn't reach the payment service. Please check your connection and try again.";

const formatCurrency = (amountInCents) => {
  const n = Number(amountInCents);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${(n / 100).toFixed(2)}`;
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
    return {
      clientSecret: result,
      paymentIntentId: "",
      returnUrl: ""
    };
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
    /returnUrl|return_url|confirm\(\)|Checkout Session|client_secret|client secret|integrationerror|integration error|invalid_request_error/i.test(message)
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
  const [applePayAvailability, setApplePayAvailability] = useState("checking");
  const grossTotal = Number(grossTotalCents);
  const safeGrossTotalCents =
    Number.isFinite(grossTotal) && grossTotal > 0 ? Math.round(grossTotal) : 0;
  const hasApplePay = applePayAvailability === "available";
  const payNowLabel =
    safeGrossTotalCents > 0
      ? `Pay Now | ${formatCurrency(safeGrossTotalCents)}`
      : "Pay Now";
  const expressCheckoutOptions = useMemo(
    () => ({
      buttonHeight: 46,
      buttonTheme: {
        applePay: "black"
      },
      buttonType: {
        applePay: "check-out"
      },
      layout: {
        maxColumns: 1,
        maxRows: 1,
        overflow: "never"
      },
      paymentMethods: {
        applePay: "auto",
        googlePay: "never",
        link: "never",
        paypal: "never",
        amazonPay: "never",
        klarna: "never"
      }
    }),
    []
  );

  const handleExpressCheckoutReady = (event) => {
    setApplePayAvailability(
      event?.availablePaymentMethods?.applePay ? "available" : "unavailable"
    );
  };

  const handleExpressCheckoutClick = (event) => {
    if (isSubmitting || isLocked || safeGrossTotalCents <= 0 || !stripe || !elements) {
      event.reject();
      return;
    }

    event.resolve({
      lineItems: [
        {
          name: "Vida Verde order",
          amount: safeGrossTotalCents
        }
      ]
    });
  };

  const handleExpressCheckoutConfirm = async (event) => {
    trackAnalyticsEvent({
      name: "payment_submit",
      sectionId: "shop",
      elementId: "payment_apple_pay",
      checkoutStep: "payment",
      metadata: {
        subtotalCents: safeGrossTotalCents,
        source: event?.expressPaymentType || "apple_pay"
      }
    });

    if (!stripe || !elements) {
      const message = "Payment form is still loading. Please try again.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      event.paymentFailed({ reason: "fail", message });
      return;
    }

    setIsSubmitting(true);
    setPaymentError("");
    onPaymentState({
      status: "processing",
      message: "Processing Apple Pay securely..."
    });

    const { error: submitError } = await elements.submit();
    if (submitError) {
      const message = getReadablePaymentErrorMessage(submitError);
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      event.paymentFailed({ reason: "invalid_payment_data", message });
      setIsSubmitting(false);
      return;
    }

    let paymentIntentDetails;
    try {
      paymentIntentDetails = normalizePaymentIntentResult(await createPaymentIntent());
    } catch (error) {
      const message = getReadablePaymentErrorMessage(
        error,
        "We couldn't start payment. Please try again."
      );
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      event.paymentFailed({ reason: "fail", message });
      setIsSubmitting(false);
      return;
    }

    if (!paymentIntentDetails.clientSecret) {
      const message = "We couldn't start payment. Please try again.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      event.paymentFailed({ reason: "fail", message });
      setIsSubmitting(false);
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
      const message = getReadablePaymentErrorMessage(error);
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      event.paymentFailed({ reason: "fail", message });
      setIsSubmitting(false);
      return;
    }

    const intentStatus = paymentIntent?.status;
    const paymentIntentId = paymentIntent?.id || paymentIntentDetails.paymentIntentId;
    if (intentStatus === "succeeded" && paymentIntentId) {
      onPaymentState({
        status: "finalizing",
        paymentIntentId,
        message: ORDER_FINALIZE_MESSAGE
      });
      setIsSubmitting(false);
      return;
    }

    if (
      (intentStatus === "processing" || intentStatus === "requires_capture") &&
      paymentIntentId
    ) {
      onPaymentState({
        status: "finalizing",
        paymentIntentId,
        message:
          "Payment is processing. We are finalizing your order as soon as Stripe confirms it. Do not submit again."
      });
      setIsSubmitting(false);
      return;
    }

    if (!paymentIntent && !error) {
      onPaymentState({
        status: "redirecting",
        message: "Finishing secure payment..."
      });
      setIsSubmitting(false);
      return;
    }

    const message = "Payment was not completed. Please try again.";
    setPaymentError(message);
    onPaymentState({ status: "error", message });
    event.paymentFailed({ reason: "fail", message });
    setIsSubmitting(false);
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
      billing_details: buildBillingDetails(billingDetails)
    });

    if (paymentMethodError || !paymentMethod?.id) {
      const message = getReadablePaymentErrorMessage(
        paymentMethodError,
        "Enter valid card details to continue."
      );
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      setIsSubmitting(false);
      return;
    }

    let clientSecret;
    try {
      const paymentIntentDetails = normalizePaymentIntentResult(await createPaymentIntent());
      clientSecret = paymentIntentDetails.clientSecret;
    } catch (error) {
      const message = getReadablePaymentErrorMessage(
        error,
        "We couldn't start payment. Please try again."
      );
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      setIsSubmitting(false);
      return;
    }

    if (!clientSecret) {
      const message = "We couldn't start payment. Please try again.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      setIsSubmitting(false);
      return;
    }

    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: paymentMethod.id
    });

    if (error) {
      const message = getReadablePaymentErrorMessage(error);
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
      <div
        className={`wallet-checkout${
          applePayAvailability === "unavailable" ? " wallet-checkout--hidden" : ""
        }${isSubmitting || isLocked ? " wallet-checkout--disabled" : ""}`}
      >
        <ExpressCheckoutElement
          options={expressCheckoutOptions}
          onReady={handleExpressCheckoutReady}
          onClick={handleExpressCheckoutClick}
          onConfirm={handleExpressCheckoutConfirm}
        />
      </div>
      {hasApplePay ? (
        <div className="payment-divider" aria-hidden="true">
          <span>or pay by card</span>
        </div>
      ) : null}
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
