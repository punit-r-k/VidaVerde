"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CardElement, Elements, useElements, useStripe } from "@stripe/react-stripe-js";
import { loadStripe } from "@stripe/stripe-js";
import { createPortal } from "react-dom";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { lockPageScroll, unlockPageScroll } from "@/lib/scrollLock";
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
import {
  MARKET_NAME,
  MARKET_PICKUP_ACKNOWLEDGEMENT_LABEL,
  MARKET_PICKUP_ACKNOWLEDGEMENT_NOTICE,
  MARKET_PICKUP_LABEL,
  MARKET_PICKUP_NOTE_LINES,
  MARKET_PICKUP_POLICY_ITEMS
} from "@/lib/pickupDetails";

const formatCurrency = (amountInCents) => {
  const n = Number(amountInCents);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${(n / 100).toFixed(2)}`;
};

const INVENTORY_POLL_MS = 30000;
const ORDER_FINALIZE_POLL_MS = 1500;
const ORDER_FINALIZE_MAX_ATTEMPTS = 8;
const CART_STORAGE_KEY = "vidaverde-cart-v1";
const PREORDER_TIMING_NOTICE =
  `Pre-orders are estimates only. Fermentation timelines vary, and preorder items may take up to 15 days before pickup is available. The next ${MARKET_NAME} date is not guaranteed for preorder items.`;
const PRODUCT_PREORDER_NOTICE =
  "Next unit is a pre-order. Not guaranteed for next farmers market; kraut can take up to 15 days.";
const CART_CHANGE_NOTICE_SUMMARY =
  "Stock changed while you were shopping. Review the updated cart before continuing.";
const CART_CHANGE_ACKNOWLEDGEMENT_BUTTON_LABEL =
  "Acknowledge And Review Updated Cart";
const PREORDER_ACKNOWLEDGEMENT_LABEL =
  "I understand preorder timing is estimated and not guaranteed for the next market.";
const ORDER_FINALIZE_MESSAGE =
  "Payment received. Finalizing your order...";
const ORDER_FINALIZE_PENDING_NOTICE =
  "Payment received. We are still finalizing your order. Please do not submit again. We will email confirmation as soon as it is recorded.";
const ORDER_SUCCESS_NOTICE =
  "Payment received. Your order is confirmed and fulfillment details are on the way.";
const ORDER_SUCCESS_POPUP_MESSAGE =
  "Your payment was received. Confirmation details are on the way.";
const PREORDER_NOTICE_MESSAGES = new Set([
  "Please acknowledge the pre-order notice before proceeding to payment.",
  "Please acknowledge the pre-order notice before payment."
]);
const HEALTH_BENEFIT_PATTERN =
  /(live[-\s]?cultures?|active[-\s]?cultures?|fiber(?:-rich)?|digestion|digestive|gut|probiotic|vitamin|antioxidant|health|wellness|immune|nutrient|plant variety)/i;
const SPICE_PROFILE_PATTERN =
  /(spice|hot|heat|mild|turmeric|cumin|pepper|jalapeno|habanero)/i;
const STRIPE_PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || "";
const stripePromise = STRIPE_PUBLISHABLE_KEY ? loadStripe(STRIPE_PUBLISHABLE_KEY) : null;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const isInventorySnapshot = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  return Object.values(value).every(
    (record) => record && typeof record === "object" && !Array.isArray(record)
  );
};

const toPositiveInteger = (value) => {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const sanitizeStoredCart = (value, validSkus) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return Object.entries(value).reduce((next, [sku, quantity]) => {
    if (!(validSkus instanceof Set) || !validSkus.has(sku)) {
      return next;
    }

    const normalizedQuantity = toPositiveInteger(quantity);
    if (normalizedQuantity <= 0) {
      return next;
    }

    next[sku] = normalizedQuantity;
    return next;
  }, {});
};

const buildCartInventoryState = (cart, products, inventory) => {
  if (!cart || typeof cart !== "object" || !Array.isArray(products)) {
    return [];
  }

  return products
    .filter((product) => toPositiveInteger(cart[product.sku]) > 0)
    .map((product) => {
      const quantity = toPositiveInteger(cart[product.sku]);
      const record = inventory?.[product.sku] || null;
      const hasInventoryRecord = Boolean(record && typeof record === "object");
      const available = hasInventoryRecord
        ? Math.max(0, Number(record.on_hand || 0))
        : Number.POSITIVE_INFINITY;
      const inStockUnits = hasInventoryRecord ? Math.min(quantity, available) : quantity;
      const preorderUnits = hasInventoryRecord ? Math.max(0, quantity - available) : 0;

      return {
        sku: product.sku,
        name: product.name,
        quantity,
        hasInventoryRecord,
        inStockUnits,
        preorderUnits
      };
    });
};

const getCartInventoryChanges = (previousState, nextState) => {
  const previousBySku = new Map(previousState.map((item) => [item.sku, item]));

  return nextState.reduce((changes, item) => {
    const previousItem = previousBySku.get(item.sku);

    if (!previousItem || !previousItem.hasInventoryRecord || !item.hasInventoryRecord) {
      return changes;
    }

    if (
      previousItem.inStockUnits === item.inStockUnits &&
      previousItem.preorderUnits === item.preorderUnits
    ) {
      return changes;
    }

    changes.push(item);
    return changes;
  }, []);
};

const formatUnitsLabel = (count) => `${count} ${count === 1 ? "unit" : "units"}`;

const formatCartChangeDetail = (change) => {
  if (change.preorderUnits <= 0) {
    return `${change.name} is now fully in stock for pickup.`;
  }

  if (change.inStockUnits <= 0) {
    return `${change.name} is out of stock and is now being set to a pre-order for ${formatUnitsLabel(change.quantity)}.`;
  }

  return `${change.name} now has ${formatUnitsLabel(change.inStockUnits)} in stock and ${formatUnitsLabel(change.preorderUnits)} on preorder.`;
};

const buildCartChangeNotice = (changes, id) => {
  const items = changes.map((change) => ({
    sku: change.sku,
    detail: formatCartChangeDetail(change)
  }));

  return {
    id,
    summary: CART_CHANGE_NOTICE_SUMMARY,
    items,
    details: items.map((item) => item.detail)
  };
};

const sanitizeFieldName = (value) => String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");

const getSpiceProfile = (profile) => {
  const text = typeof profile === "string" ? profile.trim() : "";
  if (!text) return "";
  return SPICE_PROFILE_PATTERN.test(text) ? text : "";
};

const splitDescription = (description) => {
  if (typeof description !== "string") {
    return { lead: "", benefit: "", pairings: [] };
  }

  const trimmed = description.trim();
  if (!trimmed) {
    return { lead: "", benefit: "", pairings: [] };
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
    pairings: nextDetails
  };
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
      const message = error?.message || "Unable to initialize payment.";
      setPaymentError(message);
      onPaymentState({ status: "error", message });
      setIsSubmitting(false);
      return;
    }

    const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
      payment_method: paymentMethod.id
    });

    if (error) {
      const message = error.message || "Payment could not be completed.";
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

export default function Storefront({ products, inventory = null }) {
  const searchParams = useSearchParams();
  const [cart, setCart] = useState({});
  const [cartHydrated, setCartHydrated] = useState(false);
  const [status, setStatus] = useState("idle");
  const [notice, setNotice] = useState("");
  const [checkoutStep, setCheckoutStep] = useState("details");
  const [fulfillment, setFulfillment] = useState("market");
  const [liveInventory, setLiveInventory] = useState(() =>
    isInventorySnapshot(inventory) ? inventory : null
  );
  const [formValues, setFormValues] = useState(INITIAL_FORM_VALUES);
  const [fieldErrors, setFieldErrors] = useState({});
  const [touchedFields, setTouchedFields] = useState({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [addPulse, setAddPulse] = useState({});
  const [showOrderSuccessPopup, setShowOrderSuccessPopup] = useState(false);
  const [orderSuccessPopupKey, setOrderSuccessPopupKey] = useState(0);
  const [orderSuccessPopupMessage, setOrderSuccessPopupMessage] = useState(
    ORDER_SUCCESS_POPUP_MESSAGE
  );
  const [pickupAcknowledged, setPickupAcknowledged] = useState(false);
  const [pickupTouched, setPickupTouched] = useState(false);
  const [preorderAcknowledged, setPreorderAcknowledged] = useState(false);
  const [preorderTouched, setPreorderTouched] = useState(false);
  const [cartChangeNotice, setCartChangeNotice] = useState(null);
  const [cartChangeHistory, setCartChangeHistory] = useState([]);
  const [showCartChangeModal, setShowCartChangeModal] = useState(false);
  const [showPickupPolicyModal, setShowPickupPolicyModal] = useState(false);
  const [openPairings, setOpenPairings] = useState({});
  const [pairingsHeights, setPairingsHeights] = useState({});
  const fieldRefs = useRef({});
  const pairingsPanelRefs = useRef({});
  const addPulseTimeoutsRef = useRef({});
  const orderSuccessPopupTimeoutRef = useRef(null);
  const cartSummaryRef = useRef(null);
  const checkoutStartedRef = useRef(false);
  const previousCheckoutStepRef = useRef("details");
  const cartSummarySeenRef = useRef(false);
  const cartChangeSequenceRef = useRef(0);
  const finalizingPaymentIntentRef = useRef("");
  const cartChangeDialogRef = useRef(null);
  const cartChangeLastFocusedRef = useRef(null);
  const pickupPolicyDialogRef = useRef(null);
  const pickupPolicyLastFocusedRef = useRef(null);
  const isPaymentStep = checkoutStep === "payment";
  const isOrderFinalizing =
    status === "finalizing" || status === "pending_confirmation";
  const cartRef = useRef(cart);
  const liveInventoryRef = useRef(liveInventory);
  const checkoutStepRef = useRef(checkoutStep);
  const isOrderFinalizingRef = useRef(isOrderFinalizing);

  cartRef.current = cart;
  liveInventoryRef.current = liveInventory;
  checkoutStepRef.current = checkoutStep;
  isOrderFinalizingRef.current = isOrderFinalizing;

  const resetPaymentState = useCallback((options = {}) => {
    const keepPaymentStep = options.keepPaymentStep === true;
    if (!keepPaymentStep) {
      setCheckoutStep("details");
    }
  }, []);

  const clearCartChangeNotice = useCallback(() => {
    setCartChangeNotice(null);
    setShowCartChangeModal(false);
  }, []);

  const resetCartChangeTracking = useCallback(() => {
    clearCartChangeNotice();
    setCartChangeHistory([]);
    cartChangeSequenceRef.current = 0;
  }, [clearCartChangeNotice]);

  const refreshPendingCartChangeReview = useCallback((nextItemCount) => {
    if (nextItemCount <= 0) {
      resetCartChangeTracking();
      return;
    }

    setCartChangeNotice((previousNotice) => {
      if (!previousNotice) return previousNotice;
      return {
        ...previousNotice,
        items: [],
        details: []
      };
    });
  }, [resetCartChangeTracking]);

  const resetCheckoutAfterSuccess = useCallback(() => {
    setCart({});
    setFulfillment("market");
    setFormValues(INITIAL_FORM_VALUES);
    setFieldErrors({});
    setTouchedFields({});
    setSubmitAttempted(false);
    setPickupAcknowledged(false);
    setPickupTouched(false);
    setPreorderAcknowledged(false);
    setPreorderTouched(false);
    resetCartChangeTracking();
    setCheckoutStep("details");
    checkoutStartedRef.current = false;
    finalizingPaymentIntentRef.current = "";
  }, [resetCartChangeTracking]);

  const triggerOrderSuccessPopup = useCallback((message = ORDER_SUCCESS_POPUP_MESSAGE) => {
    setOrderSuccessPopupMessage(message);
    setOrderSuccessPopupKey((prev) => prev + 1);
    setShowOrderSuccessPopup(true);

    if (orderSuccessPopupTimeoutRef.current) {
      clearTimeout(orderSuccessPopupTimeoutRef.current);
    }

    orderSuccessPopupTimeoutRef.current = setTimeout(() => {
      setShowOrderSuccessPopup(false);
      orderSuccessPopupTimeoutRef.current = null;
    }, 6500);
  }, []);

  const finalizePaidOrder = useCallback(
    async (paymentIntentId) => {
      const normalizedPaymentIntentId = String(paymentIntentId || "").trim();

      if (!normalizedPaymentIntentId) {
        trackAnalyticsEvent({
          name: "payment_result",
          sectionId: "shop",
          elementId: "payment_submit",
          checkoutStep: "payment",
          metadata: {
            result: "pending",
            errorCode: "missing_payment_intent"
          }
        });
        setStatus("pending_confirmation");
        setNotice(ORDER_FINALIZE_PENDING_NOTICE);
        finalizingPaymentIntentRef.current = "";
        return;
      }

      finalizingPaymentIntentRef.current = normalizedPaymentIntentId;

      for (let attempt = 0; attempt < ORDER_FINALIZE_MAX_ATTEMPTS; attempt += 1) {
        let response = null;
        let payload = {};

        try {
          response = await fetch("/api/order/finalize", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({
              paymentIntentId: normalizedPaymentIntentId
            })
          });
          payload = await response.json().catch(() => ({}));
        } catch {
          payload = {};
        }

        if (response?.ok && payload?.recorded) {
          const automationWarnings = Array.isArray(payload?.automationWarnings)
            ? payload.automationWarnings
            : [];
          const firstAutomationWarning =
            automationWarnings.find(
              (warning) =>
                typeof warning?.customerMessage === "string" &&
                warning.customerMessage.trim()
            ) || null;

          trackAnalyticsEvent({
            name: "payment_result",
            sectionId: "shop",
            elementId: "payment_submit",
            checkoutStep: "payment",
            metadata: {
              result: firstAutomationWarning ? "success_with_warning" : "success",
              automationWarningCode: String(firstAutomationWarning?.code || "")
            }
          });
          setStatus("success");
          setNotice(firstAutomationWarning?.customerMessage || ORDER_SUCCESS_NOTICE);
          triggerOrderSuccessPopup(
            firstAutomationWarning?.popupMessage || ORDER_SUCCESS_POPUP_MESSAGE
          );
          resetCheckoutAfterSuccess();
          return;
        }

        const paymentStatus = String(payload?.paymentStatus || "").trim().toLowerCase();
        const shouldRetry =
          response?.status === 202 ||
          !response ||
          paymentStatus === "processing" ||
          paymentStatus === "requires_capture";

        if (shouldRetry && attempt < ORDER_FINALIZE_MAX_ATTEMPTS - 1) {
          await wait(ORDER_FINALIZE_POLL_MS);
          continue;
        }

        break;
      }

      trackAnalyticsEvent({
        name: "payment_result",
        sectionId: "shop",
        elementId: "payment_submit",
        checkoutStep: "payment",
        metadata: {
          result: "pending",
          errorCode: "order_record_pending"
        }
      });
      setStatus("pending_confirmation");
      setNotice(ORDER_FINALIZE_PENDING_NOTICE);
      finalizingPaymentIntentRef.current = "";
    },
    [resetCheckoutAfterSuccess, triggerOrderSuccessPopup]
  );

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

  const focusPickupAcknowledgement = useCallback(() => {
    const node = fieldRefs.current.pickupAcknowledgement;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const focusPreorderAcknowledgement = useCallback(() => {
    const node = fieldRefs.current.preorderAcknowledgement;
    if (!node) return;
    node.focus();
    node.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const closeCartChangeModal = useCallback((reason = "dismiss") => {
    trackAnalyticsEvent({
      name: "checkout_cart_change_modal_close",
      sectionId: "shop",
      elementId: "cart_change_modal",
      checkoutStep,
      metadata: {
        reason
      }
    });
    setShowCartChangeModal(false);
    window.requestAnimationFrame(() => {
      const lastFocusedElement = cartChangeLastFocusedRef.current;
      if (lastFocusedElement instanceof HTMLElement && lastFocusedElement.isConnected) {
        lastFocusedElement.focus();
      }
    });
  }, [checkoutStep]);

  const handleAcknowledgeCartChange = useCallback(() => {
    clearCartChangeNotice();
    closeCartChangeModal("acknowledge_button");
    window.requestAnimationFrame(() => {
      const node = cartSummaryRef.current;
      if (!(node instanceof HTMLElement)) return;
      node.focus();
      node.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [clearCartChangeNotice, closeCartChangeModal]);

  const openPickupPolicyModal = useCallback(() => {
    trackAnalyticsEvent({
      name: "checkout_pickup_policy_open",
      sectionId: "shop",
      elementId: "checkout_pickup_policy_dialog",
      checkoutStep,
      metadata: {
        source: "pickup_acknowledgement"
      }
    });
    setShowPickupPolicyModal(true);
  }, [checkoutStep]);

  const closePickupPolicyModal = useCallback((reason = "dismiss") => {
    trackAnalyticsEvent({
      name: "checkout_pickup_policy_close",
      sectionId: "shop",
      elementId: "checkout_pickup_policy_dialog",
      checkoutStep,
      metadata: {
        reason
      }
    });
    setShowPickupPolicyModal(false);
    window.requestAnimationFrame(() => {
      const lastFocusedElement = pickupPolicyLastFocusedRef.current;
      if (lastFocusedElement instanceof HTMLElement && lastFocusedElement.isConnected) {
        lastFocusedElement.focus();
      }
    });
  }, [checkoutStep]);

  const getFieldError = useCallback((name) => {
    const hasError = Boolean(fieldErrors[name]);
    const shouldShow = submitAttempted || touchedFields[name];
    return hasError && shouldShow ? fieldErrors[name] : "";
  }, [fieldErrors, submitAttempted, touchedFields]);

  const hasFieldError = useCallback((name) => Boolean(getFieldError(name)), [getFieldError]);

  const applyInventory = useCallback((nextInventory) => {
    if (!isInventorySnapshot(nextInventory)) {
      return;
    }

    const previousInventory = liveInventoryRef.current;

    if (
      isInventorySnapshot(previousInventory) &&
      !isOrderFinalizingRef.current
    ) {
      const previousCartState = buildCartInventoryState(
        cartRef.current,
        products,
        previousInventory
      );
      const nextCartState = buildCartInventoryState(
        cartRef.current,
        products,
        nextInventory
      );
      const inventoryChanges = getCartInventoryChanges(previousCartState, nextCartState);

      if (inventoryChanges.length > 0) {
        cartChangeSequenceRef.current += 1;
        const nextCartChangeNotice = buildCartChangeNotice(
          inventoryChanges,
          `cart-change-${cartChangeSequenceRef.current}`
        );

        trackAnalyticsEvent({
          name: "cart_inventory_updated",
          sectionId: "shop",
          elementId: "cart_inventory_change",
          checkoutStep: checkoutStepRef.current,
          metadata: {
            affectedItems: inventoryChanges.length,
            movedFromPaymentStep: checkoutStepRef.current === "payment"
          }
        });
        setCartChangeNotice(nextCartChangeNotice);
        setCartChangeHistory((previousHistory) => [
          ...previousHistory,
          nextCartChangeNotice
        ]);
        setPreorderAcknowledged(false);
        setPreorderTouched(false);
        setShowCartChangeModal(true);

        if (checkoutStepRef.current === "payment") {
          setCheckoutStep("details");
        }
      }
    }

    setLiveInventory(nextInventory);
  }, [products]);

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
  }, [applyInventory]);

  useEffect(() => {
    applyInventory(inventory);
  }, [applyInventory, inventory]);

  useEffect(() => {
    const validSkus = new Set(products.map((product) => product.sku));

    try {
      const storedCart = window.localStorage.getItem(CART_STORAGE_KEY);
      if (!storedCart) {
        setCartHydrated(true);
        return;
      }

      const parsedCart = JSON.parse(storedCart);
      setCart(sanitizeStoredCart(parsedCart, validSkus));
    } catch {
      try {
        window.localStorage.removeItem(CART_STORAGE_KEY);
      } catch {
        // Ignore local persistence cleanup errors.
      }
    } finally {
      setCartHydrated(true);
    }
  }, [products]);

  useEffect(() => {
    if (!cartHydrated) return;

    try {
      if (Object.keys(cart).length === 0) {
        window.localStorage.removeItem(CART_STORAGE_KEY);
        return;
      }

      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch {
      // Ignore local persistence errors; the storefront remains functional.
    }
  }, [cart, cartHydrated]);

  useEffect(() => {
    if (!showCartChangeModal) return undefined;

    cartChangeLastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = cartChangeDialogRef.current;

    const getFocusableElements = () => {
      if (!(dialog instanceof HTMLElement)) {
        return [];
      }

      return Array.from(
        dialog.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        (element) =>
          element instanceof HTMLElement &&
          !element.hasAttribute("hidden") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0
      );
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeCartChangeModal("escape");
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      if (!focusableElements.length) {
        event.preventDefault();
        if (dialog instanceof HTMLElement) {
          dialog.focus();
        }
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    lockPageScroll();
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => {
      const focusableElements = getFocusableElements();
      if (focusableElements[0] instanceof HTMLElement) {
        focusableElements[0].focus();
      } else if (dialog instanceof HTMLElement) {
        dialog.focus();
      }
    });

    return () => {
      unlockPageScroll();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeCartChangeModal, showCartChangeModal]);

  useEffect(() => {
    if (!showCartChangeModal || !cartChangeNotice) return;

    const affectedItems = Array.isArray(cartChangeNotice.items)
      ? cartChangeNotice.items.length
      : Array.isArray(cartChangeNotice.details)
        ? cartChangeNotice.details.length
      : 0;

    trackAnalyticsEvent({
      name: "checkout_cart_change_modal_view",
      sectionId: "shop",
      elementId: "cart_change_modal",
      checkoutStep,
      metadata: {
        affectedItems
      }
    });
  }, [cartChangeNotice, checkoutStep, showCartChangeModal]);

  useEffect(() => {
    if (!showPickupPolicyModal) return undefined;

    pickupPolicyLastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = pickupPolicyDialogRef.current;

    const getFocusableElements = () => {
      if (!(dialog instanceof HTMLElement)) {
        return [];
      }

      return Array.from(
        dialog.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        (element) =>
          element instanceof HTMLElement &&
          !element.hasAttribute("hidden") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0
      );
    };

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closePickupPolicyModal("escape");
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      if (!focusableElements.length) {
        event.preventDefault();
        if (dialog instanceof HTMLElement) {
          dialog.focus();
        }
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    lockPageScroll();
    window.addEventListener("keydown", handleKeyDown);
    window.requestAnimationFrame(() => {
      const focusableElements = getFocusableElements();
      if (focusableElements[0] instanceof HTMLElement) {
        focusableElements[0].focus();
      } else if (dialog instanceof HTMLElement) {
        dialog.focus();
      }
    });

    return () => {
      unlockPageScroll();
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closePickupPolicyModal, showPickupPolicyModal]);

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
    const paymentIntentId = searchParams?.get("payment_intent");

    if (!checkoutStatus) return;

    if (checkoutStatus === "success") {
      if (paymentIntentId) {
        setStatus("finalizing");
        setNotice(ORDER_FINALIZE_MESSAGE);
        void finalizePaidOrder(paymentIntentId);
      } else {
        setStatus("pending_confirmation");
        setNotice(ORDER_FINALIZE_PENDING_NOTICE);
      }
    } else if (checkoutStatus === "cancel") {
      setStatus("error");
      setNotice("Payment canceled. Your cart is still saved below.");
      trackAnalyticsEvent({
        name: "payment_result",
        sectionId: "shop",
        elementId: "payment_submit",
        checkoutStep: "payment",
        metadata: {
          result: "cancel"
        }
      });
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
    finalizePaidOrder,
    resetPaymentState,
    searchParams
  ]);

  const shouldDisplayStock = useMemo(() => {
    if (!isInventorySnapshot(liveInventory)) {
      return false;
    }

    const records = Object.values(liveInventory);
    if (records.length === 0) return false;
    return records.some((record) => record?.show_stock !== false);
  }, [liveInventory]);

  const productLookup = useMemo(() => {
    return new Map(products.map((product) => [product.sku, product]));
  }, [products]);

  const cartItems = useMemo(() => {
    return products
      .filter((product) => cart[product.sku])
      .map((product) => {
        const quantity = cart[product.sku];
        const record = liveInventory?.[product.sku] || null;
        const hasInventoryRecord = Boolean(record && typeof record === "object");
        const available = hasInventoryRecord
          ? Math.max(0, Number(record.on_hand || 0))
          : Number.POSITIVE_INFINITY;
        const inStockUnits = hasInventoryRecord ? Math.min(quantity, available) : quantity;
        const preorderUnits = hasInventoryRecord ? Math.max(0, quantity - available) : 0;

        return {
          ...product,
          quantity,
          available: Number.isFinite(available) ? available : null,
          hasInventoryRecord,
          inStockUnits,
          preorderUnits,
          preordersCount: hasInventoryRecord
            ? Math.max(0, Number(record.preorders_remaining || 0))
            : 0,
          salesCount: hasInventoryRecord
            ? Math.max(0, Number(record.units_sold || 0))
            : 0,
          lineTotal: quantity * (product.priceCents || 0)
        };
      });
  }, [cart, products, liveInventory]);

  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const preorderUnitsInCart = cartItems.reduce((sum, item) => sum + item.preorderUnits, 0);
  const hasPreorderItems = preorderUnitsInCart > 0;
  const pickupAcknowledgementError = fulfillment === "market" &&
    !pickupAcknowledged &&
    (submitAttempted || pickupTouched);
  const preorderAcknowledgementError = hasPreorderItems &&
    !preorderAcknowledged &&
    (submitAttempted || preorderTouched);
  const cartChangeSummaryText = cartChangeNotice?.summary || CART_CHANGE_NOTICE_SUMMARY;
  const cartChangeAffectedItems = Array.isArray(cartChangeNotice?.items)
    ? cartChangeNotice.items.length
    : Array.isArray(cartChangeNotice?.details)
      ? cartChangeNotice.details.length
    : 0;
  const cartChangeHistoryItems = useMemo(() => {
    const latestBySku = new Map();

    cartChangeHistory.forEach((entry) => {
      const items = Array.isArray(entry.items)
        ? entry.items
        : Array.isArray(entry.details)
          ? entry.details.map((detail, index) => ({
            sku: `${entry.id}-detail-${index}`,
            detail
          }))
          : [];

      items.forEach((item) => {
        if (!item?.sku || !item?.detail) return;
        if (latestBySku.has(item.sku)) {
          latestBySku.delete(item.sku);
        }
        latestBySku.set(item.sku, {
          id: `${entry.id}-${item.sku}`,
          detail: item.detail
        });
      });
    });

    return Array.from(latestBySku.values());
  }, [cartChangeHistory]);
  const hasCartChangeHistory = cartChangeHistoryItems.length > 0;
  const showGlobalNotice = Boolean(notice) && !(
    status === "error" &&
    (
      isPaymentStep ||
      pickupAcknowledgementError ||
      preorderAcknowledgementError
    )
  );
  const requiresAddress = fulfillment === "ship";
  const cartCountLabel = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  const cityOptions = useMemo(() => {
    const selectedCity = String(formValues.city || "").trim();
    if (!selectedCity) return US_CITY_OPTIONS;

    const hasMatch = US_CITY_OPTIONS.some(
      (city) => city.toLowerCase() === selectedCity.toLowerCase()
    );
    return hasMatch ? US_CITY_OPTIONS : [selectedCity, ...US_CITY_OPTIONS];
  }, [formValues.city]);

  useEffect(() => {
    if (fulfillment === "market") return;
    setPickupAcknowledged(false);
    setPickupTouched(false);
  }, [fulfillment]);

  useEffect(() => {
    if (!hasPreorderItems) {
      setPreorderAcknowledged(false);
      setPreorderTouched(false);
    }
  }, [hasPreorderItems]);

  useEffect(() => {
    if (itemCount === 0) {
      checkoutStartedRef.current = false;
      resetCartChangeTracking();
    }
  }, [itemCount, resetCartChangeTracking]);

  useEffect(() => {
    const previousStep = previousCheckoutStepRef.current;
    if (previousStep === checkoutStep) return;

    previousCheckoutStepRef.current = checkoutStep;
    trackAnalyticsEvent({
      name: "checkout_step_changed",
      sectionId: "shop",
      elementId: `checkout_step_${checkoutStep}`,
      checkoutStep,
      metadata: {
        source: previousStep,
        result: checkoutStep,
        itemCount,
        subtotalCents: subtotal
      }
    });
  }, [checkoutStep, itemCount, subtotal]);

  useEffect(() => {
    if (itemCount <= 0) {
      cartSummarySeenRef.current = false;
      return undefined;
    }

    const node = cartSummaryRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting || cartSummarySeenRef.current) return;

          cartSummarySeenRef.current = true;
          trackAnalyticsEvent({
            name: "cart_summary_view",
            sectionId: "shop",
            elementId: "cart_summary",
            metadata: {
              itemCount,
              subtotalCents: subtotal
            }
          });
        });
      },
      {
        threshold: [0.35]
      }
    );

    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [itemCount, subtotal]);

  useEffect(() => {
    if (!showOrderSuccessPopup) return;

    trackAnalyticsEvent({
      name: "order_success_popup_view",
      sectionId: "shop",
      elementId: "order_success_popup",
      metadata: {
        itemCount,
        subtotalCents: subtotal
      }
    });
  }, [itemCount, showOrderSuccessPopup, subtotal]);

  const handleMobileCheckoutJump = useCallback(() => {
    const cartSummary = document.getElementById("cart-summary");
    if (!cartSummary) return;

    trackAnalyticsEvent({
      name: "checkout_jump_mobile",
      sectionId: "shop",
      elementId: "cart_drawer_toggle",
      metadata: {
        itemCount,
        subtotalCents: subtotal
      }
    });

    cartSummary.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [itemCount, subtotal]);

  const handlePairingsToggle = useCallback((sku) => {
    setOpenPairings((prev) => ({
      ...prev,
      [sku]: !prev[sku]
    }));
  }, []);

  const measurePairingsPanels = useCallback(() => {
    setPairingsHeights((prev) => {
      let changed = false;
      const next = { ...prev };

      Object.entries(pairingsPanelRefs.current).forEach(([sku, node]) => {
        if (!(node instanceof HTMLElement)) return;
        const height = Math.ceil(node.scrollHeight);
        if (next[sku] !== height) {
          next[sku] = height;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      measurePairingsPanels();
    });

    const handleResize = () => {
      measurePairingsPanels();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
    };
  }, [measurePairingsPanels, products, openPairings]);

  const buildOrderPayload = useCallback(() => {
    const hasCompleteInventorySnapshot =
      cartItems.length > 0 && cartItems.every((item) => item.hasInventoryRecord);

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
      consents: {
        pickupPolicyAccepted: fulfillment === "market" ? pickupAcknowledged : false
      },
      // Only send sku + quantity. Server decides sold vs preorder.
      items: cartItems.map((item) => ({
        sku: item.sku,
        quantity: item.quantity
      })),
      inventorySnapshot: hasCompleteInventorySnapshot
        ? {
            items: cartItems.map((item) => ({
              sku: item.sku,
              quantity: item.quantity,
              available: Math.max(0, Number(item.available || 0)),
              inStockUnits: Math.max(0, Number(item.inStockUnits || 0)),
              preorderUnits: Math.max(0, Number(item.preorderUnits || 0))
            }))
          }
        : undefined
    };
  }, [cartItems, formValues, fulfillment, pickupAcknowledged]);

  const handleAdd = (product) => {
    if (isOrderFinalizing) return;

    const currentQty = cart[product.sku] || 0;
    const nextQuantity = currentQty + 1;

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
      if (status !== "idle") {
        setStatus("idle");
        setNotice("");
      }
    } else {
      resetPaymentState();
    }

    if (!checkoutStartedRef.current) {
      checkoutStartedRef.current = true;
      trackAnalyticsEvent({
        name: "checkout_started",
        sectionId: "shop",
        elementId: "checkout_started",
        metadata: {
          itemCount: itemCount + 1,
          subtotalCents: subtotal + Number(product.priceCents || 0)
        }
      });
    }

    trackAnalyticsEvent({
      name: "product_add_to_cart",
      sectionId: "shop",
      elementId: `product_add_${product.sku.toLowerCase()}`,
      productSku: product.sku,
      metadata: {
        quantity: nextQuantity,
        itemCount: itemCount + 1,
        subtotalCents: subtotal + Number(product.priceCents || 0)
      }
    });

    refreshPendingCartChangeReview(itemCount + 1);

    setCart((prev) => {
      return {
        ...prev,
        [product.sku]: nextQuantity
      };
    });
  };

  const handleClearCart = () => {
    if (isOrderFinalizing) return;

    trackAnalyticsEvent({
      name: "cart_cleared",
      sectionId: "shop",
      elementId: "cart_clear",
      metadata: {
        itemCount,
        subtotalCents: subtotal
      }
    });

    resetPaymentState();
    setCart({});
    setPickupAcknowledged(false);
    setPickupTouched(false);
    setPreorderAcknowledged(false);
    setPreorderTouched(false);
    resetCartChangeTracking();
    checkoutStartedRef.current = false;

    if (status !== "idle") {
      setStatus("idle");
      setNotice("");
    }
  };

  const handleQuantityChange = (sku, nextQty) => {
    if (isOrderFinalizing) return;

    const previousQuantity = cart[sku] || 0;
    const normalizedNextQty = Math.max(0, nextQty);
    const nextItemCount = Math.max(itemCount + normalizedNextQty - previousQuantity, 0);
    const unitPrice = Number(productLookup.get(sku)?.priceCents || 0);
    const nextSubtotal = Math.max(
      subtotal + (normalizedNextQty - previousQuantity) * unitPrice,
      0
    );

    trackAnalyticsEvent({
      name: "cart_quantity_change",
      sectionId: "shop",
      elementId: `cart_qty_${sku.toLowerCase()}`,
      productSku: sku,
      metadata: {
        previousQuantity,
        nextQuantity: normalizedNextQty,
        subtotalCents: nextSubtotal
      }
    });

    resetPaymentState({ keepPaymentStep: isPaymentStep && nextItemCount > 0 });
    refreshPendingCartChangeReview(nextItemCount);

    if (nextItemCount === 0) {
      setPickupAcknowledged(false);
      setPickupTouched(false);
      setPreorderAcknowledged(false);
      setPreorderTouched(false);
      resetCartChangeTracking();
      checkoutStartedRef.current = false;
    }

    if (status !== "idle") {
      setStatus("idle");
      setNotice("");
    }

    setCart((prev) => {
      if (normalizedNextQty <= 0) {
        const { [sku]: _, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [sku]: normalizedNextQty
      };
    });
  };

  const handleAnalyticsFieldFocus = (event) => {
    const name = sanitizeFieldName(event.target?.name);
    if (!name) return;

    trackAnalyticsEvent({
      name: "checkout_field_focus",
      sectionId: "shop",
      elementId: `checkout_field_${name}`,
      checkoutStep,
      metadata: {
        fieldName: name
      }
    });
  };

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
    const nextErrors = validateCheckoutForm(nextValues, fulfillment);
    setFieldErrors(nextErrors);

    trackAnalyticsEvent({
      name: "checkout_field_blur",
      sectionId: "shop",
      elementId: `checkout_field_${sanitizeFieldName(name)}`,
      checkoutStep,
      metadata: {
        fieldName: sanitizeFieldName(name)
      }
    });

    if (nextErrors[name]) {
      trackAnalyticsEvent({
        name: "checkout_field_error",
        sectionId: "shop",
        elementId: `checkout_field_${sanitizeFieldName(name)}`,
        checkoutStep,
        metadata: {
          fieldName: sanitizeFieldName(name)
        }
      });
    }
  };

  const handleBackToEdit = useCallback(() => {
    if (isOrderFinalizing) return;

    resetPaymentState();
    setStatus("idle");
    setNotice("Review your details, then proceed to payment again.");
  }, [isOrderFinalizing, resetPaymentState]);

  const handlePickupAcknowledgementChange = (event) => {
    const isChecked = Boolean(event.currentTarget.checked);
    setPickupAcknowledged(isChecked);
    setPickupTouched(true);
    trackAnalyticsEvent({
      name: "checkout_pickup_ack_toggled",
      sectionId: "shop",
      elementId: "pickup_acknowledgement",
      checkoutStep,
      metadata: {
        result: isChecked ? "checked" : "unchecked"
      }
    });

    if (isChecked && status === "error" && notice === "Please accept the pickup policy before proceeding to payment.") {
      setStatus("idle");
      setNotice("");
    }
  };

  const handlePreorderAcknowledgementChange = (event) => {
    const isChecked = Boolean(event.currentTarget.checked);
    setPreorderAcknowledged(isChecked);
    setPreorderTouched(true);
    trackAnalyticsEvent({
      name: "checkout_preorder_ack_toggled",
      sectionId: "shop",
      elementId: "preorder_acknowledgement",
      checkoutStep,
      metadata: {
        result: isChecked ? "checked" : "unchecked",
        preorderUnits: preorderUnitsInCart
      }
    });

    if (isChecked && status === "error" && PREORDER_NOTICE_MESSAGES.has(notice)) {
      setStatus("idle");
      setNotice("");
    }
  };

  const createPaymentIntent = useCallback(async () => {
    if (fulfillment === "market" && !pickupAcknowledged) {
      const message = "Please accept the pickup policy before proceeding to payment.";
      trackAnalyticsEvent({
        name: "checkout_validation_blocked",
        sectionId: "shop",
        elementId: "pickup_acknowledgement",
        checkoutStep: "payment",
        metadata: {
          reason: "missing_pickup_ack",
          validationCount: 1
        }
      });
      setPickupTouched(true);
      setStatus("error");
      setNotice(message);
      focusPickupAcknowledgement();
      throw new Error(message);
    }

    if (hasPreorderItems && !preorderAcknowledged) {
      const message = "Please acknowledge the pre-order notice before payment.";
      trackAnalyticsEvent({
        name: "checkout_validation_blocked",
        sectionId: "shop",
        elementId: "preorder_acknowledgement",
        checkoutStep: "payment",
        metadata: {
          reason: "missing_preorder_ack",
          validationCount: 1
        }
      });
      setPreorderTouched(true);
      setStatus("error");
      setNotice(message);
      focusPreorderAcknowledgement();
      throw new Error(message);
    }

    const response = await fetch("/api/order", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildOrderPayload())
    });

    const result = await response.json();

    if (!response.ok) {
      if (
        response.status === 409 &&
        result?.code === "inventory_changed" &&
        isInventorySnapshot(result?.inventory)
      ) {
        applyInventory(result.inventory);
        setCheckoutStep("details");
        setPreorderAcknowledged(false);
        setPreorderTouched(false);
      }

      if (result?.fieldErrors && typeof result.fieldErrors === "object") {
        setFieldErrors((prev) => ({ ...prev, ...result.fieldErrors }));
        focusFirstInvalidField(result.fieldErrors, fulfillment);
      }
      throw new Error(result?.error || "Unable to start payment.");
    }

    if (!result?.clientSecret) {
      throw new Error("Payment session did not return a client secret.");
    }

    return result.clientSecret;
  }, [
    applyInventory,
    buildOrderPayload,
    focusFirstInvalidField,
    focusPickupAcknowledgement,
    focusPreorderAcknowledgement,
    fulfillment,
    hasPreorderItems,
    pickupAcknowledged,
    preorderAcknowledged
  ]);

  const handlePaymentState = useCallback(
    ({ status: nextStatus, message, paymentIntentId }) => {
      if (nextStatus === "processing") {
        setStatus("submitting");
        setNotice(message || "Processing payment securely...");
        return;
      }

      if (nextStatus === "finalizing") {
        const normalizedPaymentIntentId = String(paymentIntentId || "").trim();
        if (!normalizedPaymentIntentId) {
          setStatus("pending_confirmation");
          setNotice(ORDER_FINALIZE_PENDING_NOTICE);
          return;
        }

        if (finalizingPaymentIntentRef.current === normalizedPaymentIntentId) {
          return;
        }

        setStatus("finalizing");
        setNotice(message || ORDER_FINALIZE_MESSAGE);
        void finalizePaidOrder(normalizedPaymentIntentId);
        return;
      }

      trackAnalyticsEvent({
        name: "payment_result",
        sectionId: "shop",
        elementId: "payment_submit",
        checkoutStep: "payment",
        metadata: {
          result: "error",
          errorCode: "payment_failed"
        }
      });
      setStatus("error");
      setNotice(message || "Payment could not be completed.");
    },
    [finalizePaidOrder]
  );

  const handleSubmit = (event) => {
    event.preventDefault();

    if (isOrderFinalizing) return;

    if (status === "submitting") return;

    if (cartItems.length === 0) {
      trackAnalyticsEvent({
        name: "checkout_validation_blocked",
        sectionId: "shop",
        elementId: "checkout_submit",
        checkoutStep: "details",
        metadata: {
          reason: "empty_cart",
          validationCount: 1
        }
      });
      setStatus("error");
      setNotice("Add jars to your cart before checking out.");
      return;
    }

    setSubmitAttempted(true);
    const nextErrors = validateCheckoutForm(formValues, fulfillment);
    setFieldErrors(nextErrors);

    if (Object.keys(nextErrors).length > 0) {
      trackAnalyticsEvent({
        name: "checkout_validation_blocked",
        sectionId: "shop",
        elementId: "checkout_submit",
        checkoutStep: "details",
        metadata: {
          reason: "field_errors",
          validationCount: Object.keys(nextErrors).length
        }
      });
      setStatus("error");
      setNotice("Please fix the highlighted fields before checkout.");
      focusFirstInvalidField(nextErrors, fulfillment);
      return;
    }

    if (fulfillment === "market" && !pickupAcknowledged) {
      trackAnalyticsEvent({
        name: "checkout_validation_blocked",
        sectionId: "shop",
        elementId: "pickup_acknowledgement",
        checkoutStep: "details",
        metadata: {
          reason: "missing_pickup_ack",
          validationCount: 1
        }
      });
      setPickupTouched(true);
      setStatus("error");
      setNotice("Please accept the pickup policy before proceeding to payment.");
      focusPickupAcknowledgement();
      return;
    }

    if (hasPreorderItems && !preorderAcknowledged) {
      trackAnalyticsEvent({
        name: "checkout_validation_blocked",
        sectionId: "shop",
        elementId: "preorder_acknowledgement",
        checkoutStep: "details",
        metadata: {
          reason: "missing_preorder_ack",
          validationCount: 1
        }
      });
      setPreorderTouched(true);
      setStatus("error");
      setNotice("Please acknowledge the pre-order notice before proceeding to payment.");
      focusPreorderAcknowledgement();
      return;
    }

    trackAnalyticsEvent({
      name: "checkout_submit",
      sectionId: "shop",
      elementId: "checkout_submit",
      checkoutStep: "details",
      metadata: {
        itemCount,
        subtotalCents: subtotal,
        preorderUnits: preorderUnitsInCart
      }
    });
    setCheckoutStep("payment");
    setStatus("idle");
    setNotice("");
  };

  const renderPickupAcknowledgement = () => {
    if (fulfillment !== "market") return null;

    return (
      <div
        key="pickup-acknowledgement"
        className={`preorder-acknowledgement-wrap${
          pickupAcknowledgementError ? " preorder-acknowledgement-wrap--error" : ""
        }`}
      >
        <label className="preorder-acknowledgement">
          <input
            ref={setFieldRef("pickupAcknowledgement")}
            type="checkbox"
            name="pickupAcknowledgement"
            checked={pickupAcknowledged}
            onChange={handlePickupAcknowledgementChange}
            onBlur={() => setPickupTouched(true)}
            aria-invalid={pickupAcknowledgementError}
            aria-describedby={
              pickupAcknowledgementError
                ? "pickup-acknowledgement-error"
                : undefined
            }
            required
          />
          <span>{MARKET_PICKUP_ACKNOWLEDGEMENT_LABEL}</span>
        </label>
        <p className="preorder-acknowledgement__notice">{MARKET_PICKUP_ACKNOWLEDGEMENT_NOTICE}</p>
        <div className="preorder-acknowledgement__actions">
          <button
            type="button"
            className="button preorder-acknowledgement__policy-button"
            onClick={openPickupPolicyModal}
            aria-haspopup="dialog"
            data-analytics-id="checkout_pickup_policy_open"
            data-analytics-type="checkout-policy"
          >
            View Pickup Policy
          </button>
        </div>
        {pickupAcknowledgementError ? (
          <span
            id="pickup-acknowledgement-error"
            className="form-field__error"
            role="alert"
          >
            Please check this box to confirm payment is required to reserve pickup inventory and to accept the pickup policy.
          </span>
        ) : null}
      </div>
    );
  };

  const renderPreorderAcknowledgement = () => {
    if (!hasPreorderItems) return null;

    return (
      <div
        key="preorder-acknowledgement"
        className={`preorder-acknowledgement-wrap${
          preorderAcknowledgementError ? " preorder-acknowledgement-wrap--error" : ""
        }`}
      >
        <label className="preorder-acknowledgement">
          <input
            ref={setFieldRef("preorderAcknowledgement")}
            type="checkbox"
            name="preorderAcknowledgement"
            checked={preorderAcknowledged}
            onChange={handlePreorderAcknowledgementChange}
            onBlur={() => setPreorderTouched(true)}
            aria-invalid={preorderAcknowledgementError}
            aria-describedby={
              preorderAcknowledgementError
                ? "preorder-acknowledgement-error"
                : undefined
            }
            required
          />
          <span>{PREORDER_ACKNOWLEDGEMENT_LABEL}</span>
        </label>
        <p className="preorder-acknowledgement__notice">{PREORDER_TIMING_NOTICE}</p>
        {preorderAcknowledgementError ? (
          <span
            id="preorder-acknowledgement-error"
            className="form-field__error"
            role="alert"
          >
            Please check this box to acknowledge preorder timing.
          </span>
        ) : null}
      </div>
    );
  };

  const renderCartChangeAcknowledgement = () => {
    if (!cartChangeNotice) return null;

    return (
      <div key="cart-change-acknowledgement" className="preorder-acknowledgement-wrap">
        <p className="preorder-acknowledgement__notice">
          <strong>Cart updated.</strong>{" "}
          {cartChangeSummaryText}
        </p>
        {cartChangeHistoryItems.map(({ id, detail }) => (
          <p key={id} className="preorder-acknowledgement__notice">
            {detail}
          </p>
        ))}
      </div>
    );
  };

  const renderCheckoutAcknowledgements = () => {
    const acknowledgements = [
      renderCartChangeAcknowledgement(),
      renderPickupAcknowledgement(),
      renderPreorderAcknowledgement()
    ].filter(Boolean);

    if (acknowledgements.length === 0) return null;

    return (
      <div className={`checkout-acknowledgements${
        acknowledgements.length > 1
          ? " checkout-acknowledgements--double"
          : ""
      }`}>
        {acknowledgements}
      </div>
    );
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
                  {shouldDisplayStock && item.hasInventoryRecord ? (
                    <span className="cart__split">
                      <span>{item.inStockUnits} in stock</span>
                      {" | "}
                      <span className={item.preorderUnits > 0 ? "cart__preorder-count cart__preorder-count--accent" : "cart__preorder-count"}>
                        {item.preorderUnits} preorder
                      </span>
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

      {hasPreorderItems ? (
        <div className="preorder-disclaimer">
          <strong>Pre-order notice:</strong>
          {" "}
          {PREORDER_TIMING_NOTICE}
        </div>
      ) : null}

      {hasCartChangeHistory ? (
        <div className="preorder-acknowledgement-wrap" role="status" aria-live="polite">
          <p className="preorder-acknowledgement__notice">
            <strong>Cart updated.</strong>
            {" "}
            {cartChangeSummaryText}
          </p>
          {cartChangeHistoryItems.map(({ id, detail }) => (
            <p key={id} className="preorder-acknowledgement__notice">
              {detail}
            </p>
          ))}
        </div>
      ) : null}

      <div className="cart__summary">
        <div>
          <span>Subtotal</span>
          <strong>{formatCurrency(subtotal)}</strong>
        </div>
        <div>
          <span>Tax</span>
          <strong>$0.00</strong>
        </div>
        <div>
          <span>Shipping</span>
          <strong>$0.00</strong>
        </div>
        <div>
          <span>Total due today</span>
          <strong>{formatCurrency(subtotal)}</strong>
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
      value: MARKET_PICKUP_LABEL
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
            <p>{orderSuccessPopupMessage}</p>
          </div>
        </div>
      ) : null}

      {itemCount > 0 ? (
        <button
          type="button"
          className="cart-drawer-toggle"
          onClick={handleMobileCheckoutJump}
          aria-label={`Go to cart summary. ${cartCountLabel} in cart.`}
          data-analytics-id="cart_drawer_toggle"
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
            const record = liveInventory?.[product.sku] || null;
            const hasInventoryRecord = Boolean(record && typeof record === "object");
            const available = hasInventoryRecord
              ? Math.max(0, Number(record.on_hand || 0))
              : Number.POSITIVE_INFINITY;
            const salesCount = hasInventoryRecord
              ? Math.max(0, Number(record.units_sold || 0))
              : 0;
            const isOut = hasInventoryRecord ? available <= 0 : false;
            const isLowStock = hasInventoryRecord && !isOut && available <= 6;
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
            const cartPreorderUnits = hasInventoryRecord ? Math.max(0, cartQty - available) : 0;
            const nextPreorderUnits = hasInventoryRecord
              ? Math.max(0, cartQty + 1 - available)
              : 0;
            const wouldPreorder = hasInventoryRecord && nextPreorderUnits > 0;
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
            const isPairingsOpen = Boolean(openPairings[product.sku]);
            const pairingsId = `product-pairings-${sanitizeFieldName(product.sku)}`;
            const pairingsButtonId = `${pairingsId}-toggle`;

            return (
              <article
                className="product-card"
                key={product.sku}
                data-analytics-id={`product_card_${product.sku.toLowerCase()}`}
                data-analytics-product-sku={product.sku}
                data-analytics-hover="true"
              >
                <div className="product-card__placeholder" aria-hidden="true">
                  <span>Photos Coming Soon</span>
                </div>
                <div className="product-card__content">
                  <div>
                    <div className="product-card__header">
                      <h3>{product.name}</h3>
                      {spiceProfile ? <span>{spiceProfile}</span> : null}
                    </div>
                    {shouldDisplayStock || isBestSeller ? (
                      <div className="product-card__badges">
                        {shouldDisplayStock && hasInventoryRecord ? (
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
                    {descriptionParts.pairings.length > 0 ? (
                      <div className={`product-card__pairings${
                        isPairingsOpen ? " product-card__pairings--open" : ""
                      }`}>
                        <button
                          type="button"
                          id={pairingsButtonId}
                          className="product-card__pairings-toggle"
                          aria-expanded={isPairingsOpen}
                          aria-controls={pairingsId}
                          onClick={() => handlePairingsToggle(product.sku)}
                        >
                          View Pairings
                        </button>
                        <div
                          id={pairingsId}
                          className="product-card__pairings-panel"
                          role="region"
                          aria-labelledby={pairingsButtonId}
                          aria-hidden={!isPairingsOpen}
                          ref={(node) => {
                            if (node instanceof HTMLElement) {
                              pairingsPanelRefs.current[product.sku] = node;
                              return;
                            }

                            delete pairingsPanelRefs.current[product.sku];
                          }}
                          style={{
                            maxHeight: isPairingsOpen
                              ? `${pairingsHeights[product.sku] ?? 0}px`
                              : "0px"
                          }}
                        >
                          <ul className="product-card__pairings-list">
                            {descriptionParts.pairings.map((detail, index) => (
                              <li key={`${product.sku}-desc-${index}`}>{detail}</li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    ) : null}
                  </div>

                  <div className="product-card__purchase">
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
                          aria-label={
                            isOut
                              ? `Preorder ${product.name}`
                              : wouldPreorder
                                ? `Add as Pre-order ${product.name}`
                                : `Add To Cart ${product.name}`
                          }
                          data-analytics-id={`product_add_${product.sku.toLowerCase()}`}
                          data-analytics-hover="true"
                        >
                          {isOut ? "Preorder" : wouldPreorder ? (
                            <span className="product-card__button-label-stack">
                              <span>Add as</span>
                              <span>Pre-order</span>
                            </span>
                          ) : "Add To Cart"}
                        </button>
                      </div>
                    </div>
                    {cartQty > 0 ? (
                      <div className="product-card__cart-counter-row">
                        <span
                          className={`product-card__cart-counter${
                            isAddPulseActive ? " product-card__cart-counter--pulse" : ""
                          }`}
                          role="status"
                          aria-live="polite"
                        >
                          In cart: {cartQty}
                          {cartPreorderUnits > 0 ? ` (${cartPreorderUnits} preorder)` : ""}
                        </span>
                      </div>
                    ) : null}
                    {wouldPreorder ? (
                      <p className="product-card__preorder-note">
                        {PRODUCT_PREORDER_NOTICE}
                      </p>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="store__panel">
          <div
            id="cart-summary"
            ref={cartSummaryRef}
            tabIndex={-1}
            className="cart cart--sticky"
            data-analytics-id="cart_summary"
          >
            <div className="cart__header">
              <div>
                <h3>Your Cart</h3>
                <span>{cartCountLabel}</span>
              </div>
              {itemCount > 0 && !isPaymentStep && !isOrderFinalizing ? (
                <button
                  type="button"
                  className="cart__clear"
                  onClick={handleClearCart}
                  data-analytics-id="cart_clear"
                >
                  Clear
                </button>
              ) : null}
            </div>

            {renderCartDetails("desktop", {
              allowQuantityEdit: !isOrderFinalizing
            })}
          </div>

          <form
            id="checkout-form"
            className="order-form store__checkout"
            onSubmit={handleSubmit}
            onFocusCapture={handleAnalyticsFieldFocus}
            noValidate
          >
            <h3>{isPaymentStep ? "Review & Pay" : "Complete Your Order"}</h3>
            <p>
              {hasPreorderItems
                ? `Pre-order notice: ${PREORDER_TIMING_NOTICE}`
                : "Preorders apply when demand exceeds current batch availability."}
            </p>
            <p className="order-form__assist">
              {isPaymentStep
                ? "Review your order details below. Use Back to Edit if anything needs changes."
                : "Fields marked * are required. Payment opens after details validate."}
            </p>

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
                    <div
                      ref={setFieldRef("fulfillment")}
                      className="form-field__readonly"
                    >
                      {MARKET_PICKUP_LABEL}
                    </div>
                    <span className="form-field__hint">Shipping option coming soon.</span>
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
                  <div className="form__row form__row--note-market">
                    <label className="form__row-label form__row-label--note-market" htmlFor="order-note">
                      Order note
                    </label>
                    <textarea
                      id="order-note"
                      ref={setFieldRef("note")}
                      name="note"
                      value={formValues.note}
                      rows={3}
                      className="form__note-market-textarea"
                      placeholder="Anything we should know about your order or situation."
                      onChange={handleFieldChange}
                    ></textarea>

                    <div className="market-note">
                      <strong>{MARKET_PICKUP_LABEL}</strong>
                      <ul>
                        {MARKET_PICKUP_NOTE_LINES.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {requiresAddress ? (
                  <label className="form-field">
                    Order note
                    <textarea
                      ref={setFieldRef("note")}
                      name="note"
                      value={formValues.note}
                      rows={3}
                      placeholder="Anything we should know about your order or situation."
                      onChange={handleFieldChange}
                    ></textarea>
                  </label>
                ) : null}

                {renderCheckoutAcknowledgements()}

                <button
                  className="button button--dark"
                  type="submit"
                  disabled={status === "submitting"}
                  aria-busy={status === "submitting"}
                  data-analytics-id="checkout_submit"
                  data-analytics-hover="true"
                >
                  {status === "submitting" ? "Preparing Payment..." : "Proceed to Payment"}
                </button>
              </>
            ) : (
              <>
                <div className="checkout-review">
                  <details
                    className="checkout-dropdown"
                    open
                    data-analytics-id="checkout_review_details"
                    data-analytics-type="checkout-review"
                  >
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

                {renderCheckoutAcknowledgements()}

                <button
                  className="button button--light"
                  type="button"
                  onClick={handleBackToEdit}
                  disabled={isOrderFinalizing}
                  data-analytics-id="checkout_back_to_edit"
                >
                  Back to Edit Information
                </button>

                <div className="payment-panel">
                  <h4>Secure Payment</h4>
                  <p>
                    {isOrderFinalizing
                      ? "Stripe has accepted your payment. We are now finalizing the order on the server before confirming completion."
                      : `Card details are entered in Stripe secure fields and never stored on our servers. Your card will be charged ${formatCurrency(subtotal)} today for this market pickup order.`}
                  </p>
                  {stripePromise ? (
                    <Elements stripe={stripePromise}>
                      <StripePaymentForm
                        onPaymentState={handlePaymentState}
                        grossTotalCents={subtotal}
                        createPaymentIntent={createPaymentIntent}
                        isLocked={isOrderFinalizing}
                        billingDetails={{
                          name: formValues.name,
                          email: formValues.email,
                          phone: formValues.phone,
                          address1: formValues.address1,
                          address2: formValues.address2,
                          city: formValues.city,
                          state: formValues.state,
                          postalCode: formValues.postalCode
                        }}
                      />
                    </Elements>
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

            {showGlobalNotice ? (
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

      {showCartChangeModal && cartChangeNotice && typeof document !== "undefined"
        ? createPortal(
        <div
          className="cart-change-modal"
          onClick={() => closeCartChangeModal("overlay")}
        >
          <div
            className="cart-change-modal__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="cart-change-modal-title"
            aria-describedby="cart-change-modal-intro"
            ref={cartChangeDialogRef}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            data-analytics-id="cart_change_modal"
            data-analytics-hover="true"
          >
            <div className="cart-change-modal__eyebrow">Cart Updated</div>
            <h3 id="cart-change-modal-title">Your cart changed during checkout</h3>
            <p id="cart-change-modal-intro" className="cart-change-modal__intro">
              {cartChangeSummaryText}
            </p>
            {cartChangeHistoryItems.length > 0 ? (
              <ul className="cart-change-modal__list">
                {cartChangeHistoryItems.map(({ id, detail }) => (
                  <li key={id}>{detail}</li>
                ))}
              </ul>
            ) : null}
            <p className="cart-change-modal__note">
              Use the button below to acknowledge the change and jump back to your updated cart.
            </p>
            <div className="cart-change-modal__actions">
              <button
                type="button"
                className="button button--dark"
                onClick={handleAcknowledgeCartChange}
              >
                {CART_CHANGE_ACKNOWLEDGEMENT_BUTTON_LABEL}
              </button>
            </div>
          </div>
        </div>,
        document.body
      ) : null}

      {showPickupPolicyModal && typeof document !== "undefined"
        ? createPortal(
        <div
          className="pickup-policy-modal"
          onClick={() => closePickupPolicyModal("overlay")}
        >
          <div
            className="pickup-policy-modal__panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="pickup-policy-modal-title"
            aria-describedby="pickup-policy-modal-intro"
            ref={pickupPolicyDialogRef}
            tabIndex={-1}
            onClick={(event) => event.stopPropagation()}
            data-analytics-id="checkout_pickup_policy_dialog"
            data-analytics-hover="true"
          >
            <div className="pickup-policy-modal__topbar">
              <div className="pickup-policy-modal__heading">
                <p className="pickup-policy-modal__eyebrow">Pickup Policy</p>
                <h3 id="pickup-policy-modal-title">Review before payment</h3>
                <p id="pickup-policy-modal-intro" className="pickup-policy-modal__intro">
                  {MARKET_PICKUP_ACKNOWLEDGEMENT_NOTICE}
                </p>
              </div>
              <button
                type="button"
                className="pickup-policy-modal__close"
                onClick={() => closePickupPolicyModal("close_button")}
                aria-label="Close pickup policy"
              >
                Close
              </button>
            </div>

            <div className="pickup-policy-modal__grid">
              {MARKET_PICKUP_POLICY_ITEMS.map((item) => (
                <article key={item.label} className="pickup-policy-modal__item">
                  <strong>{item.label}</strong>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
