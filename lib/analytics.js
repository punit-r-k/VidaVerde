export const ANALYTICS_CLIENT_EVENT = "vidaverde:analytics-track";

export const ANALYTICS_EVENT_NAMES = [
  "page_view",
  "page_engagement",
  "scroll_depth_reached",
  "section_view",
  "section_engagement",
  "section_skip",
  "hover_intent",
  "cta_click",
  "nav_click",
  "product_card_view",
  "product_add_to_cart",
  "cart_quantity_change",
  "cart_cleared",
  "cart_summary_view",
  "checkout_jump_mobile",
  "checkout_started",
  "checkout_step_changed",
  "checkout_field_focus",
  "checkout_field_blur",
  "checkout_field_error",
  "checkout_submit",
  "checkout_validation_blocked",
  "checkout_preorder_ack_toggled",
  "checkout_review_toggle",
  "payment_submit",
  "payment_result",
  "order_success_popup_view",
  "email_popup_open",
  "email_popup_dismiss",
  "email_popup_submit",
  "email_popup_result",
  "email_signup_focus",
  "email_signup_submit",
  "email_signup_result",
  "testimonial_card_view",
  "testimonial_open",
  "testimonial_nav",
  "testimonial_carousel_scroll",
  "faq_toggle"
];

export const ANALYTICS_CHECKOUT_STEPS = ["details", "payment"];
export const ANALYTICS_SCROLL_MILESTONES = [25, 50, 75, 90, 100];
export const ANALYTICS_IDLE_WINDOW_MS = 30_000;
export const ANALYTICS_SKIP_THRESHOLD_MS = 1_500;
export const ANALYTICS_HOVER_INTENT_MS = 600;
export const ANALYTICS_BATCH_FLUSH_MS = 5_000;
export const ANALYTICS_MAX_BATCH_SIZE = 25;
export const ANALYTICS_MAX_PAYLOAD_BYTES = 28_000;
export const ANALYTICS_MAX_METADATA_KEYS = 18;
export const ANALYTICS_MAX_EVENT_AGE_MS = 24 * 60 * 60 * 1000;
export const ANALYTICS_MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export const ANALYTICS_METADATA_KEYS = new Set([
  "scrollPct",
  "viewport",
  "dwellMs",
  "maxVisibilityRatio",
  "clickCount",
  "engagedMs",
  "idleMs",
  "maxScrollPct",
  "timeSinceLastClickMs",
  "viewedSectionCount",
  "itemCount",
  "cartCount",
  "subtotalCents",
  "quantity",
  "nextQuantity",
  "previousQuantity",
  "preorderUnits",
  "reason",
  "result",
  "fieldName",
  "validationCount",
  "direction",
  "currentIndex",
  "targetIndex",
  "open",
  "source",
  "wasAutoScroll",
  "deepestSectionId",
  "lastClickedSectionId",
  "lastClickedElementId",
  "pageType",
  "hoverMs",
  "impressionIndex",
  "errorCode"
]);

const EVENT_NAME_SET = new Set(ANALYTICS_EVENT_NAMES);
const CHECKOUT_STEP_SET = new Set(ANALYTICS_CHECKOUT_STEPS);
const IDENTIFIER_PATTERN = /[^a-z0-9:_/-]+/g;
const COLLAPSE_SEPARATOR_PATTERN = /[_/-]{2,}/g;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const CARD_LIKE_PATTERN = /\b(?:\d[ -]*?){13,19}\b/;
const SECRET_LIKE_PATTERN =
  /\b(?:sk_(?:live|test)_[A-Za-z0-9]+|pk_(?:live|test)_[A-Za-z0-9]+|whsec_[A-Za-z0-9]+|gh[pousr]_[A-Za-z0-9_]+|xox[baprs]-[A-Za-z0-9-]+|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/;
const SENSITIVE_KEY_PATTERN =
  /(email|phone|address|postal|zip|city|state|name|note|message|card|secret|token|key|auth|pass|cookie|user[_-]?agent|ip)/i;
const SAFE_QUERY_PARAM_PATTERN =
  /^(utm_(source|medium|campaign|term|content)|gclid|fbclid|ref|campaign|variant)$/i;

const clampNumber = (value, max = 1_000_000_000) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n > max) return max;
  if (n < -max) return -max;
  return n;
};

const toCleanString = (value, maxLength = 120) => {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.replace(/\s+/g, " ").slice(0, maxLength);
};

export const sanitizeAnalyticsIdentifier = (value, maxLength = 80) => {
  const text = toCleanString(value, maxLength)
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(IDENTIFIER_PATTERN, "_")
    .replace(COLLAPSE_SEPARATOR_PATTERN, "_")
    .replace(/^[_/-]+|[_/-]+$/g, "");

  return text.slice(0, maxLength);
};

export const sanitizeAnalyticsPath = (value, maxLength = 240) => {
  const text = toCleanString(value, maxLength);
  if (!text) return "";
  return text.slice(0, maxLength);
};

