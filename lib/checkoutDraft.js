export const CHECKOUT_DRAFT_STORAGE_KEY = "vidaverde-checkout-draft-v1";
export const CHECKOUT_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

const FORM_FIELD_LIMITS = Object.freeze({
  name: 120,
  email: 320,
  phone: 40,
  address1: 200,
  address2: 200,
  city: 120,
  state: 40,
  postalCode: 20,
  note: 2_000
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;

const boundedText = (value, maximumLength) =>
  String(value ?? "").slice(0, maximumLength);

const normalizeFulfillment = (value) => value === "market" ? "market" : "ship";
const normalizeShippingOptionId = (value) =>
  value === "expedited" ? "expedited" : "normal";

const sanitizeDeliveryBoundary = (value) => {
  const count = Number(value?.value);
  const unit = String(value?.unit || "").trim();
  if (!Number.isInteger(count) || count < 0 || count > 365 || !unit) return null;
  return { unit: boundedText(unit, 32), value: count };
};

const sanitizeDeliveryEstimate = (value) => {
  const minimum = sanitizeDeliveryBoundary(value?.minimum);
  const maximum = sanitizeDeliveryBoundary(value?.maximum);
  return minimum && maximum ? { minimum, maximum } : undefined;
};

const sanitizeDateKey = (value) => {
  const dateKey = String(value || "").trim();
  return DATE_KEY_PATTERN.test(dateKey) ? dateKey : "";
};

const sanitizeShippingOption = (value, nowMs) => {
  const quoteToken = String(value?.quoteToken || "").trim();
  const expiresAt = String(value?.expiresAt || "").trim();
  const expirationMs = Date.parse(expiresAt);
  const amountCents = Number(value?.amountCents);
  const id = normalizeShippingOptionId(value?.id);

  if (
    !UUID_PATTERN.test(quoteToken) ||
    !Number.isInteger(amountCents) ||
    amountCents <= 0 ||
    !Number.isFinite(expirationMs) ||
    expirationMs <= nowMs
  ) {
    return null;
  }

  return {
    quoteToken,
    id,
    label: boundedText(value?.label, 100),
    amountCents,
    transitLabel: boundedText(value?.transitLabel, 300),
    deliveryEstimate: sanitizeDeliveryEstimate(value?.deliveryEstimate),
    estimatedShipDate: sanitizeDateKey(value?.estimatedShipDate),
    estimatedShipDateLabel: boundedText(value?.estimatedShipDateLabel, 100),
    expectedArrivalDate: sanitizeDateKey(value?.expectedArrivalDate),
    expectedArrivalLabel: boundedText(value?.expectedArrivalLabel, 100),
    expiresAt: new Date(expirationMs).toISOString()
  };
};

export const sanitizeStoredShippingPreview = (value, { now = Date.now() } = {}) => {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const requestFingerprint = String(value?.requestFingerprint || "");
  if (
    !Number.isFinite(nowMs) ||
    !requestFingerprint ||
    requestFingerprint.length > 20_000
  ) {
    return null;
  }

  const options = (Array.isArray(value?.options) ? value.options : [])
    .map((option) => sanitizeShippingOption(option, nowMs))
    .filter(Boolean);
  if (options.length === 0) return null;

  const quoteToken = options[0].quoteToken;
  const expiresAt = options[0].expiresAt;
  if (options.some((option) =>
    option.quoteToken !== quoteToken || option.expiresAt !== expiresAt
  )) {
    return null;
  }

  return { requestFingerprint, options };
};

export const getStoredShippingPreviewExpiration = (preview) => {
  const expirations = (Array.isArray(preview?.options) ? preview.options : [])
    .map((option) => Date.parse(String(option?.expiresAt || "")))
    .filter(Number.isFinite);
  return expirations.length > 0 ? Math.min(...expirations) : null;
};

export const sanitizeCheckoutDraft = (value, { now = Date.now() } = {}) => {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const savedAt = Number(value?.savedAt);
  if (
    value?.version !== 1 ||
    !Number.isFinite(nowMs) ||
    !Number.isFinite(savedAt) ||
    savedAt > nowMs + 5 * 60 * 1000 ||
    nowMs - savedAt > CHECKOUT_DRAFT_TTL_MS
  ) {
    return null;
  }

  const formValues = Object.entries(FORM_FIELD_LIMITS).reduce((result, [name, limit]) => {
    result[name] = boundedText(value?.formValues?.[name], limit);
    return result;
  }, {});
  const checkoutSessionToken = String(value?.checkoutSessionToken || "").trim();

  return {
    version: 1,
    savedAt,
    checkoutSessionToken: UUID_PATTERN.test(checkoutSessionToken)
      ? checkoutSessionToken
      : "",
    formValues,
    fulfillment: normalizeFulfillment(value?.fulfillment),
    shippingOptionId: normalizeShippingOptionId(value?.shippingOptionId),
    shippingPreview: sanitizeStoredShippingPreview(value?.shippingPreview, { now: nowMs })
  };
};
