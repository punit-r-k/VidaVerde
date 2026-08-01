"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Image from "next/image";
import { createPortal } from "react-dom";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { lockPageScroll, unlockPageScroll } from "@/lib/scrollLock";
import {
  SUPPORT_EMAIL,
  SUPPORT_PHONE_DISPLAY,
  SUPPORT_PHONE_E164
} from "@/lib/siteMetadata";
import {
  CONTINENTAL_US_SHIPPING_AREA_LABEL,
  DEFAULT_SHIPPING_OPTION_ID,
  FORM_FIELD_ORDER,
  INITIAL_FORM_VALUES,
  SHIPPING_FIELDS,
  SHIPPING_COUNTRY_CODE,
  SHIPPING_COUNTRY_LABEL,
  formatCheckoutInputValue,
  getCitySpellingSuggestion,
  getCheckoutFieldErrors,
  getStateSpellingSuggestion,
  normalizeShippingOptionId,
  normalizeFulfillment
} from "@/lib/checkoutSchema";
import {
  getCustomerShippingOptions,
  getEstimatedShipDate,
  getLatestExpectedDeliveryDate,
  getShippingOptionsForCart,
  SHIPPING_SCHEDULE_EXPEDITED_LINE,
  SHIPPING_SCHEDULE_EXPEDITED_NOTE,
  SHIPPING_SCHEDULE_INTRO,
  SHIPPING_SCHEDULE_STANDARD_LINE,
  SHIPPING_SCHEDULE_TIME_ZONE,
  SHIPPING_SCHEDULE_TITLE
} from "@/lib/shippingPricing";
import {
  MARKET_ADDRESS,
  MARKET_NAME,
  MARKET_PICKUP_ACKNOWLEDGEMENT_LABEL,
  MARKET_PICKUP_ACKNOWLEDGEMENT_NOTICE,
  MARKET_PICKUP_LABEL,
  MARKET_PICKUP_NOTE_LINES,
  MARKET_PICKUP_POLICY_ITEMS,
  MARKET_PICKUP_WINDOW,
  getPickupDetails
} from "@/lib/pickupDetails";

const StripePaymentPanel = dynamic(() => import("./StripePaymentPanel"), {
  loading: () => (
    <div className="form__status" role="status" aria-live="polite">
      Loading secure payment...
    </div>
  )
});