export const sanitizeAnalyticsSearch = (value, maxLength = 240) => {
  const text = toCleanString(value, maxLength);
  if (!text) return "";

  const normalized = text.startsWith("?") ? text.slice(1) : text;
  const params = new URLSearchParams(normalized);
  const safeParams = new URLSearchParams();

  params.forEach((paramValue, key) => {
    if (!SAFE_QUERY_PARAM_PATTERN.test(key)) return;
    if (looksSensitiveString(paramValue)) return;
    safeParams.set(key, toCleanString(paramValue, 80));
  });

  const safeQuery = safeParams.toString();
  return safeQuery ? `?${safeQuery}`.slice(0, maxLength) : "";
};

const looksSensitiveString = (value) => {
  const text = String(value || "");
  if (!text) return false;

  return (
    EMAIL_PATTERN.test(text) ||
    CARD_LIKE_PATTERN.test(text) ||
    SECRET_LIKE_PATTERN.test(text)
  );
};

const sanitizeMetadataValue = (key, value) => {
  if (typeof value === "boolean") return value;

  if (typeof value === "number") {
    return clampNumber(value);
  }

  if (value === null) return null;

  if (typeof value !== "string") return null;
  if (SENSITIVE_KEY_PATTERN.test(key)) return null;

  const text = toCleanString(value, 120);
  if (!text || looksSensitiveString(text)) return null;

  if (
    key.endsWith("Id") ||
    key === "fieldName" ||
    key === "reason" ||
    key === "result" ||
    key === "direction" ||
    key === "viewport" ||
    key === "source" ||
    key === "pageType" ||
    key === "errorCode"
  ) {
    return sanitizeAnalyticsIdentifier(text, 80);
  }

  return text;
};

export const sanitizeAnalyticsMetadata = (metadata) => {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return {};
  }

  const entries = Object.entries(metadata)
    .filter(([key]) => ANALYTICS_METADATA_KEYS.has(key) && !SENSITIVE_KEY_PATTERN.test(key))
    .slice(0, ANALYTICS_MAX_METADATA_KEYS);

  return entries.reduce((acc, [key, value]) => {
    const sanitizedValue = sanitizeMetadataValue(key, value);
    if (
      sanitizedValue === null ||
      sanitizedValue === undefined ||
      sanitizedValue === ""
    ) {
      return acc;
    }

    acc[key] = sanitizedValue;
    return acc;
  }, {});
};

export const sanitizeAnalyticsEvent = (event) => {
  if (!event || typeof event !== "object") return null;

  const eventName = String(event.name || "").trim();
  if (!EVENT_NAME_SET.has(eventName)) return null;

  const visitorId = sanitizeAnalyticsIdentifier(event.visitorId, 80);
  const sessionId = sanitizeAnalyticsIdentifier(event.sessionId, 80);
  const pageViewId = sanitizeAnalyticsIdentifier(event.pageViewId, 80);
  const pagePath = sanitizeAnalyticsPath(event.pagePath, 240);
  const pageSearch = sanitizeAnalyticsSearch(event.pageSearch, 240);
  const referrerPath = sanitizeAnalyticsPath(event.referrerPath, 240);
  const sectionId = sanitizeAnalyticsIdentifier(event.sectionId, 80);
  const elementId = sanitizeAnalyticsIdentifier(event.elementId, 80);
  const productSku = sanitizeAnalyticsIdentifier(event.productSku, 32).toUpperCase();
  const checkoutStep = sanitizeAnalyticsIdentifier(event.checkoutStep, 32);
  const occurredAt = toCleanString(event.occurredAt, 64);

  if (!visitorId || !sessionId || !pageViewId || !pagePath) {
    return null;
  }

  if (checkoutStep && !CHECKOUT_STEP_SET.has(checkoutStep)) {
    return null;
  }

  return {
    name: eventName,
    occurredAt,
    visitorId,
    sessionId,
    pageViewId,
    pagePath,
    pageSearch,
    referrerPath,
    sectionId: sectionId || null,
    elementId: elementId || null,
    productSku: productSku || null,
    checkoutStep: checkoutStep || null,
    metadata: sanitizeAnalyticsMetadata(event.metadata)
  };
};

export const normalizeAnalyticsOccurredAt = (
  occurredAt,
  now = Date.now()
) => {
  const parsed = occurredAt ? Date.parse(occurredAt) : NaN;
  if (!Number.isFinite(parsed)) {
    return new Date(now).toISOString();
  }

  if (parsed > now + ANALYTICS_MAX_CLOCK_SKEW_MS) {
    return null;
  }

  if (parsed < now - ANALYTICS_MAX_EVENT_AGE_MS) {
    return null;
  }

  return new Date(parsed).toISOString();
};

export const toAnalyticsInsertRow = (event) => ({
  event_name: event.name,
  occurred_at: event.occurredAt,
  visitor_id: event.visitorId,
  session_id: event.sessionId,
  page_view_id: event.pageViewId,
  page_path: event.pagePath,
  page_search: event.pageSearch || null,
  referrer_path: event.referrerPath || null,
  section_id: event.sectionId || null,
  element_id: event.elementId || null,
  product_sku: event.productSku || null,
  checkout_step: event.checkoutStep || null,
  metadata: event.metadata || {}
});

export const trackAnalyticsEvent = (event) => {
  if (typeof window === "undefined") return false;

  window.dispatchEvent(
    new CustomEvent(ANALYTICS_CLIENT_EVENT, {
      detail: event
    })
  );

  return true;
};
