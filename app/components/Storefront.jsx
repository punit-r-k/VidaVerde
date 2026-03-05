"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import {
  FORM_FIELD_ORDER,
  INITIAL_FORM_VALUES,
  SHIPPING_FIELDS,
  US_CITY_OPTIONS,
  US_STATE_OPTIONS,
  formatCheckoutInputValue,
  getCheckoutFieldErrors,
  normalizeFulfillment
} from "@/lib/checkoutSchema";

const formatCurrency = (amountInCents) => {
  const n = Number(amountInCents);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${(n / 100).toFixed(2)}`;
};

const INVENTORY_POLL_MS = 30000;
const HEALTH_BENEFIT_PATTERN =
  /(live[-\s]?cultures?|active[-\s]?cultures?|fiber(?:-rich)?|digestion|digestive|gut|probiotic|vitamin|antioxidant|health|wellness|immune|nutrient|plant variety)/i;
const SPICE_PROFILE_PATTERN =
  /(spice|hot|heat|mild|turmeric|cumin|pepper|jalapeno|habanero)/i;
const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;

const getSpiceProfile = (profile) => {
  const text = typeof profile === "string" ? profile.trim() : "";
  if (!text) return "";
  return SPICE_PROFILE_PATTERN.test(text) ? text : "";
};

const splitDescription = (description) => {
  if (typeof description !== "string") {
    return { lead: "", benefit: "", details: [] };
  }

  const trimmed = description.trim();
  if (!trimmed) {
    return { lead: "", benefit: "", details: [] };
  }

  const sentences = trimmed.match(/[^.!?]+[.!?]/g) || [trimmed];
  const normalized = sentences.map((sentence) => sentence.trim()).filter(Boolean);
  const details = normalized.slice(1);
  const benefitSentences = details.filter((sentence) =>
    HEALTH_BENEFIT_PATTERN.test(sentence)
  );
  const benefit = benefitSentences.join(" ");
  const nextDetails = details.filter((sentence) => !HEALTH_BENEFIT_PATTERN.test(sentence));

  return {
    lead: normalized[0] || "",
    benefit,
    details: nextDetails
  };
};

function StripePaymentForm({ onPaymentState, grossTotalCents }) {
  const stripe = useStripe();
  const elements = useElements();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const payNowLabel = Number.isFinite(Number(grossTotalCents)) && Number(grossTotalCents) > 0
    ? `Pay Now | ${formatCurrency(grossTotalCents)}`
    : "Pay Now";

  const handleStripeSubmit = async () => {
    if (!stripe || !elements) {
      const message = "Payment form is still loading. Please try again.";
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

    const returnUrl =
      typeof window !== "undefined"
        ? `${window.location.origin}/?checkout=success`
        : undefined;

    const { error, paymentIntent } = await stripe.confirmPayment({
      elements,
      confirmParams: returnUrl ? { return_url: returnUrl } : {},
      redirect: "if_required"
    });

    if (error) {
      const message = error.message || "Payment could not be completed.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      setIsSubmitting(false);
      return;
    }

    const intentStatus = paymentIntent?.status;
    if (intentStatus === "succeeded") {
      onPaymentState({
        status: "success",
        message: "Payment received. We will email fulfillment details shortly."
      });
      setIsSubmitting(false);
      return;
    }

    if (intentStatus === "processing" || intentStatus === "requires_capture") {
      onPaymentState({
        status: "success",
        message: "Payment is processing. We will email fulfillment details shortly."
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
      <PaymentElement options={{ layout: "tabs" }} />
      {paymentError ? (
        <div className="form__status form__status--error" role="status" aria-live="polite">
          {paymentError}
        </div>
      ) : null}
      <button
        className="button button--dark"
        type="button"
        onClick={handleStripeSubmit}
        disabled={isSubmitting || !stripe || !elements}
        aria-busy={isSubmitting}
      >
        {isSubmitting ? "Processing..." : payNowLabel}
      </button>
    </div>
  );
}

export default function Storefront({ products, inventory = {} }) {
  const searchParams = useSearchParams();
  const [cart, setCart] = useState({});
  const [status, setStatus] = useState("idle");
  const [notice, setNotice] = useState("");
  const [paymentClientSecret, setPaymentClientSecret] = useState("");
  const [checkoutStep, setCheckoutStep] = useState("details");
  const [fulfillment, setFulfillment] = useState("ship");
  const [liveInventory, setLiveInventory] = useState(inventory);
  const [formValues, setFormValues] = useState(INITIAL_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touchedFields, setTouchedFields] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [addPulse, setAddPulse] = useState({});
  const [showOrderSuccessPopup, setShowOrderSuccessPopup] = useState(false);
  const [orderSuccessPopupKey, setOrderSuccessPopupKey] = useState(0);
  const fieldRefs = useRef({});
  const paymentRefreshRequestRef = useRef(0);
  const paymentCartSignatureRef = useRef("");
  const addPulseTimeoutsRef = useRef({});
  const orderSuccessPopupTimeoutRef = useRef(null);
  const isPaymentStep = checkoutStep === "payment";

  const resetPaymentState = useCallback((options = {}) => {
    const keepPaymentStep = options.keepPaymentStep === true;
    paymentRefreshRequestRef.current += 1;
    setPaymentClientSecret("");
    if (!keepPaymentStep) {
      paymentCartSignatureRef.current = "";
      setCheckoutStep("details");
    }
  }, []);

  const resetCheckoutAfterSuccess = useCallback(() => {
    setCart({});
    setFulfillment("ship");
    setFormValues(INITIAL_FORM_VALUES);
    setFieldErrors({});
    setTouchedFields({});
    setSubmitAttempted(false);
    paymentRefreshRequestRef.current += 1;
    paymentCartSignatureRef.current = "";
    setPaymentClientSecret("");
    setCheckoutStep("details");
  }, []);

  const triggerOrderSuccessPopup = useCallback(() => {
    setOrderSuccessPopupKey((prev) => prev + 1);
    setShowOrderSuccessPopup(true);

    if (orderSuccessPopupTimeoutRef.current) {
      clearTimeout(orderSuccessPopupTimeoutRef.current);
    }

    orderSuccessPopupTimeoutRef.current = setTimeout(() => {
      setShowOrderSuccessPopup(false);
      orderSuccessPopupTimeoutRef.current = null;
    }, 3800);
  }, []);

  const setFieldRef = useCallback((name) => {
    return (node) => {
      if (node) {
        fieldRefs.current[name] = node;
      } else {
        delete fieldRefs.current[name];
      }
    };
  }, []);

  const validateCheckoutForm = useCallback((values, nextFulfillment) => {
    return getCheckoutFieldErrors(values, nextFulfillment);
  }, []);

  const focusFirstInvalidField = useCallback((errors, nextFulfillment) => {
    const fields = nextFulfillment === "ship"
      ? FORM_FIELD_ORDER
      : FORM_FIELD_ORDER.filter((name) => !SHIPPING_FIELDS.includes(name));

    const firstInvalid = fields.find((name) => errors[name]);
    if (!firstInvalid) return;

    const node = fieldRefs.current[firstInvalid];
    if (!node) return;

    node.focus();
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const getFieldError = useCallback((name) => {
    const hasError = Boolean(fieldErrors[name]);
    const shouldShow = submitAttempted || touchedFields[name];
    return hasError && shouldShow ? fieldErrors[name] : "";
  }, [fieldErrors, submitAttempted, touchedFields]);

  const hasFieldError = useCallback((name) => Boolean(getFieldError(name)), [getFieldError]);

  const applyInventory = (nextInventory) => {
    if (nextInventory && typeof nextInventory === "object") {
      setLiveInventory(nextInventory);
    }
  };

  // Poll inventory after mount. Keep first render stable using `inventory` prop.
  useEffect(() => {
    let active = true;

    const fetchInventory = async () => {
      try {
        const response = await fetch(`/api/inventory?ts=${Date.now()}`, {
          cache: "no-store"
        });
        if (!response.ok) return;

        const data = await response.json();
        if (!active || !data) return;

        applyInventory(data);
      } catch {
        // Ignore refresh failures; keep last known snapshot.
      }
    };

    fetchInventory();
    const intervalId = setInterval(fetchInventory, INVENTORY_POLL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchInventory();
    };

    window.addEventListener("focus", fetchInventory);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      clearInterval(intervalId);
      window.removeEventListener("focus", fetchInventory);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    applyInventory(inventory);
  }, [inventory]);

  useEffect(() => {
    return () => {
      Object.values(addPulseTimeoutsRef.current).forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      addPulseTimeoutsRef.current = {};

      if (orderSuccessPopupTimeoutRef.current) {
        clearTimeout(orderSuccessPopupTimeoutRef.current);
        orderSuccessPopupTimeoutRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const checkoutStatus = searchParams?.get("checkout");

    if (!checkoutStatus) return;

    if (checkoutStatus === "success") {
      setStatus("success");
      setNotice("Payment received. We will email fulfillment details shortly.");
      triggerOrderSuccessPopup();
      resetCheckoutAfterSuccess();
    } else if (checkoutStatus === "cancel") {
      setStatus("error");
      setNotice("Payment canceled. Your cart is still saved below.");
      resetPaymentState();
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      url.searchParams.delete("payment_intent");
      url.searchParams.delete("payment_intent_client_secret");
      url.searchParams.delete("redirect_status");
      window.history.replaceState({}, "", url.toString());
    }
  }, [
    resetCheckoutAfterSuccess,
    resetPaymentState,
    searchParams,
    triggerOrderSuccessPopup
  ]);

  const shouldDisplayStock = useMemo(() => {
    const records = Object.values(liveInventory || {});
    if (records.length === 0) return false;
    return records.some((record) => record?.show_stock !== false);
  }, [liveInventory]);

  const cartItems = useMemo(() => {
    return products
      .filter((product) => cart[product.sku])
      .map((product) => {
        const quantity = cart[product.sku];
        const record = liveInventory[product.sku] || {
          on_hand: 0,
          preorders_remaining: 0,
          units_sold: 0,
          show_stock: true
        };

        const available = Math.max(0, Number(record.on_hand || 0));
        const inStockUnits = Math.min(quantity, available);
        const preorderUnits = Math.max(0, quantity - available);

        return {
          ...product,
          quantity,
          available,
          inStockUnits,
          preorderUnits,
          preordersCount: Math.max(0, Number(record.preorders_remaining || 0)),
          salesCount: Math.max(0, Number(record.units_sold || 0)),
          lineTotal: quantity * (product.priceCents || 0)
        };
      });
  }, [cart, products, liveInventory]);
  const cartSignature = useMemo(
    () => cartItems.map((item) => `${item.sku}:${item.quantity}`).join("|"),
    [cartItems]
  );

  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const requiresAddress = fulfillment === "ship";
  const cartCountLabel = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  const requiredFieldNames = requiresAddress
    ? ["name", "email", "address1", "city", "state", "postalCode"]
    : ["name", "email"];
  const completionErrors = useMemo(
    () => validateCheckoutForm(formValues, fulfillment),
    [formValues, fulfillment, validateCheckoutForm]
  );
  const requiredFieldRemaining = requiredFieldNames.filter((name) =>
    Boolean(completionErrors[name])
  ).length;
  const requiredFieldCompleted = requiredFieldNames.length - requiredFieldRemaining;
  const completionProgress = Math.round((requiredFieldCompleted / requiredFieldNames.length) * 100);
  const checkoutReadinessText = isPaymentStep
    ? "Review your order and complete secure payment."
    : itemCount === 0
      ? "Add at least one jar to continue."
      : requiredFieldRemaining === 0
        ? "Ready for secure checkout."
        : `${requiredFieldRemaining} required field${requiredFieldRemaining === 1 ? "" : "s"} left.`;
  const cityOptions = useMemo(() => {
    const selectedCity = String(formValues.city || "").trim();
    if (!selectedCity) return US_CITY_OPTIONS;

    const hasMatch = US_CITY_OPTIONS.some(
      (city) => city.toLowerCase() === selectedCity.toLowerCase()
    );
    return hasMatch ? US_CITY_OPTIONS : [selectedCity, ...US_CITY_OPTIONS];
  }, [formValues.city]);

  const handleMobileCheckoutJump = useCallback(() => {
    const cartSummary = document.getElementById("cart-summary");
    if (!cartSummary) return;
    cartSummary.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  const buildOrderPayload = useCallback(() => {
    return {
      fulfillment: normalizeFulfillment(fulfillment),
      customer: {
        name: String(formValues.name || "").trim(),
        email: String(formValues.email || "").trim(),
        phone: String(formValues.phone || "").trim(),
        address1: String(formValues.address1 || "").trim(),
        address2: String(formValues.address2 || "").trim(),
        city: String(formValues.city || "").trim(),
        state: String(formValues.state || "").trim(),
        postalCode: String(formValues.postalCode || "").trim(),
        note: String(formValues.note || "").trim()
      },
      // Only send sku + quantity. Server decides sold vs preorder.
      items: cartItems.map((item) => ({
        sku: item.sku,
        quantity: item.quantity
      }))
    };
  }, [cartItems, formValues, fulfillment]);

  const requestPaymentClientSecret = useCallback(
    async ({
      loadingMessage = "Looks good. Preparing secure payment...",
      includeFieldErrors = false
    } = {}) => {
      const requestId = paymentRefreshRequestRef.current + 1;
      paymentRefreshRequestRef.current = requestId;

      setStatus("submitting");
      setNotice(loadingMessage);

      try {
        const response = await fetch("/api/order", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildOrderPayload())
        });

        const result = await response.json();

        if (paymentRefreshRequestRef.current !== requestId) {
          return { ok: false, stale: true };
        }

        if (!response.ok) {
          if (
            includeFieldErrors &&
            result?.fieldErrors &&
            typeof result.fieldErrors === "object"
          ) {
            setFieldErrors((prev) => ({ ...prev, ...result.fieldErrors }));
            focusFirstInvalidField(result.fieldErrors, fulfillment);
          }
          throw new Error(result.error || "Unable to start payment.");
        }

        if (!result?.clientSecret) {
          throw new Error("Payment session did not return a client secret.");
        }

        paymentCartSignatureRef.current = cartSignature;
        setPaymentClientSecret(result.clientSecret);
        setStatus("idle");
        setNotice("");
        return { ok: true };
      } catch (error) {
        if (paymentRefreshRequestRef.current !== requestId) {
          return { ok: false, stale: true };
        }

        setPaymentClientSecret("");
        setStatus("error");
        setNotice(error?.message || "Something went wrong.");
        return { ok: false, error };
      }
    },
    [buildOrderPayload, cartSignature, focusFirstInvalidField, fulfillment]
  );

  const handleAdd = (product) => {
    const existingTimeoutId = addPulseTimeoutsRef.current[product.sku];
    if (existingTimeoutId) {
      clearTimeout(existingTimeoutId);
    }

    setAddPulse((prev) => ({
      ...prev,
      [product.sku]: true
    }));
    addPulseTimeoutsRef.current[product.sku] = setTimeout(() => {
      setAddPulse((prev) => {
        if (!prev[product.sku]) return prev;
        const { [product.sku]: _, ...rest } = prev;
        return rest;
      });
      delete addPulseTimeoutsRef.current[product.sku];
    }, 520);

    if (isPaymentStep) {
      resetPaymentState({ keepPaymentStep: true });
      setStatus("submitting");
      setNotice("Item added. Updating payment total...");
    } else {
      resetPaymentState();
    }
    setCart((prev) => {
      const currentQty = prev[product.sku] || 0;
      return {
        ...prev,
        [product.sku]: currentQty + 1
      };
    });
  };

  const handleClearCart = () => {
    resetPaymentState();
    setCart({});

    if (status !== "idle") {
      setStatus("idle");
      setNotice("");
    }
  };

  const handleQuantityChange = (sku, nextQty) => {
    resetPaymentState({ keepPaymentStep: isPaymentStep });
    setCart((prev) => {
      if (nextQty <= 0) {
        const { [sku]: _, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [sku]: nextQty
      };
    });
  };

  useEffect(() => {
    if (!isPaymentStep) return;
    if (itemCount <= 0) {
      resetPaymentState();
      setStatus("error");
      setNotice("Your cart is empty. Add jars to continue.");
      return;
    }
    if (cartSignature === paymentCartSignatureRef.current) return;

    requestPaymentClientSecret({
      loadingMessage: "Cart updated. Updating payment total..."
    });
  }, [
    cartSignature,
    isPaymentStep,
    itemCount,
    requestPaymentClientSecret,
    resetPaymentState
  ]);

  const handleFieldChange = (event) => {
    const { name, value } = event.currentTarget;
    const formatted = formatCheckoutInputValue(name, value);
    const nextValues = {
      ...formValues,
      [name]: formatted
    };

    setFormValues(nextValues);
    resetPaymentState();

    if (status !== "idle") {
      setStatus("idle");
      setNotice("");
    }

    if (submitAttempted || touchedFields[name]) {
      setFieldErrors(validateCheckoutForm(nextValues, fulfillment));
    }
  };

  const handleFieldBlur = (event) => {
    const { name, value } = event.currentTarget;
    const formatted = formatCheckoutInputValue(name, value);
    const nextValues = formatted === formValues[name]
      ? formValues
      : {
        ...formValues,
        [name]: formatted
      };

    if (formatted !== formValues[name]) {
      setFormValues(nextValues);
    }

    setTouchedFields((prev) => ({
      ...prev,
      [name]: true
    }));
    setFieldErrors(validateCheckoutForm(nextValues, fulfillment));
  };

  const handleFulfillmentChange = (event) => {
    const nextFulfillment = normalizeFulfillment(event.target.value);
    resetPaymentState();
    setFulfillment(nextFulfillment);

    if (status !== "idle") {
      setStatus("idle");
      setNotice("");
    }

    setFieldErrors(validateCheckoutForm(formValues, nextFulfillment));
  };

  const handleBackToEdit = useCallback(() => {
    resetPaymentState();
    setStatus("idle");
    setNotice("Review your details, then proceed to payment again.");
  }, [resetPaymentState]);

  const handlePaymentState = useCallback(
    ({ status: nextStatus, message }) => {
      if (nextStatus === "processing") {
        setStatus("submitting");
        setNotice(message || "Processing payment securely...");
        return;
      }

      if (nextStatus === "success") {
        setStatus("success");
        setNotice(message || "Payment received. We will email fulfillment details shortly.");
        triggerOrderSuccessPopup();
        resetCheckoutAfterSuccess();
        return;
      }

      setStatus("error");
      setNotice(message || "Payment could not be completed.");
    },
    [resetCheckoutAfterSuccess, triggerOrderSuccessPopup]
  );

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (status === "submitting") return;

    if (cartItems.length === 0) {
      setStatus("error");
      setNotice("Add jars to your cart before checking out.");
      return;
    }

    setSubmitAttempted(true);
    const nextErrors = validateCheckoutForm(formValues, fulfillment);
    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      setStatus("error");
      setNotice("Please fix the highlighted fields before checkout.");
      focusFirstInvalidField(nextErrors, fulfillment);
      return;
    }

    if (paymentClientSecret) {
      setCheckoutStep("payment");
      setStatus("idle");
      setNotice("");
      return;
    }

    const result = await requestPaymentClientSecret({
      loadingMessage: "Looks good. Preparing secure payment...",
      includeFieldErrors: true
    });
    if (result?.ok) {
      setCheckoutStep("payment");
    }
  };

  const renderCartDetails = (keyPrefix, { allowQuantityEdit = true } = {}) => (
    <>
      {cartItems.length === 0 ? (
        <p className="cart__empty">Select any item to begin your order.</p>
      ) : (
        <div className="cart__list">
          {cartItems.map((item) => {
            const spiceProfile = getSpiceProfile(item.profile);

            return (
              <div className="cart__item" key={`${keyPrefix}-${item.sku}`}>
                <div>
                  <strong>{item.name}</strong>
                  <span>
                    Qty: {item.quantity}
                    {spiceProfile ? ` | ${spiceProfile}` : ""}
                  </span>
                  {shouldDisplayStock ? (
                    <span className="cart__split">
                      {item.inStockUnits} in stock | {item.preorderUnits} preorder
                    </span>
                  ) : null}
                  <small className="cart__line-total">{formatCurrency(item.lineTotal)}</small>
                </div>

                {allowQuantityEdit ? (
                  <div className="cart__controls">
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(item.sku, item.quantity - 1)}
                      aria-label={`Decrease ${item.name} quantity`}
                    >
                      -
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() => handleQuantityChange(item.sku, item.quantity + 1)}
                      aria-label={`Increase ${item.name} quantity`}
                    >
                      +
                    </button>
                  </div>
                ) : (
                  <span className="cart__qty-chip">x{item.quantity}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="cart__summary">
        <div>
          <span>Subtotal</span>
          <strong>{formatCurrency(subtotal)}</strong>
        </div>
        <div>
          <span>Tax</span>
          <strong>Calculated at checkout</strong>
        </div>
        <div>
          <span>Shipping</span>
          <strong>Calculated at checkout</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>Calculated at checkout</strong>
        </div>
      </div>
    </>
  );

  const summarizeValue = (value, fallback = "Not provided") => {
    const text = String(value || "").trim();
    return text || fallback;
  };

  const shippingAddressLines = useMemo(() => {
    const lineOne = [formValues.address1, formValues.address2]
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .join(", ");
    const lineTwo = [
      String(formValues.city || "").trim(),
      [String(formValues.state || "").trim(), String(formValues.postalCode || "").trim()]
        .filter(Boolean)
        .join(" ")
    ]
      .filter(Boolean)
      .join(", ");

    const lines = [lineOne, lineTwo].filter(Boolean);
    return lines.length > 0 ? lines : ["Not provided"];
  }, [formValues.address1, formValues.address2, formValues.city, formValues.postalCode, formValues.state]);

  const reviewFields = [
    { label: "Name", value: summarizeValue(formValues.name) },
    { label: "Email", value: summarizeValue(formValues.email) },
    { label: "Phone", value: summarizeValue(formValues.phone) },
    {
      label: "Fulfillment",
      value: fulfillment === "market"
        ? "Pick up at Fulshear Farmers Market"
        : "Ship to me"
    },
    ...(fulfillment === "ship"
      ? [
          {
            label: "Address",
            value: shippingAddressLines
          }
        ]
      : []),
    { label: "Order note", value: summarizeValue(formValues.note) }
  ];

  return (
    <>
      {showOrderSuccessPopup ? (
        <div className="order-success-overlay" role="status" aria-live="polite">
          <div key={orderSuccessPopupKey} className="order-success-popup">
            <div className="order-success-popup__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" role="presentation">
                <path
                  d="M6 12.5l4 4 8-8"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <h4>Thank you for your order!</h4>
            <p>Your payment was received. Confirmation details are on the way.</p>
          </div>
        </div>
      ) : null}

      {itemCount > 0 ? (
        <button
          type="button"
          className="cart-drawer-toggle"
          onClick={handleMobileCheckoutJump}
          aria-label={`Go to cart summary. ${cartCountLabel} in cart.`}
        >
          <span className="cart-drawer-toggle__lead">
            <span className="cart-drawer-toggle__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" role="presentation">
                <path
                  d="M3 4h2l1.6 9.2a2 2 0 0 0 2 1.7h8.4a2 2 0 0 0 2-1.6L20.5 7H7.1"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="10" cy="19" r="1.5" fill="currentColor" />
                <circle cx="17" cy="19" r="1.5" fill="currentColor" />
              </svg>
            </span>
            <span className="cart-drawer-toggle__count">{itemCount}</span>
            <span className="cart-drawer-toggle__text">
              <span className="cart-drawer-toggle__label">View cart</span>
              <span className="cart-drawer-toggle__items">{cartCountLabel}</span>
            </span>
          </span>
          <strong className="cart-drawer-toggle__subtotal">{formatCurrency(subtotal)}</strong>
        </button>
      ) : null}

      <div className="store">
        <div className="store__grid">
          {products.map((product) => {
            const record = liveInventory[product.sku] || {
              on_hand: 0,
              preorders_remaining: 0,
              units_sold: 0,
              show_stock: true
            };

            const available = Math.max(0, Number(record.on_hand || 0));
            const salesCount = Math.max(0, Number(record.units_sold || 0));
            const isOut = available <= 0;
            const isLowStock = !isOut && available <= 6;
            const isBestSeller = salesCount >= 120;
            const inventoryLabel = isOut
              ? "Sold Out"
              : isLowStock
                ? `Only ${available} left`
                : `${available} in stock`;
            const inventoryClass = isOut
              ? "product-pill product-pill--out"
              : isLowStock
                ? "product-pill product-pill--low"
                : "product-pill product-pill--in";

            const cartQty = cart[product.sku] || 0;
            const isAddPulseActive = Boolean(addPulse[product.sku]);
            const wouldPreorder = Math.max(0, cartQty + 1 - available) > 0;
            const orderedSpecs = Array.isArray(product.specs)
              ? [...product.specs].sort((a, b) => {
                const aIsIngredients = typeof a === "string"
                  && a.trim().toLowerCase().startsWith("ingredients:");
                const bIsIngredients = typeof b === "string"
                  && b.trim().toLowerCase().startsWith("ingredients:");

                if (aIsIngredients === bIsIngredients) return 0;
                return aIsIngredients ? -1 : 1;
              })
              : [];
            const descriptionParts = splitDescription(product.description);
            const spiceProfile = getSpiceProfile(product.profile);

            return (
              <article className="product-card" key={product.sku}>
                <Image
                  src={product.image}
                  alt={product.name}
                  width={800}
                  height={600}
                  sizes="(max-width: 900px) 100vw, (max-width: 1400px) 50vw, 33vw"
                />
                <div className="product-card__content">
                  <div>
                    <div className="product-card__header">
                      <h3>{product.name}</h3>
                      {spiceProfile ? <span>{spiceProfile}</span> : null}
                    </div>
                    {shouldDisplayStock || isBestSeller ? (
                      <div className="product-card__badges">
                        {shouldDisplayStock ? (
                          <span className={inventoryClass}>{inventoryLabel}</span>
                        ) : null}
                        {isBestSeller ? (
                          <span className="product-pill product-pill--accent">
                            Best Seller
                          </span>
                        ) : null}
                      </div>
                    ) : null}
                    <ul>
                      {orderedSpecs.map((spec, index) => {
                        const isIngredients = typeof spec === "string"
                          && spec.trim().toLowerCase().startsWith("ingredients:");

                        return (
                          <li
                            key={`${product.sku}-spec-${index}`}
                            className={isIngredients ? "product-spec--ingredients" : undefined}
                          >
                            {spec}
                          </li>
                        );
                      })}
                    </ul>
                    {descriptionParts.lead ? (
                      <p className="product-card__lead">{descriptionParts.lead}</p>
                    ) : null}
                    {descriptionParts.benefit ? (
                      <p className="product-card__benefit">{descriptionParts.benefit}</p>
                    ) : null}
                    {descriptionParts.details.length > 0 ? (
                      <ul className="product-card__description-list">
                        {descriptionParts.details.map((detail, index) => (
                          <li key={`${product.sku}-desc-${index}`}>{detail}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>

                  <div className="product-card__footer">
                    <div>
                      <div className="price">
                        <span>{formatCurrency(product.priceCents)}</span>
                        {Number.isFinite(Number(product.sizeOz)) ? (
                          <span className="price__size">{`${product.sizeOz}oz`}</span>
                        ) : null}
                      </div>
                    </div>

                    <div className="product-card__actions">
                      <button
                        className={`button button--dark${isAddPulseActive ? " button--add-pulse" : ""}`}
                        type="button"
                        onClick={() => handleAdd(product)}
                        aria-label={`Add ${product.name} to cart`}
                      >
                        {isOut || wouldPreorder ? "Preorder" : "Add To Cart"}
                      </button>
                      {cartQty > 0 ? (
                        <span
                          className={`product-card__cart-counter${
                            isAddPulseActive ? " product-card__cart-counter--pulse" : ""
                          }`}
                          role="status"
                          aria-live="polite"
                        >
                          In cart: {cartQty}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="store__panel">
          <div id="cart-summary" tabIndex={-1} className="cart cart--sticky">
            <div className="cart__header">
              <div>
                <h3>Your Cart</h3>
                <span>{cartCountLabel}</span>
              </div>
              {itemCount > 0 && !isPaymentStep ? (
                <button
                  type="button"
                  className="cart__clear"
                  onClick={handleClearCart}
                >
                  Clear
                </button>
              ) : null}
            </div>

            {renderCartDetails("desktop", { allowQuantityEdit: !isPaymentStep })}
          </div>

          <form id="checkout-form" className="order-form" onSubmit={handleSubmit} noValidate>
            <h3>{isPaymentStep ? "Review & Pay" : "Complete Your Order"}</h3>
            <p>
              Preorders apply when demand exceeds current batch availability.
            </p>
            <p className="order-form__assist">
              {isPaymentStep
                ? "Review your order details below. Use Back to Edit if anything needs changes."
                : "Fields marked * are required. Payment opens after details validate."}
            </p>
            {!isPaymentStep ? (
              <div className="order-form__progress" aria-live="polite">
                <div className="order-form__progress-row">
                  <strong>
                    {requiredFieldCompleted}/{requiredFieldNames.length} required complete
                  </strong>
                  <span>{checkoutReadinessText}</span>
                </div>
                <div className="order-form__progress-track" aria-hidden="true">
                  <span style={{ width: `${completionProgress}%` }}></span>
                </div>
              </div>
            ) : null}

            {!isPaymentStep ? (
              <>
                <div className="form__row">
                  <label className={`form-field${hasFieldError("name") ? " form-field--error" : ""}`}>
                    Name *
                    <input
                      ref={setFieldRef("name")}
                      type="text"
                      name="name"
                      value={formValues.name}
                      placeholder="Your name"
                      autoComplete="name"
                      autoCapitalize="words"
                      onChange={handleFieldChange}
                      onBlur={handleFieldBlur}
                      aria-invalid={hasFieldError("name")}
                      aria-describedby={hasFieldError("name") ? "name-error" : undefined}
                      required
                    />
                    {hasFieldError("name") ? (
                      <span id="name-error" className="form-field__error" role="alert">
                        {getFieldError("name")}
                      </span>
                    ) : null}
                  </label>
                  <label className={`form-field${hasFieldError("email") ? " form-field--error" : ""}`}>
                    Email *
                    <input
                      ref={setFieldRef("email")}
                      type="email"
                      name="email"
                      value={formValues.email}
                      placeholder="you@vidaverde.com"
                      autoComplete="email"
                      inputMode="email"
                      onChange={handleFieldChange}
                      onBlur={handleFieldBlur}
                      aria-invalid={hasFieldError("email")}
                      aria-describedby={hasFieldError("email") ? "email-error" : undefined}
                      required
                    />
                    {hasFieldError("email") ? (
                      <span id="email-error" className="form-field__error" role="alert">
                        {getFieldError("email")}
                      </span>
                    ) : null}
                  </label>
                </div>

                <div className="form__row">
                  <label className={`form-field${hasFieldError("phone") ? " form-field--error" : ""}`}>
                    Phone
                    <input
                      ref={setFieldRef("phone")}
                      type="tel"
                      name="phone"
                      value={formValues.phone}
                      placeholder="+1 (555) 123-4567"
                      autoComplete="tel"
                      inputMode="tel"
                      maxLength={24}
                      onChange={handleFieldChange}
                      onBlur={handleFieldBlur}
                      aria-invalid={hasFieldError("phone")}
                      aria-describedby={hasFieldError("phone") ? "phone-error" : undefined}
                    />
                    {hasFieldError("phone") ? (
                      <span id="phone-error" className="form-field__error" role="alert">
                        {getFieldError("phone")}
                      </span>
                    ) : null}
                  </label>
                  <label className="form-field form-field--select">
                    Fulfillment *
                    <div className="select-wrap">
                      <select
                        ref={setFieldRef("fulfillment")}
                        name="fulfillment"
                        value={fulfillment}
                        onChange={handleFulfillmentChange}
                      >
                        <option value="ship">Ship to me</option>
                        <option value="market">
                          Pick up at Fulshear Farmers Market (Every Saturday)
                        </option>
                      </select>
                      <span className="select-wrap__icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" fill="none">
                          <path
                            d="M7 10l5 5 5-5"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    </div>
                  </label>
                </div>

                {requiresAddress ? (
                  <>
                    <label className={`form-field${hasFieldError("address1") ? " form-field--error" : ""}`}>
                      Address line 1 *
                      <input
                        ref={setFieldRef("address1")}
                        type="text"
                        name="address1"
                        value={formValues.address1}
                        placeholder="Street address"
                        autoComplete="address-line1"
                        onChange={handleFieldChange}
                        onBlur={handleFieldBlur}
                        aria-invalid={hasFieldError("address1")}
                        aria-describedby={hasFieldError("address1") ? "address1-error" : undefined}
                        required
                      />
                      {hasFieldError("address1") ? (
                        <span id="address1-error" className="form-field__error" role="alert">
                          {getFieldError("address1")}
                        </span>
                      ) : null}
                    </label>
                    <label className="form-field">
                      Address line 2
                      <input
                        ref={setFieldRef("address2")}
                        type="text"
                        name="address2"
                        value={formValues.address2}
                        placeholder="Apt, suite"
                        autoComplete="address-line2"
                        onChange={handleFieldChange}
                        onBlur={handleFieldBlur}
                      />
                    </label>
                    <div className="form__row form__row--city-state">
                      <label className={`form-field form-field--select${hasFieldError("city") ? " form-field--error" : ""}`}>
                        City *
                        <div className="select-wrap">
                          <select
                            ref={setFieldRef("city")}
                            name="city"
                            value={formValues.city}
                            onChange={handleFieldChange}
                            onBlur={handleFieldBlur}
                            aria-invalid={hasFieldError("city")}
                            aria-describedby={hasFieldError("city") ? "city-error" : undefined}
                            required
                          >
                            <option value="">Select city</option>
                            {cityOptions.map((city) => (
                              <option key={city} value={city}>
                                {city}
                              </option>
                            ))}
                          </select>
                          <span className="select-wrap__icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none">
                              <path
                                d="M7 10l5 5 5-5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </div>
                        {hasFieldError("city") ? (
                          <span id="city-error" className="form-field__error" role="alert">
                            {getFieldError("city")}
                          </span>
                        ) : null}
                      </label>
                      <label className={`form-field form-field--select${hasFieldError("state") ? " form-field--error" : ""}`}>
                        State *
                        <div className="select-wrap">
                          <select
                            ref={setFieldRef("state")}
                            name="state"
                            value={formValues.state}
                            onChange={handleFieldChange}
                            onBlur={handleFieldBlur}
                            aria-invalid={hasFieldError("state")}
                            aria-describedby={hasFieldError("state") ? "state-error" : undefined}
                            required
                          >
                            <option value="">Select state</option>
                            {US_STATE_OPTIONS.map((stateOption) => (
                              <option key={stateOption.code} value={stateOption.code}>
                                {stateOption.name}
                              </option>
                            ))}
                          </select>
                          <span className="select-wrap__icon" aria-hidden="true">
                            <svg viewBox="0 0 24 24" fill="none">
                              <path
                                d="M7 10l5 5 5-5"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </span>
                        </div>
                        {hasFieldError("state") ? (
                          <span id="state-error" className="form-field__error" role="alert">
                            {getFieldError("state")}
                          </span>
                        ) : null}
                      </label>
                    </div>
                    <label className={`form-field${hasFieldError("postalCode") ? " form-field--error" : ""}`}>
                      Postal code *
                      <input
                        ref={setFieldRef("postalCode")}
                        type="text"
                        name="postalCode"
                        value={formValues.postalCode}
                        autoComplete="postal-code"
                        inputMode="numeric"
                        maxLength={10}
                        onChange={handleFieldChange}
                        onBlur={handleFieldBlur}
                        aria-invalid={hasFieldError("postalCode")}
                        aria-describedby={hasFieldError("postalCode") ? "postalCode-error" : undefined}
                        required
                      />
                      {hasFieldError("postalCode") ? (
                        <span id="postalCode-error" className="form-field__error" role="alert">
                          {getFieldError("postalCode")}
                        </span>
                      ) : null}
                    </label>
                  </>
                ) : (
                  <div className="market-note">
                    Pickup available every Saturday at the Fulshear Farmers Market.
                  </div>
                )}

                <label className="form-field">
                  Order note
                  <textarea
                    ref={setFieldRef("note")}
                    name="note"
                    value={formValues.note}
                    rows={3}
                    placeholder="Dietary notes or pickup timing."
                    onChange={handleFieldChange}
                  ></textarea>
                </label>

                <button
                  className="button button--dark"
                  type="submit"
                  disabled={status === "submitting"}
                  aria-busy={status === "submitting"}
                >
                  {status === "submitting" ? "Preparing Payment..." : "Proceed to Payment"}
                </button>
              </>
            ) : (
              <>
                <div className="checkout-review">
                  <details className="checkout-dropdown" open>
                    <summary>
                      <span>Customer details</span>
                      <strong>{fulfillment === "ship" ? "Shipping" : "Pickup"}</strong>
                    </summary>
                    <div className="checkout-dropdown__content">
                      <dl className="checkout-review__fields">
                        {reviewFields.map((field) => (
                          <div key={`review-field-${field.label}`}>
                            <dt>{field.label}</dt>
                            <dd>
                              {Array.isArray(field.value)
                                ? field.value.map((line, index) => (
                                    <span key={`${field.label}-${index}`} className="checkout-review__value-line">
                                      {line}
                                    </span>
                                  ))
                                : field.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  </details>
                </div>

                <button className="button button--light" type="button" onClick={handleBackToEdit}>
                  Back to Edit Information
                </button>

                <div className="payment-panel">
                  <h4>Secure Payment</h4>
                  <p>
                    Card details are entered in Stripe secure fields and never stored on our
                    servers.
                  </p>
                  {stripePromise ? (
                    paymentClientSecret ? (
                      <Elements
                        stripe={stripePromise}
                        options={{
                          clientSecret: paymentClientSecret
                        }}
                      >
                        <StripePaymentForm
                          onPaymentState={handlePaymentState}
                          grossTotalCents={subtotal}
                        />
                      </Elements>
                    ) : (
                      <div className="form__status" role="status" aria-live="polite">
                        Updating secure payment details...
                      </div>
                    )
                  ) : (
                    <div className="form__status form__status--error" role="status" aria-live="polite">
                      Stripe publishable key is missing. Set
                      {" "}
                      NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY.
                    </div>
                  )}
                </div>
              </>
            )}

            {notice ? (
              <div
                className={`form__status${
                  status === "error" ? " form__status--error" : ""
                }`}
                role="status"
                aria-live="polite"
              >
                {notice}
              </div>
            ) : null}
          </form>
        </aside>
      </div>
    </>
  );
}