const formatCurrency = (amountInCents) => {
  const n = Number(amountInCents);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${(n / 100).toFixed(2)}`;
};

const formatExpectedDeliveryDate = (date, orderDate = new Date()) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

  const options = {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE
  };

  const yearFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE
  });

  if (yearFormatter.format(date) !== yearFormatter.format(orderDate)) {
    options.year = "numeric";
  }

  return new Intl.DateTimeFormat("en-US", options).format(date);
};

const getExpectedDeliveryText = ({
  shippingOption,
  hasPreorderItems = false,
  orderDate = new Date()
} = {}) => {
  const latestDate = getLatestExpectedDeliveryDate({
    orderDate,
    shippingOption,
    hasPreorderItems
  });
  const formattedDate = formatExpectedDeliveryDate(latestDate, orderDate);
  return formattedDate ? `Expected by ${formattedDate}` : "";
};

const INVENTORY_POLL_MS = 30000;
const ORDER_FINALIZE_POLL_MS = 1500;
const ORDER_FINALIZE_MAX_ATTEMPTS = 8;
const CART_STORAGE_KEY = "vidaverde-cart-v1";
const EMAIL_POPUP_DISMISS_KEY = "vidaverde-email-popup-dismissed-v1";
const PICKUP_PREORDER_TIMING_NOTICE =
  `Pre-orders are estimates only. Fermentation timelines vary, and preorder items may take up to 15 days before pickup is available. The next ${MARKET_NAME} date is not guaranteed for preorder items.`;
const SHIPPING_PREORDER_TIMING_NOTICE =
  "Pre-orders are estimates only. Fermentation timelines vary, and preorder items may take up to 15 days before they are ready to ship. The selected shipping timeline starts after the product is ready, not from the order date.";
const CART_CHANGE_NOTICE_SUMMARY =
  "Stock changed while you were shopping. Review the updated cart before continuing.";
const CART_CHANGE_ACKNOWLEDGEMENT_BUTTON_LABEL =
  "Acknowledge And Review Updated Cart";
const PICKUP_PREORDER_ACKNOWLEDGEMENT_LABEL =
  "I understand preorder timing is estimated and not guaranteed for the next market.";
const SHIPPING_PREORDER_ACKNOWLEDGEMENT_LABEL =
  "I understand preorder items ship only after they are ready, which can take up to 15 days before the shipping timeline starts.";
const ORDER_FINALIZE_MESSAGE =
  "Payment received. Finalizing your order...";
const ORDER_FINALIZE_PENDING_NOTICE =
  `Payment received. We are still finalizing your order, so please do not submit again. We will email confirmation as soon as it is recorded. If you do not see it shortly, contact us at ${SUPPORT_EMAIL} or ${SUPPORT_PHONE_DISPLAY}.`;
const ORDER_SUCCESS_NOTICE =
  `Payment received. Your order is confirmed, and receipt plus pickup details are on the way by email. If you would like new product announcements, healthy eating notes, recipe ideas, and Vida Verde updates, you can join our email list below. Questions? Contact us at ${SUPPORT_EMAIL} or ${SUPPORT_PHONE_DISPLAY}.`;
const ORDER_SHIPPING_SUCCESS_NOTICE =
  `Payment received. Your order is confirmed, and your receipt is on the way by email. Shipping updates or delivery details will be emailed when available. Questions? Contact us at ${SUPPORT_EMAIL} or ${SUPPORT_PHONE_DISPLAY}.`;
const ORDER_SUCCESS_POPUP_MESSAGE =
  "Your payment was received. Watch your email for your receipt and pickup details.";
const ORDER_SHIPPING_SUCCESS_POPUP_MESSAGE =
  "Your payment was received. Watch your email for your receipt and shipping updates.";
const SHIPPING_CHECKOUT_VISIBLE = true;
const DEFAULT_FULFILLMENT = "ship";
const SHIPPING_QUOTE_DEBOUNCE_MS = 700;
const formatFinalCheckoutValues = (values) =>
  Object.keys(INITIAL_FORM_VALUES).reduce((nextValues, name) => {
    nextValues[name] = formatCheckoutInputValue(name, values?.[name], { final: true });
    return nextValues;
  }, {});
const PREORDER_NOTICE_MESSAGES = new Set([
  "Please acknowledge the pre-order notice before proceeding to payment.",
  "Please acknowledge the pre-order notice before payment."
]);
const HEALTH_BENEFIT_PATTERN =
  /(live[-\s]?cultures?|active[-\s]?cultures?|fiber(?:-rich)?|digestion|digestive|gut|probiotic|vitamin|antioxidant|health|wellness|immune|nutrient|plant variety)/i;
const SPICE_PROFILE_PATTERN =
  /(spice|hot|heat|mild|turmeric|cumin|pepper|jalapeno|habanero)/i;
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

export default function Storefront({ products, inventory = null, pickupDetails = null }) {
  const searchParams = useSearchParams();
  const [cart, setCart] = useState({});
  const [cartHydrated, setCartHydrated] = useState(false);
  const [status, setStatus] = useState("idle");
  const [notice, setNotice] = useState("");
  const [checkoutStep, setCheckoutStep] = useState("details");
  const [preparedPayment, setPreparedPayment] = useState(null);
  const [shippingPreview, setShippingPreview] = useState(null);
  const [shippingPreviewStatus, setShippingPreviewStatus] = useState("idle");
  const [shippingPreviewError, setShippingPreviewError] = useState("");
  const [fulfillment, setFulfillment] = useState(DEFAULT_FULFILLMENT);
  const [shippingOptionId, setShippingOptionId] = useState(DEFAULT_SHIPPING_OPTION_ID);
  const [shippingScheduleNow, setShippingScheduleNow] = useState(() => new Date());
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
  const [orderSuccessContext, setOrderSuccessContext] = useState(null);
  const [pickupAcknowledged, setPickupAcknowledged] = useState(false);
  const [pickupTouched, setPickupTouched] = useState(false);
  const [preorderAcknowledged, setPreorderAcknowledged] = useState(false);
  const [preorderTouched, setPreorderTouched] = useState(false);
  const [emailOptIn, setEmailOptIn] = useState(true);
  const [cartChangeNotice, setCartChangeNotice] = useState(null);
  const [cartChangeHistory, setCartChangeHistory] = useState([]);
  const [showCartChangeModal, setShowCartChangeModal] = useState(false);
  const [showPickupPolicyModal, setShowPickupPolicyModal] = useState(false);
  const [openPairings, setOpenPairings] = useState({});
  const [pairingsHeights, setPairingsHeights] = useState({});
  const [openShippingSchedules, setOpenShippingSchedules] = useState({});
  const [shippingScheduleHeights, setShippingScheduleHeights] = useState({});
  const fieldRefs = useRef({});
  const pairingsPanelRefs = useRef({});
  const shippingSchedulePanelRefs = useRef({});
  const addPulseTimeoutsRef = useRef({});
  const orderSuccessDialogRef = useRef(null);
  const orderSuccessLastFocusedRef = useRef(null);
  const cartSummaryRef = useRef(null);
  const checkoutFormRef = useRef(null);
  const checkoutStartedRef = useRef(false);
  const previousCheckoutStepRef = useRef("details");
  const checkoutStepScrollPositionRef = useRef(null);
  const checkoutStepPreviousFormHeightRef = useRef(0);
  const cartSummarySeenRef = useRef(false);
  const cartChangeSequenceRef = useRef(0);
  const shippingPreviewRequestRef = useRef(0);
  const finalizingPaymentRef = useRef("");
  const emailOptInSubmittedRef = useRef("");
  const cartChangeDialogRef = useRef(null);
  const cartChangeLastFocusedRef = useRef(null);
  const pickupPolicyDialogRef = useRef(null);
  const pickupPolicyLastFocusedRef = useRef(null);
  const isPaymentStep = checkoutStep === "payment";
  const isOrderFinalizing =
    status === "finalizing" || status === "pending_confirmation";
  const checkoutPickupDetails = useMemo(() => {
    const source =
      pickupDetails && typeof pickupDetails === "object"
        ? pickupDetails
        : getPickupDetails();

    return {
      market_name: source.market_name || MARKET_NAME,
      market_address: source.market_address || MARKET_ADDRESS,
      pickup_window: source.pickup_window || MARKET_PICKUP_WINDOW,
      same_day_cutoff_label: source.same_day_cutoff_label || "",
      market_date_label: source.market_date_label || ""
    };
  }, [pickupDetails]);
  const pickupMapUrl = useMemo(
    () =>
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
        checkoutPickupDetails.market_address
      )}`,
    [checkoutPickupDetails.market_address]
  );
  const supportSmsHref = `sms:${SUPPORT_PHONE_E164}`;
  const cartRef = useRef(cart);
  const liveInventoryRef = useRef(liveInventory);
  const checkoutStepRef = useRef(checkoutStep);
  const isOrderFinalizingRef = useRef(isOrderFinalizing);
  const checkoutSuccessContextRef = useRef(null);

  cartRef.current = cart;
  liveInventoryRef.current = liveInventory;
  checkoutStepRef.current = checkoutStep;
  isOrderFinalizingRef.current = isOrderFinalizing;

  const resetPaymentState = useCallback(() => {
    setPreparedPayment(null);
    checkoutStepScrollPositionRef.current = null;
    checkoutStepPreviousFormHeightRef.current = 0;
    setCheckoutStep("details");
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
    setFulfillment(DEFAULT_FULFILLMENT);
    setShippingOptionId(DEFAULT_SHIPPING_OPTION_ID);
    setFormValues(INITIAL_FORM_VALUES);
    setFieldErrors({});
    setTouchedFields({});
    setSubmitAttempted(false);
    setPickupAcknowledged(false);
    setPickupTouched(false);
    setPreorderAcknowledged(false);
    setPreorderTouched(false);
    setEmailOptIn(true);
    emailOptInSubmittedRef.current = "";
    resetCartChangeTracking();
    checkoutStepPreviousFormHeightRef.current = 0;
    setPreparedPayment(null);
    setCheckoutStep("details");
    checkoutStartedRef.current = false;
    finalizingPaymentRef.current = "";
  }, [resetCartChangeTracking]);

  const closeOrderSuccessPopup = useCallback((reason = "close_button") => {
    trackAnalyticsEvent({
      name: "order_success_popup_close",
      sectionId: "shop",
      elementId: "order_success_popup",
      metadata: {
        reason
      }
    });
    setShowOrderSuccessPopup(false);

    window.requestAnimationFrame(() => {
      const lastFocusedElement = orderSuccessLastFocusedRef.current;
      if (lastFocusedElement instanceof HTMLElement && lastFocusedElement.isConnected) {
        lastFocusedElement.focus();
      }
    });
  }, []);

  const triggerOrderSuccessPopup = useCallback((message = ORDER_SUCCESS_POPUP_MESSAGE, context = null) => {
    setOrderSuccessPopupMessage(message);
    setOrderSuccessContext(context && typeof context === "object" ? context : null);
    setOrderSuccessPopupKey((prev) => prev + 1);
    setShowOrderSuccessPopup(true);
  }, []);

  const submitCheckoutEmailOptIn = useCallback(async (email) => {
    const normalizedEmail = String(email || "").trim().toLowerCase();
    if (!normalizedEmail || emailOptInSubmittedRef.current === normalizedEmail) return;

    emailOptInSubmittedRef.current = normalizedEmail;
    trackAnalyticsEvent({
      name: "email_signup_submit",
      sectionId: "shop",
      elementId: "checkout_email_opt_in",
      checkoutStep: "payment",
      metadata: {
        source: "checkout_opt_in"
      }
    });

    try {
      const response = await fetch("/api/email-signups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: normalizedEmail,
          source: "checkout_opt_in"
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error || "Email opt-in failed.");
      }

      window.localStorage.setItem(EMAIL_POPUP_DISMISS_KEY, "1");
      trackAnalyticsEvent({
        name: "email_signup_result",
        sectionId: "shop",
        elementId: "checkout_email_opt_in",
        checkoutStep: "payment",
        metadata: {
          source: "checkout_opt_in",
          result: "success"
        }
      });
    } catch (error) {
      emailOptInSubmittedRef.current = "";
      trackAnalyticsEvent({
        name: "email_signup_result",
        sectionId: "shop",
        elementId: "checkout_email_opt_in",
        checkoutStep: "payment",
        metadata: {
          source: "checkout_opt_in",
          result: "error",
          errorCode: "submission_failed"
        }
      });
      console.error("checkout email opt-in error:", error);
    }
  }, []);

  const finalizePaidOrder = useCallback(
    async ({ paymentIntentId = "", sessionId = "" } = {}) => {
      const normalizedPaymentIntentId = String(paymentIntentId || "").trim();
      const normalizedSessionId = String(sessionId || "").trim();
      const paymentReference = normalizedSessionId || normalizedPaymentIntentId;

      if (!paymentReference) {
        trackAnalyticsEvent({
          name: "payment_result",
          sectionId: "shop",
          elementId: "payment_submit",
          checkoutStep: "payment",
          metadata: {
            result: "pending",
            errorCode: "missing_payment_reference"
          }
        });
        setStatus("pending_confirmation");
        setNotice(ORDER_FINALIZE_PENDING_NOTICE);
        finalizingPaymentRef.current = "";
        return;
      }

      finalizingPaymentRef.current = paymentReference;

      for (let attempt = 0; attempt < ORDER_FINALIZE_MAX_ATTEMPTS; attempt += 1) {
        let response = null;
        let payload = {};

        try {
          response = await fetch("/api/order/finalize", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify(
              normalizedSessionId
                ? { sessionId: normalizedSessionId }
                : { paymentIntentId: normalizedPaymentIntentId }
            )
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
          const currentSuccessContext = checkoutSuccessContextRef.current || {};
          const returnedFulfillment =
            payload?.fulfillment === "ship" || payload?.fulfillment === "market"
              ? payload.fulfillment
              : currentSuccessContext.fulfillment;
          const successContext = {
            ...currentSuccessContext,
            fulfillment: returnedFulfillment,
            shippingOptionLabel:
              payload?.shippingOptionLabel ||
              currentSuccessContext.shippingOptionLabel ||
              "",
            shippingTransitLabel:
              payload?.shippingEstimate ||
              currentSuccessContext.shippingTransitLabel ||
              ""
          };
          const successNotice =
            successContext?.fulfillment === "ship"
              ? ORDER_SHIPPING_SUCCESS_NOTICE
              : ORDER_SUCCESS_NOTICE;
          const successPopupMessage =
            successContext?.fulfillment === "ship"
              ? ORDER_SHIPPING_SUCCESS_POPUP_MESSAGE
              : ORDER_SUCCESS_POPUP_MESSAGE;
          setStatus("success");
          setNotice(firstAutomationWarning?.customerMessage || successNotice);
          triggerOrderSuccessPopup(
            firstAutomationWarning?.popupMessage || successPopupMessage,
            successContext
          );
          if (emailOptIn) {
            void submitCheckoutEmailOptIn(payload?.customerEmail || formValues.email);
          }
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
      finalizingPaymentRef.current = "";
    },
    [
      emailOptIn,
      formValues.email,
      resetCheckoutAfterSuccess,
      submitCheckoutEmailOptIn,
      triggerOrderSuccessPopup
    ]
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

  const validateCheckoutForm = useCallback((values, nextFulfillment, nextShippingOptionId = shippingOptionId) => {
    return getCheckoutFieldErrors(values, nextFulfillment, nextShippingOptionId);
  }, [shippingOptionId]);

  const focusFirstInvalidField = useCallback((errors, nextFulfillment) => {
    const fields = nextFulfillment === "ship"
      ? FORM_FIELD_ORDER
      : FORM_FIELD_ORDER.filter(
        (name) => !SHIPPING_FIELDS.includes(name) && name !== "shippingOption"
      );

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

  // Poll inventory after initial load. The server-rendered snapshot keeps the
  // first view current without holding page-load network idle open.
  useEffect(() => {
    let active = true;
    let intervalId = null;

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

    const startPolling = () => {
      if (!active || intervalId) return;
      intervalId = setInterval(fetchInventory, INVENTORY_POLL_MS);
      fetchInventory();
    };

    const timeoutId = window.setTimeout(startPolling, INVENTORY_POLL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchInventory();
    };

    window.addEventListener("focus", fetchInventory);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      window.clearTimeout(timeoutId);
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
    if (!showOrderSuccessPopup) return undefined;

    orderSuccessLastFocusedRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = orderSuccessDialogRef.current;
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
        closeOrderSuccessPopup("escape");
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
  }, [closeOrderSuccessPopup, showOrderSuccessPopup]);

  useEffect(() => {
    return () => {
      Object.values(addPulseTimeoutsRef.current).forEach((timeoutId) => {
        clearTimeout(timeoutId);
      });
      addPulseTimeoutsRef.current = {};
    };
  }, []);

  useEffect(() => {
    const checkoutStatus = searchParams?.get("checkout");
    const paymentIntentId = searchParams?.get("payment_intent");
    const sessionId = searchParams?.get("session_id");

    if (!checkoutStatus) return;

    if (checkoutStatus === "success") {
      if (sessionId) {
        setStatus("finalizing");
        setNotice(ORDER_FINALIZE_MESSAGE);
        void finalizePaidOrder({ sessionId });
      } else if (paymentIntentId) {
        setStatus("finalizing");
        setNotice(ORDER_FINALIZE_MESSAGE);
        void finalizePaidOrder({ paymentIntentId });
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
      url.searchParams.delete("session_id");
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
  const shippingQuote = useMemo(
    () =>
      getShippingOptionsForCart({
        items: cartItems.map((item) => ({
          sku: item.sku,
          quantity: item.quantity,
          productType: item.productType
        })),
        subtotalCents: subtotal
      }),
    [cartItems, subtotal]
  );
  const customerShippingOptions = useMemo(
    () =>
      getCustomerShippingOptions({
        shipping: shippingQuote
      }),
    [shippingQuote]
  );
  const normalizedShippingOptionId = normalizeShippingOptionId(shippingOptionId);
  const shippingAddressErrors = useMemo(
    () => getCheckoutFieldErrors(formValues, "ship", normalizedShippingOptionId),
    [formValues, normalizedShippingOptionId]
  );
  const shippingPreviewReady =
    cartHydrated &&
    fulfillment === "ship" &&
    cartItems.length > 0 &&
    SHIPPING_FIELDS.every((fieldName) => !shippingAddressErrors[fieldName]);
  const shippingQuoteRequestPayload = useMemo(
    () => ({
      shippingOption: normalizedShippingOptionId,
      customer: {
        address1: String(formValues.address1 || "").trim(),
        address2: String(formValues.address2 || "").trim(),
        city: String(formValues.city || "").trim(),
        state: String(formValues.state || "").trim(),
        postalCode: String(formValues.postalCode || "").trim(),
        country: SHIPPING_COUNTRY_CODE
      },
      items: cartItems.map((item) => ({
        sku: item.sku,
        quantity: item.quantity
      }))
    }),
    [
      cartItems,
      formValues.address1,
      formValues.address2,
      formValues.city,
      formValues.postalCode,
      formValues.state,
      normalizedShippingOptionId
    ]
  );
  const shippingQuoteRequestFingerprint = useMemo(
    () => JSON.stringify(shippingQuoteRequestPayload),
    [shippingQuoteRequestPayload]
  );
  const activeShippingPreview =
    fulfillment === "ship" &&
    shippingPreview?.requestFingerprint === shippingQuoteRequestFingerprint &&
    normalizeShippingOptionId(shippingPreview?.id) === normalizedShippingOptionId
      ? shippingPreview
      : null;
  const displayedShipping = fulfillment === "ship"
    ? preparedPayment?.shipping || activeShippingPreview
    : null;
  const selectedShippingOption = useMemo(() => {
    const baseOption = (
      customerShippingOptions.find(
        (option) => option.id === normalizedShippingOptionId
      ) ||
      customerShippingOptions.find(
        (option) => option.id === DEFAULT_SHIPPING_OPTION_ID
      ) ||
      shippingQuote.normalOption
    );
    return displayedShipping
      ? { ...baseOption, ...displayedShipping }
      : baseOption;
  }, [
    customerShippingOptions,
    displayedShipping,
    normalizedShippingOptionId,
    shippingQuote.normalOption
  ]);
  const shippingCents =
    SHIPPING_CHECKOUT_VISIBLE && fulfillment === "ship" && itemCount > 0
      ? Number(displayedShipping?.amountCents || 0)
      : 0;
  const preparedTotal = Number(preparedPayment?.totalCents);
  const orderTotal = Number.isFinite(preparedTotal) && preparedTotal > 0
    ? preparedTotal
    : subtotal + shippingCents;
  const shippingPriceText =
    fulfillment !== "ship"
      ? formatCurrency(0)
      : displayedShipping
        ? formatCurrency(shippingCents)
        : shippingPreviewStatus === "loading" && shippingPreviewReady
          ? "Updating..."
          : shippingPreviewError
            ? "Unavailable"
            : "Calculated from address";
  const preorderUnitsInCart = cartItems.reduce((sum, item) => sum + item.preorderUnits, 0);
  const hasPreorderItems = preorderUnitsInCart > 0;
  const estimatedShipDate = getEstimatedShipDate({
    orderDate: shippingScheduleNow,
    hasPreorderItems
  });
  const selectedExpectedDeliveryText = fulfillment === "ship" && displayedShipping?.expectedArrivalLabel
    ? `Expected arrival: ${displayedShipping.expectedArrivalLabel}`
    : fulfillment === "ship" && displayedShipping
      ? getExpectedDeliveryText({
        shippingOption: selectedShippingOption,
        hasPreorderItems,
        orderDate: shippingScheduleNow
      })
      : "";
  const estimatedShipDateText = formatExpectedDeliveryDate(
    estimatedShipDate,
    shippingScheduleNow
  );

  useEffect(() => {
    const requestId = shippingPreviewRequestRef.current + 1;
    shippingPreviewRequestRef.current = requestId;

    if (!shippingPreviewReady) {
      setShippingPreview(null);
      setShippingPreviewStatus("idle");
      setShippingPreviewError("");
      return undefined;
    }

    const controller = new AbortController();
    setShippingPreview(null);
    setShippingPreviewStatus("loading");
    setShippingPreviewError("");

    const timeoutId = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/shipping/quote", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: shippingQuoteRequestFingerprint,
          signal: controller.signal
        });
        const responseContentType = response.headers.get("content-type") || "";
        const result = responseContentType.includes("application/json")
          ? await response.json().catch(() => ({}))
          : {};

        if (!response.ok) {
          throw new Error(result?.error || "We couldn't update shipping. Please try again.");
        }
        if (!result?.shipping || Number(result.shipping.amountCents) <= 0) {
          throw new Error("We couldn't update shipping. Please try again.");
        }
        if (controller.signal.aborted || shippingPreviewRequestRef.current !== requestId) {
          return;
        }

        setShippingPreview({
          ...result.shipping,
          requestFingerprint: shippingQuoteRequestFingerprint
        });
        setShippingPreviewStatus("ready");
        setShippingPreviewError("");
      } catch (error) {
        if (controller.signal.aborted || shippingPreviewRequestRef.current !== requestId) {
          return;
        }

        setShippingPreview(null);
        setShippingPreviewStatus("error");
        setShippingPreviewError(
          error instanceof Error && error.message
            ? error.message
            : "We couldn't update shipping. Please try again."
        );
      }
    }, SHIPPING_QUOTE_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      controller.abort();
    };
  }, [
    shippingPreviewReady,
    shippingQuoteRequestFingerprint
  ]);

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
  const requiresAddress = SHIPPING_CHECKOUT_VISIBLE && fulfillment === "ship";
  const cartCountLabel = `${itemCount} item${itemCount === 1 ? "" : "s"}`;
  const pickupScenario =
    fulfillment === "market"
      ? preorderUnitsInCart > 0
        ? preorderUnitsInCart >= itemCount
          ? "preorder_only"
          : "mixed"
        : "standard"
      : "shipping";
  const preorderTimingNotice =
    fulfillment === "ship" ? SHIPPING_PREORDER_TIMING_NOTICE : PICKUP_PREORDER_TIMING_NOTICE;
  const preorderAcknowledgementLabel =
    fulfillment === "ship"
      ? SHIPPING_PREORDER_ACKNOWLEDGEMENT_LABEL
      : PICKUP_PREORDER_ACKNOWLEDGEMENT_LABEL;

  checkoutSuccessContextRef.current = {
    fulfillment,
    pickupScenario,
    pickupDateLabel: checkoutPickupDetails.market_date_label,
    pickupWindow: checkoutPickupDetails.pickup_window,
    marketName: checkoutPickupDetails.market_name,
    marketAddress: checkoutPickupDetails.market_address,
    shippingOptionLabel: fulfillment === "ship" ? selectedShippingOption?.label || "" : "",
    shippingTransitLabel: fulfillment === "ship" ? selectedShippingOption?.transitLabel || "" : "",
    shippingShipDateLabel: fulfillment === "ship" ? estimatedShipDateText : "",
    preorderUnits: preorderUnitsInCart,
    totalCents: orderTotal
  };

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      setShippingScheduleNow(new Date());
    }, 60000);

    return () => window.clearInterval(intervalId);
  }, []);

  const citySpellingSuggestion = useMemo(
    () => getCitySpellingSuggestion(formValues.city),
    [formValues.city]
  );
  const stateSpellingSuggestion = useMemo(
    () => getStateSpellingSuggestion(formValues.state),
    [formValues.state]
  );

  useEffect(() => {
    if (!requiresAddress) return;
    const normalizedShippingOptionId = normalizeShippingOptionId(shippingOptionId);
    const hasSelectedOption = customerShippingOptions.some(
      (option) => option.id === normalizedShippingOptionId
    );

    if (!hasSelectedOption) {
      setShippingOptionId(DEFAULT_SHIPPING_OPTION_ID);
      if (submitAttempted || touchedFields.shippingOption) {
        setFieldErrors(
          validateCheckoutForm(formValues, fulfillment, DEFAULT_SHIPPING_OPTION_ID)
        );
      }
    }
  }, [
    customerShippingOptions,
    formValues,
    fulfillment,
    requiresAddress,
    shippingOptionId,
    submitAttempted,
    touchedFields.shippingOption,
    validateCheckoutForm
  ]);

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
        subtotalCents: subtotal,
        shippingCents,
        totalCents: orderTotal
      }
    });
  }, [checkoutStep, itemCount, orderTotal, shippingCents, subtotal]);

  useLayoutEffect(() => {
    const scrollPosition = checkoutStepScrollPositionRef.current;
    if (!scrollPosition || typeof window === "undefined") return;
    let restoredScrollY = scrollPosition.y;

    if (checkoutStep === "payment") {
      const currentFormHeight = Math.ceil(
        checkoutFormRef.current?.getBoundingClientRect().height || 0
      );
      const previousFormHeight = checkoutStepPreviousFormHeightRef.current;
      if (previousFormHeight > 0 && currentFormHeight > 0) {
        const removedHeight = Math.max(previousFormHeight - currentFormHeight, 0);
        restoredScrollY = Math.max(scrollPosition.y - removedHeight, 0);
      }
    }

    const restoreScrollPosition = () => {
      window.scrollTo(scrollPosition.x, restoredScrollY);
    };
    const frameIds = [];

    restoreScrollPosition();
    frameIds.push(
      window.requestAnimationFrame(() => {
        restoreScrollPosition();
        frameIds.push(
          window.requestAnimationFrame(() => {
            restoreScrollPosition();
            checkoutStepScrollPositionRef.current = null;
          })
        );
      })
    );

    return () => {
      frameIds.forEach((frameId) => window.cancelAnimationFrame(frameId));
    };
  }, [checkoutStep]);

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
              subtotalCents: subtotal,
              shippingCents,
              totalCents: orderTotal
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
  }, [itemCount, orderTotal, shippingCents, subtotal]);

  useEffect(() => {
    if (!showOrderSuccessPopup) return;

    trackAnalyticsEvent({
      name: "order_success_popup_view",
      sectionId: "shop",
      elementId: "order_success_popup",
      metadata: {
        itemCount,
        subtotalCents: subtotal,
        shippingCents,
        totalCents: orderTotal
      }
    });
  }, [itemCount, orderTotal, shippingCents, showOrderSuccessPopup, subtotal]);

  const handleMobileCheckoutJump = useCallback(() => {
    const cartSummary = document.getElementById("cart-summary");
    if (!cartSummary) return;

    trackAnalyticsEvent({
      name: "checkout_jump_mobile",
      sectionId: "shop",
      elementId: "cart_drawer_toggle",
      metadata: {
        itemCount,
        subtotalCents: subtotal,
        shippingCents,
        totalCents: orderTotal
      }
    });

    cartSummary.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [itemCount, orderTotal, shippingCents, subtotal]);

  const handlePairingsToggle = useCallback((sku) => {
    setOpenPairings((prev) => ({
      ...prev,
      [sku]: !prev[sku]
    }));
  }, []);

  const handleShippingScheduleToggle = useCallback((id) => {
    setOpenShippingSchedules((prev) => ({
      ...prev,
      [id]: !prev[id]
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

  const measureShippingSchedulePanels = useCallback(() => {
    setShippingScheduleHeights((prev) => {
      let changed = false;
      const next = { ...prev };

      Object.entries(shippingSchedulePanelRefs.current).forEach(([id, node]) => {
        if (!(node instanceof HTMLElement)) return;
        const height = Math.ceil(node.scrollHeight);
        if (next[id] !== height) {
          next[id] = height;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      measurePairingsPanels();
      measureShippingSchedulePanels();
    });

    const handleResize = () => {
      measurePairingsPanels();
      measureShippingSchedulePanels();
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.removeEventListener("resize", handleResize);
    };
  }, [
    measurePairingsPanels,
    measureShippingSchedulePanels,
    products,
    openPairings,
    openShippingSchedules,
    estimatedShipDateText,
    hasPreorderItems
  ]);

  const buildOrderPayload = useCallback((valuesOverride = formValues) => {
    const hasCompleteInventorySnapshot =
      cartItems.length > 0 && cartItems.every((item) => item.hasInventoryRecord);
    const checkoutValues = valuesOverride && typeof valuesOverride === "object"
      ? valuesOverride
      : formValues;

    return {
      fulfillment: normalizeFulfillment(fulfillment),
      shippingOption: normalizeShippingOptionId(
        selectedShippingOption?.id || shippingOptionId
      ),
      customer: {
        name: String(checkoutValues.name || "").trim(),
        email: String(checkoutValues.email || "").trim(),
        phone: String(checkoutValues.phone || "").trim(),
        address1: String(checkoutValues.address1 || "").trim(),
        address2: String(checkoutValues.address2 || "").trim(),
        city: String(checkoutValues.city || "").trim(),
        state: String(checkoutValues.state || "").trim(),
        postalCode: String(checkoutValues.postalCode || "").trim(),
        country: SHIPPING_COUNTRY_CODE,
        note: String(checkoutValues.note || "").trim()
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
  }, [
    cartItems,
    formValues,
    fulfillment,
    pickupAcknowledged,
    selectedShippingOption?.id,
    shippingOptionId
  ]);

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
      resetPaymentState();
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
    setShippingOptionId(DEFAULT_SHIPPING_OPTION_ID);
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

    resetPaymentState();
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

  const handleShippingOptionChange = (event) => {
    const nextShippingOptionId = normalizeShippingOptionId(event.currentTarget.value);
    if (nextShippingOptionId === normalizeShippingOptionId(shippingOptionId)) return;

    const nextShippingOption =
      customerShippingOptions.find((option) => option.id === nextShippingOptionId) ||
      selectedShippingOption;

    setShippingOptionId(nextShippingOptionId);
    setTouchedFields((prev) => ({
      ...prev,
      shippingOption: true
    }));
    resetPaymentState();

    if (status !== "idle") {
      setStatus("idle");
      setNotice("");
    }

    if (submitAttempted || touchedFields.shippingOption) {
      setFieldErrors(validateCheckoutForm(formValues, fulfillment, nextShippingOptionId));
    } else if (fieldErrors.shippingOption) {
      setFieldErrors((prev) => {
        const nextErrors = { ...prev };
        delete nextErrors.shippingOption;
        return nextErrors;
      });
    }

    trackAnalyticsEvent({
      name: "checkout_shipping_option_selected",
      sectionId: "shop",
      elementId: "checkout_shipping_option",
      checkoutStep,
      metadata: {
        optionId: nextShippingOptionId,
        optionLabel: nextShippingOption?.label || "",
        amountCents: Number(nextShippingOption?.amountCents || 0)
      }
    });
  };

  const handleFulfillmentChange = (event) => {
    const nextFulfillment = normalizeFulfillment(event.currentTarget.value);
    if (nextFulfillment === fulfillment) return;

    setFulfillment(nextFulfillment);
    resetPaymentState();
    setSubmitAttempted(false);
    setFieldErrors(validateCheckoutForm(formValues, nextFulfillment));

    if (status !== "idle") {
      setStatus("idle");
      setNotice("");
    }

    trackAnalyticsEvent({
      name: "checkout_step_changed",
      sectionId: "shop",
      elementId: "checkout_fulfillment",
      checkoutStep,
      metadata: {
        source: fulfillment,
        destination: nextFulfillment
      }
    });
  };

  const handleFieldBlur = (event) => {
    const { name, value } = event.currentTarget;
    const formatted = formatCheckoutInputValue(name, value, { final: true });
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

  const handleSpellingSuggestion = useCallback(
    (name, suggestedValue) => {
      const formatted = formatCheckoutInputValue(name, suggestedValue, { final: true });
      const nextValues = {
        ...formValues,
        [name]: formatted
      };

      setFormValues(nextValues);
      setTouchedFields((prev) => ({
        ...prev,
        [name]: true
      }));
      resetPaymentState();

      if (status !== "idle") {
        setStatus("idle");
        setNotice("");
      }

      setFieldErrors(validateCheckoutForm(nextValues, fulfillment));
    },
    [formValues, fulfillment, resetPaymentState, status, validateCheckoutForm]
  );

  const handleBackToEdit = useCallback(() => {
    if (isOrderFinalizing) return;

    resetPaymentState();
    setStatus("idle");
    setNotice("Review your details, then proceed to payment again.");
  }, [isOrderFinalizing, resetPaymentState]);

  const handleEmailOptInChange = (event) => {
    setEmailOptIn(Boolean(event.currentTarget.checked));
  };

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

  const preparePaymentIntent = useCallback(async (valuesOverride = formValues) => {
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
      const message = "Please check the pre-order notice before payment.";
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
      body: JSON.stringify(buildOrderPayload(valuesOverride))
    });

    const responseContentType = response.headers.get("content-type") || "";
    const result = responseContentType.includes("application/json")
      ? await response.json().catch(() => ({}))
      : {};

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
      throw new Error(result?.error || "We couldn't start payment. Please try again.");
    }

    if (!result?.clientSecret || !result?.paymentIntentId) {
      throw new Error("We couldn't start payment. Please try again.");
    }

    return {
      clientSecret: result.clientSecret,
      paymentIntentId: result.paymentIntentId,
      returnUrl: result.returnUrl,
      subtotalCents: Number(result.subtotalCents || 0),
      totalCents: Number(result.totalCents || 0),
      shipping: result.shipping && typeof result.shipping === "object"
        ? result.shipping
        : null
    };
  }, [
    applyInventory,
    buildOrderPayload,
    focusFirstInvalidField,
    focusPickupAcknowledgement,
    focusPreorderAcknowledgement,
    fulfillment,
    formValues,
    hasPreorderItems,
    pickupAcknowledged,
    preorderAcknowledged
  ]);

  const createPaymentIntent = useCallback(async () => {
    if (!preparedPayment?.clientSecret || !preparedPayment?.paymentIntentId) {
      throw new Error("Your live shipping quote is no longer ready. Please review your details and try again.");
    }
    const quoteExpiresAt = Date.parse(preparedPayment?.shipping?.quoteExpiresAt || "");
    if (Number.isFinite(quoteExpiresAt) && quoteExpiresAt <= Date.now() + 60_000) {
      resetPaymentState();
      throw new Error("Your live shipping quote expired. Please proceed to payment again for a fresh rate.");
    }
    return preparedPayment;
  }, [preparedPayment, resetPaymentState]);

  const handlePaymentState = useCallback(
    ({ status: nextStatus, message, paymentIntentId, sessionId }) => {
      if (nextStatus === "processing") {
        setStatus("submitting");
        setNotice(message || "Processing payment securely...");
        return;
      }

      if (nextStatus === "redirecting") {
        setStatus("submitting");
        setNotice(message || "Finishing secure payment...");
        return;
      }

      if (nextStatus === "ready") {
        setStatus("idle");
        setNotice(message || "");
        return;
      }

      if (nextStatus === "finalizing") {
        const normalizedPaymentIntentId = String(paymentIntentId || "").trim();
        const normalizedSessionId = String(sessionId || "").trim();
        const paymentReference = normalizedSessionId || normalizedPaymentIntentId;
        if (!paymentReference) {
          setStatus("pending_confirmation");
          setNotice(ORDER_FINALIZE_PENDING_NOTICE);
          return;
        }

        if (finalizingPaymentRef.current === paymentReference) {
          return;
        }

        setStatus("finalizing");
        setNotice(message || ORDER_FINALIZE_MESSAGE);
        void finalizePaidOrder(
          normalizedSessionId
            ? { sessionId: normalizedSessionId }
            : { paymentIntentId: normalizedPaymentIntentId }
        );
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
      setNotice(message || "Payment didn't go through. Please check your card and try again.");
    },
    [finalizePaidOrder]
  );

  const handleSubmit = async (event) => {
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
    const finalFormValues = formatFinalCheckoutValues(formValues);
    const hasFinalFormChanges = Object.keys(INITIAL_FORM_VALUES).some(
      (name) => finalFormValues[name] !== formValues[name]
    );

    if (hasFinalFormChanges) {
      setFormValues(finalFormValues);
    }

    const nextErrors = validateCheckoutForm(
      finalFormValues,
      fulfillment,
      selectedShippingOption?.id || shippingOptionId
    );
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
      setNotice("Please fix the highlighted fields before checking out.");
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

    if (typeof window !== "undefined") {
      const formHeight = Math.ceil(event.currentTarget.getBoundingClientRect().height);
      checkoutStepPreviousFormHeightRef.current = formHeight;
      checkoutStepScrollPositionRef.current = {
        x: window.scrollX,
        y: window.scrollY
      };
    }
    setStatus("submitting");
    setNotice(
      fulfillment === "ship"
        ? `Calculating the live ${selectedShippingOption.label} rate and expected arrival date...`
        : "Preparing secure payment..."
    );

    try {
      const nextPreparedPayment = await preparePaymentIntent(finalFormValues);
      setPreparedPayment(nextPreparedPayment);
      trackAnalyticsEvent({
        name: "checkout_submit",
        sectionId: "shop",
        elementId: "checkout_submit",
        checkoutStep: "details",
        metadata: {
          itemCount,
          subtotalCents: Number(nextPreparedPayment.subtotalCents || subtotal),
          shippingCents: Number(nextPreparedPayment.shipping?.amountCents || 0),
          totalCents: Number(nextPreparedPayment.totalCents || subtotal),
          preorderUnits: preorderUnitsInCart,
          emailOptIn
        }
      });
      setCheckoutStep("payment");
      setStatus("idle");
      setNotice("");
    } catch (error) {
      setPreparedPayment(null);
      setStatus("error");
      setNotice(error?.message || "We couldn't prepare payment. Please try again.");
    }
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
            View Pickup Instructions & Policy
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
          <span>{preorderAcknowledgementLabel}</span>
        </label>
        <p className="preorder-acknowledgement__notice">{preorderTimingNotice}</p>
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

  const renderShippingScheduleNotice = ({ id = "cart", showShipDate = false } = {}) => {
    if (fulfillment !== "ship") return null;
    const safeId = sanitizeFieldName(id);
    const scheduleId = `shipping-schedule-${safeId}`;
    const scheduleButtonId = `${scheduleId}-toggle`;
    const isScheduleOpen = Boolean(openShippingSchedules[safeId]);

    return (
      <div className={`shipping-schedule${
        isScheduleOpen ? " shipping-schedule--open" : ""
      }`}>
        <button
          type="button"
          id={scheduleButtonId}
          className="shipping-schedule__toggle"
          aria-expanded={isScheduleOpen}
          aria-controls={scheduleId}
          onClick={() => handleShippingScheduleToggle(safeId)}
        >
          <span>{SHIPPING_SCHEDULE_TITLE}</span>
        </button>
        <div
          id={scheduleId}
          className="shipping-schedule__panel"
          role="region"
          aria-labelledby={scheduleButtonId}
          aria-hidden={!isScheduleOpen}
          ref={(node) => {
            if (node instanceof HTMLElement) {
              shippingSchedulePanelRefs.current[safeId] = node;
              return;
            }

            delete shippingSchedulePanelRefs.current[safeId];
          }}
          style={{
            maxHeight: isScheduleOpen
              ? `${shippingScheduleHeights[safeId] ?? 0}px`
              : "0px"
          }}
        >
          <div className="shipping-schedule__content">
            <p>{SHIPPING_SCHEDULE_INTRO}</p>
            <p>{SHIPPING_SCHEDULE_STANDARD_LINE}</p>
            <p>{SHIPPING_SCHEDULE_EXPEDITED_LINE}</p>
            <p>{SHIPPING_SCHEDULE_EXPEDITED_NOTE}</p>
            {showShipDate && estimatedShipDateText ? (
              <p className="shipping-schedule__ship-date">
                <span>
                  {hasPreorderItems
                    ? "Estimated ship date after preorder window"
                    : "Estimated ship date"}
                </span>
                <strong>{estimatedShipDateText}</strong>
              </p>
            ) : null}
          </div>
        </div>
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
            return (
              <div className="cart__item" key={`${keyPrefix}-${item.sku}`}>
                <div>
                  <strong>{item.name}</strong>
                  <span>Qty: {item.quantity}</span>
                  {shouldDisplayStock && item.hasInventoryRecord && item.preorderUnits > 0 ? (
                    <span className="cart__split">
                      {item.inStockUnits > 0 ? (
                        <>
                          <span>{item.inStockUnits} in stock</span>
                          {" | "}
                        </>
                      ) : null}
                      <span className="cart__preorder-count cart__preorder-count--accent">
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
          {preorderTimingNotice}
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
          <strong>{shippingPriceText}</strong>
        </div>
        {fulfillment === "ship" && selectedExpectedDeliveryText ? (
          <div>
            <span>Expected arrival</span>
            <strong>{selectedExpectedDeliveryText.replace(/^Expected (?:by|arrival:)\s+/i, "")}</strong>
          </div>
        ) : null}
        <div className="cart__summary-total">
          <span>
            {fulfillment === "ship" && !displayedShipping
              ? "Subtotal before shipping"
              : preparedPayment
                ? "Total due today"
                : "Current total"}
          </span>
          <strong>{formatCurrency(orderTotal)}</strong>
        </div>
      </div>
    </>
  );

  const renderShippingOptions = () => {
    if (!SHIPPING_CHECKOUT_VISIBLE || !requiresAddress) return null;
    const normalizedShippingOptionId = normalizeShippingOptionId(shippingOptionId);
    const shippingOptionError = getFieldError("shippingOption");
    const shippingOptionsDescribedBy = [
      "shipping-option-hint",
      shippingOptionError ? "shippingOption-error" : ""
    ].filter(Boolean).join(" ");

    return (
      <fieldset
        ref={setFieldRef("shippingOption")}
        className={`shipping-options${
          shippingOptionError ? " shipping-options--error" : ""
        }`}
        aria-describedby={shippingOptionsDescribedBy}
        tabIndex={-1}
      >
        <legend>Shipping</legend>
        <p id="shipping-option-hint" className="shipping-options__hint">
          Shipping is available across the {CONTINENTAL_US_SHIPPING_AREA_LABEL}.
          Choose Normal for a 3–5-business-day carrier estimate or Expedited for a
          1–3-business-day estimate. EasyPost selects the fastest eligible carrier rate inside
          your chosen window; Normal rates estimated under three days are excluded. You will
          see the final shipping charge and expected arrival date before payment.
        </p>
        {renderShippingScheduleNotice({ id: "checkout", showShipDate: true })}
        <div className="shipping-options__list">
          {customerShippingOptions.map((option) => {
            const isSelected = option.id === normalizedShippingOptionId;
            const inputId = `shipping-option-${option.id}`;
            const renderedOption = isSelected ? selectedShippingOption : option;
            const expectedDeliveryText = isSelected && selectedExpectedDeliveryText
              ? selectedExpectedDeliveryText
              : getExpectedDeliveryText({
                  shippingOption: renderedOption,
                  hasPreorderItems,
                  orderDate: shippingScheduleNow
                });

            return (
              <label
                key={option.id}
                htmlFor={inputId}
                className={`shipping-option${
                  isSelected ? " shipping-option--selected" : ""
                }`}
              >
                <input
                  id={inputId}
                  type="radio"
                  name="shippingOption"
                  value={option.id}
                  checked={isSelected}
                  onChange={handleShippingOptionChange}
                />
                <span className="shipping-option__body">
                  <span className="shipping-option__topline">
                    <strong>{option.label}</strong>
                    <span>{isSelected ? shippingPriceText : "Calculated from address"}</span>
                  </span>
                  <span className="shipping-option__meta">
                    <span>
                      {renderedOption.transitLabel}
                      {renderedOption.note ? ` | ${renderedOption.note}` : ""}
                    </span>
                    {expectedDeliveryText ? <span>{expectedDeliveryText}</span> : null}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
        {shippingPreviewStatus === "error" && shippingPreviewError ? (
          <span className="form-field__error" role="alert">
            {shippingPreviewError}
          </span>
        ) : null}
        {shippingOptionError ? (
          <span id="shippingOption-error" className="form-field__error" role="alert">
            {shippingOptionError}
          </span>
        ) : null}
      </fieldset>
    );
  };

  const summarizeValue = (value, fallback = "N/A") => {
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

    const lines = [lineOne, lineTwo, SHIPPING_COUNTRY_LABEL].filter(Boolean);
    return lines.length > 0 ? lines : ["N/A"];
  }, [formValues.address1, formValues.address2, formValues.city, formValues.postalCode, formValues.state]);

  const reviewFields = [
    { label: "Name", value: summarizeValue(formValues.name) },
    { label: "Email", value: summarizeValue(formValues.email) },
    { label: "Phone", value: summarizeValue(formValues.phone) },
    {
      label: "Fulfillment",
      value:
        fulfillment === "ship"
          ? "Ship or deliver"
          : MARKET_PICKUP_LABEL
    },
    ...(fulfillment === "ship"
      ? [
          {
            label: "Address",
            value: shippingAddressLines
          },
          {
            label: "Shipping method",
            value: selectedShippingOption.label
          },
          {
            label: "Shipping timing",
            value: estimatedShipDateText
              ? `Packed and shipped on ${estimatedShipDateText}`
              : selectedShippingOption.transitLabel
          },
          ...(selectedExpectedDeliveryText
            ? [
                {
                  label: "Expected arrival",
                  value: selectedExpectedDeliveryText.replace(/^Expected (?:by|arrival:)\s+/i, "")
                }
              ]
            : [])
        ]
      : []),
    { label: "Order note", value: summarizeValue(formValues.note) }
  ];

  return (
    <>
      {showOrderSuccessPopup ? (
        <div className="order-success-overlay">
          <div
            key={orderSuccessPopupKey}
            className="order-success-popup"
            role="dialog"
            aria-modal="true"
            aria-labelledby="order-success-popup-title"
            ref={orderSuccessDialogRef}
            tabIndex={-1}
          >
            <button
              type="button"
              className="order-success-popup__close"
              aria-label="Close order confirmation"
              onClick={() => closeOrderSuccessPopup("close_button")}
            >
              x
            </button>
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
            <h4 id="order-success-popup-title">Thank you for your order!</h4>
            <p>{orderSuccessPopupMessage}</p>
            {orderSuccessContext?.fulfillment === "market" ? (
              <div className="order-success-popup__summary" aria-label="Pickup details">
                <div className="order-success-popup__summary-header">
                  <span>
                    {orderSuccessContext.pickupScenario === "preorder_only"
                      ? "Preorder Follow-up"
                      : orderSuccessContext.pickupScenario === "mixed"
                        ? "Pickup And Preorder"
                        : "Pickup Details"}
                  </span>
                  {orderSuccessContext.pickupScenario !== "preorder_only" ? (
                    <strong>{orderSuccessContext.pickupDateLabel || "Next Market"}</strong>
                  ) : null}
                </div>
                <dl className="order-success-popup__details">
                  {orderSuccessContext.pickupScenario !== "preorder_only" ? (
                    <div>
                      <dt>Window</dt>
                      <dd>{orderSuccessContext.pickupWindow}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Market</dt>
                    <dd>{orderSuccessContext.marketName}</dd>
                  </div>
                  <div>
                    <dt>Address</dt>
                    <dd>{orderSuccessContext.marketAddress}</dd>
                  </div>
                </dl>
                <p className="order-success-popup__instruction">
                  {orderSuccessContext.pickupScenario === "preorder_only"
                    ? "We will email you when the preorder is ready and confirm the pickup date before you come to market."
                    : orderSuccessContext.pickupScenario === "mixed"
                      ? "Pick up ready items on the date above. Preorder items will be scheduled separately by email when restocked."
                      : "At pickup, give the name or email used at checkout at the Vida Verde booth."}
                </p>
              </div>
            ) : orderSuccessContext?.fulfillment === "ship" ? (
              <div className="order-success-popup__summary" aria-label="Shipping details">
                <div className="order-success-popup__summary-header">
                  <span>Shipping</span>
                  <strong>{orderSuccessContext.shippingOptionLabel || "Tracking By Email"}</strong>
                </div>
                <p className="order-success-popup__instruction">
                  {orderSuccessContext.preorderUnits > 0
                    ? "Preorder items ship after they are ready, which may take up to 15 days. The selected shipping timing starts after that ready date. "
                    : orderSuccessContext.shippingShipDateLabel
                      ? `Estimated ship date: ${orderSuccessContext.shippingShipDateLabel}. `
                      : ""}
                  {orderSuccessContext.preorderUnits <= 0 && orderSuccessContext.shippingTransitLabel
                    ? `${orderSuccessContext.shippingTransitLabel} `
                    : orderSuccessContext.shippingTransitLabel
                      ? `${orderSuccessContext.shippingTransitLabel} `
                      : ""}
                  We will email tracking or delivery updates when available. Open and inspect the package when it arrives, and refrigerate after opening.
                </p>
              </div>
            ) : null}
            <div className="order-success-popup__aftercare">
              <div className="order-success-popup__contact" aria-label="Order support">
                <span className="order-success-popup__contact-title">
                  Need help with your order?
                </span>
                <div className="order-success-popup__contact-links">
                  <span>
                    Email{" "}
                    <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
                  </span>
                  <span>
                    Call/text{" "}
                    <a href={`tel:${SUPPORT_PHONE_E164}`}>{SUPPORT_PHONE_DISPLAY}</a>
                  </span>
                </div>
              </div>
            </div>
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
          <strong className="cart-drawer-toggle__subtotal">{formatCurrency(orderTotal)}</strong>
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
            const hasProductPhoto =
              typeof product.image === "string" && product.image.startsWith("/product-photos/");

            return (
              <article
                className="product-card"
                key={product.sku}
                data-analytics-id={`product_card_${product.sku.toLowerCase()}`}
                data-analytics-product-sku={product.sku}
                data-analytics-hover="true"
              >
                {hasProductPhoto ? (
                  <div className="product-card__media">
                    <Image
                      src={product.image}
                      alt={`${product.name} product photo`}
                      fill
                      sizes="(max-width: 720px) 100vw, (max-width: 1080px) 50vw, 360px"
                      className="product-card__image"
                    />
                  </div>
                ) : (
                  <div className="product-card__placeholder" aria-hidden="true">
                    <span>Photos Coming Soon</span>
                  </div>
                )}
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
                          {cartPreorderUnits > 0 ? ` (preorder)` : ""}
                        </span>
                      </div>
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
            ref={checkoutFormRef}
            className="order-form store__checkout"
            onSubmit={handleSubmit}
            onFocusCapture={handleAnalyticsFieldFocus}
            noValidate
          >
            <h3>{isPaymentStep ? "Review & Pay" : "Complete Your Order"}</h3>
            <p>
              {hasPreorderItems
                ? `Pre-order notice: ${preorderTimingNotice}`
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
                    {SHIPPING_CHECKOUT_VISIBLE ? (
                      <>
                        <div className="select-wrap">
                          <select
                            ref={setFieldRef("fulfillment")}
                            name="fulfillment"
                            value={fulfillment}
                            onChange={handleFulfillmentChange}
                            required
                          >
                            <option value="ship">Ship or deliver</option>
                            <option value="market">{MARKET_PICKUP_LABEL}</option>
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
                      </>
                    ) : (
                      <div
                        ref={setFieldRef("fulfillment")}
                        className="form-field__readonly"
                      >
                        {MARKET_PICKUP_LABEL}
                      </div>
                    )}
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
                      <label className={`form-field${hasFieldError("city") ? " form-field--error" : ""}`}>
                        City *
                        <input
                          ref={setFieldRef("city")}
                          type="text"
                          name="city"
                          value={formValues.city}
                          placeholder="Enter city"
                          autoComplete="address-level2"
                          autoCapitalize="words"
                          maxLength={120}
                          onChange={handleFieldChange}
                          onBlur={handleFieldBlur}
                          aria-invalid={hasFieldError("city")}
                          aria-describedby={[
                            hasFieldError("city") ? "city-error" : "",
                            citySpellingSuggestion ? "city-suggestion" : ""
                          ].filter(Boolean).join(" ") || undefined}
                          required
                        />
                        {hasFieldError("city") ? (
                          <span id="city-error" className="form-field__error" role="alert">
                            {getFieldError("city")}
                          </span>
                        ) : null}
                        {citySpellingSuggestion ? (
                          <span id="city-suggestion" className="form-field__suggestion">
                            Did you mean{" "}
                            <button
                              type="button"
                              className="form-field__suggestion-button"
                              onClick={() => handleSpellingSuggestion("city", citySpellingSuggestion)}
                            >
                              {citySpellingSuggestion}
                            </button>
                            ?
                          </span>
                        ) : null}
                      </label>
                      <label className={`form-field${hasFieldError("state") ? " form-field--error" : ""}`}>
                        State *
                        <input
                          ref={setFieldRef("state")}
                          type="text"
                          name="state"
                          value={formValues.state}
                          placeholder="Enter state"
                          autoComplete="address-level1"
                          autoCapitalize="words"
                          maxLength={32}
                          onChange={handleFieldChange}
                          onBlur={handleFieldBlur}
                          aria-invalid={hasFieldError("state")}
                          aria-describedby={[
                            hasFieldError("state") ? "state-error" : "",
                            stateSpellingSuggestion ? "state-suggestion" : ""
                          ].filter(Boolean).join(" ") || undefined}
                          required
                        />
                        {hasFieldError("state") ? (
                          <span id="state-error" className="form-field__error" role="alert">
                            {getFieldError("state")}
                          </span>
                        ) : null}
                        {stateSpellingSuggestion ? (
                          <span id="state-suggestion" className="form-field__suggestion">
                            Did you mean{" "}
                            <button
                              type="button"
                              className="form-field__suggestion-button"
                              onClick={() => handleSpellingSuggestion("state", stateSpellingSuggestion)}
                            >
                              {stateSpellingSuggestion}
                            </button>
                            ?
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
                    {renderShippingOptions()}
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

                <label className="checkout-email-opt-in">
                  <input
                    type="checkbox"
                    checked={emailOptIn}
                    onChange={handleEmailOptInChange}
                    data-analytics-id="checkout_email_opt_in"
                  />
                  <span>
                    Add me to the Vida Verde email list for exclusive offers,
                    limited-time deals, and announcements.
                  </span>
                </label>

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
                          <div
                            key={`review-field-${field.label}`}
                            className={`checkout-review__field checkout-review__field--${sanitizeFieldName(field.label)}`}
                          >
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
                      : fulfillment === "ship"
                        ? `Card details are entered in Stripe secure fields and never stored on our servers. Your card will be charged ${formatCurrency(orderTotal)} today for this shipping order.`
                        : `Card details are entered in Stripe secure fields and never stored on our servers. Your card will be charged ${formatCurrency(orderTotal)} today for this market pickup order.`}
                  </p>
                  <StripePaymentPanel
                    onPaymentState={handlePaymentState}
                    grossTotalCents={orderTotal}
                    billingDetails={formValues}
                    createPaymentIntent={createPaymentIntent}
                    isLocked={isOrderFinalizing}
                  />
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
                <p className="pickup-policy-modal__eyebrow">
                  {fulfillment === "ship" ? "Shipping Instructions" : "Pickup Instructions"}
                </p>
                <h3 id="pickup-policy-modal-title">
                  {fulfillment === "ship"
                    ? "Confirm delivery details before payment"
                    : "Confirm pickup details before payment"}
                </h3>
                <p id="pickup-policy-modal-intro" className="pickup-policy-modal__intro">
                  {fulfillment === "ship"
                    ? "Review where this order will go, what happens after payment, and the total charged today."
                    : "Review when and where to pick up, what to do at the booth, and what happens if any item is a preorder."}
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

            <div className="pickup-policy-modal__body">
              <section className="pickup-policy-modal__summary" aria-label="Fulfillment summary">
                {fulfillment === "ship" ? (
                  <>
                    <article>
                      <span>Fulfillment</span>
                      <strong>Shipping</strong>
                    </article>
                    <article>
                      <span>Ship To</span>
                      <strong>
                        {shippingAddressLines.map((line) => (
                          <span key={line}>{line}</span>
                        ))}
                      </strong>
                    </article>
                    <article>
                      <span>Method</span>
                      <strong>
                        {selectedShippingOption.label}
                        <span>{shippingPriceText}</span>
                      </strong>
                    </article>
                    {estimatedShipDateText ? (
                      <article>
                        <span>
                          {hasPreorderItems
                            ? "Estimated Ship Date After Preorder Window"
                            : "Estimated Ship Date"}
                        </span>
                        <strong>{estimatedShipDateText}</strong>
                      </article>
                    ) : null}
                  </>
                ) : (
                  <>
                    <article>
                      <span>Pickup Date</span>
                      <strong>
                        {pickupScenario === "preorder_only"
                          ? "Scheduled after restock"
                          : checkoutPickupDetails.market_date_label || "Next available Saturday"}
                      </strong>
                    </article>
                    <article>
                      <span>Window</span>
                      <strong>{checkoutPickupDetails.pickup_window}</strong>
                    </article>
                    <article>
                      <span>Location</span>
                      <strong>
                        {checkoutPickupDetails.market_name}
                        <span>{checkoutPickupDetails.market_address}</span>
                      </strong>
                    </article>
                  </>
                )}
              </section>

              <section className="pickup-policy-modal__section">
                <div className="pickup-policy-modal__section-heading">
                  <span>{fulfillment === "ship" ? "Shipping Steps" : "How Pickup Works"}</span>
                </div>
                {fulfillment === "ship" ? (
                  <ul className="pickup-policy-modal__steps">
                    <li>Packages are taken to shipping carriers once a week, every Wednesday, after packing or production is complete.</li>
                    <li>Shipping time starts only after the carrier receives the package.</li>
                    <li>Normal Shipping uses the fastest eligible 3–5-business-day EasyPost rate and excludes rates estimated under three days.</li>
                    <li>Expedited Shipping uses the fastest eligible 1–3-business-day EasyPost rate.</li>
                    <li>Your shipping charge is postage plus packaging, rounded up to the nearest dollar.</li>
                    <li>Tracking or delivery updates will be emailed when available.</li>
                    <li>Open and inspect the package when it arrives.</li>
                    <li>Refrigerate after opening.</li>
                  </ul>
                ) : (
                  <ul className="pickup-policy-modal__steps">
                    <li>Find the Vida Verde booth at {checkoutPickupDetails.market_name}.</li>
                    <li>Give the name or email used at checkout.</li>
                    <li>Pick up during the {checkoutPickupDetails.pickup_window} market window.</li>
                    <li>If you may be late or need a change, text {SUPPORT_PHONE_DISPLAY} as soon as possible.</li>
                  </ul>
                )}
                {fulfillment !== "ship" ? (
                  <div className="pickup-policy-modal__actions">
                    <a href={pickupMapUrl} target="_blank" rel="noreferrer">
                      Open Map
                    </a>
                    <a href={supportSmsHref}>Text Us</a>
                  </div>
                ) : null}
              </section>

              {hasPreorderItems ? (
                <section className="pickup-policy-modal__section pickup-policy-modal__section--notice">
                  <div className="pickup-policy-modal__section-heading">
                    <span>
                      {fulfillment === "ship"
                        ? "Preorder Shipping Timing"
                        : pickupScenario === "mixed"
                        ? "Ready Items And Preorders"
                        : "Preorder Timing"}
                    </span>
                  </div>
                  <p>
                    {fulfillment === "ship"
                      ? "Preorder items cannot be shipped until they are ready, which can take up to 15 days. They will be included in the next Wednesday carrier handoff, and transit time begins after the carrier receives the package."
                      : pickupScenario === "mixed"
                      ? "Ready items can be picked up on the date above. Preorder items will be scheduled separately when restocked, and we will email you before that pickup."
                      : "This order contains preorder items. We will email you when they are ready and confirm the pickup date before you come to market."}
                  </p>
                </section>
              ) : null}

              <section className="pickup-policy-modal__section pickup-policy-modal__payment" aria-label="Payment review">
                <div className="pickup-policy-modal__section-heading">
                  <span>Payment Review</span>
                </div>
                <dl>
                  <div>
                    <dt>Items</dt>
                    <dd>{formatCurrency(subtotal)}</dd>
                  </div>
                  <div>
                    <dt>Tax</dt>
                    <dd>$0.00</dd>
                  </div>
                  {fulfillment === "ship" ? (
                    <div>
                      <dt>Shipping</dt>
                      <dd>{shippingPriceText}</dd>
                    </div>
                  ) : (
                    <div>
                      <dt>Shipping</dt>
                      <dd>$0.00</dd>
                    </div>
                  )}
                  {fulfillment === "ship" ? (
                    <div>
                      <dt>Method</dt>
                      <dd>{selectedShippingOption.label}</dd>
                    </div>
                  ) : null}
                  {fulfillment === "ship" ? (
                    <div>
                      <dt>Shipping timing</dt>
                      <dd>{selectedShippingOption.transitLabel}</dd>
                    </div>
                  ) : null}
                  {fulfillment === "ship" && estimatedShipDateText ? (
                    <div>
                      <dt>
                        {hasPreorderItems
                          ? "Estimated ship date after preorder window"
                          : "Estimated ship date"}
                      </dt>
                      <dd>{estimatedShipDateText}</dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>Total charged today</dt>
                    <dd>{formatCurrency(orderTotal)}</dd>
                  </div>
                </dl>
                <p>
                  {fulfillment === "ship"
                    ? "The displayed shipping charge is the reserved live postage plus packaging total, rounded up to the nearest dollar."
                    : "Pickup orders have no shipping charge. Your card will be charged today to reserve available inventory and preorder items."}
                </p>
              </section>

              <section className="pickup-policy-modal__section">
                <div className="pickup-policy-modal__section-heading">
                  <span>Pickup Policy</span>
                </div>
                <div className="pickup-policy-modal__grid">
                  {MARKET_PICKUP_POLICY_ITEMS.map((item) => (
                    <article key={item.label} className="pickup-policy-modal__item">
                      <strong>{item.label}</strong>
                      <p>{item.body}</p>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  );
}
