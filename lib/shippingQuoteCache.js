import crypto from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin.js";

export const CHECKOUT_SHIPPING_QUOTE_TTL_MS = 45 * 60 * 1000;
export const NEW_QUOTES_PER_SESSION_WINDOW = 2;
export const NEW_QUOTES_WINDOW_MS = 10 * 60 * 1000;

const normalizeText = (value) => String(value || "").trim().replace(/\s+/g, " ");
const normalizeInt = (value) => Math.max(0, Number.parseInt(value, 10) || 0);
const envInt = (name, fallback, environment = process.env) => {
  const rawValue = String(environment[name] ?? "").trim();
  const value = Number(rawValue);
  if (/^\d+$/u.test(rawValue) && Number.isSafeInteger(value)) return value;
  if (environment.NODE_ENV === "production") {
    throw new Error(`${name} must be configured as a non-negative integer in production.`);
  }
  return fallback;
};

const stableSort = (value) => {
  if (Array.isArray(value)) return value.map(stableSort);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, stableSort(value[key])])
  );
};

const getFingerprintSecret = () => {
  const secret = String(
    process.env.SHIPPING_QUOTE_HMAC_SECRET ||
    process.env.RATE_LIMIT_KEY_SECRET ||
    process.env.ADMIN_JWT_SECRET ||
    ""
  );
  if (process.env.NODE_ENV === "production" && Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Shipping quote fingerprinting is not safely configured.");
  }
  return secret || "local-shipping-quote-test-secret";
};

export const normalizeQuoteAddress = (customer = {}) => ({
  address1: normalizeText(customer.address1).toLowerCase(),
  address2: normalizeText(customer.address2).toLowerCase(),
  city: normalizeText(customer.city).toLowerCase(),
  state: normalizeText(customer.state).toUpperCase(),
  postalCode: normalizeText(customer.postalCode).replace(/\s+/g, "").toUpperCase(),
  country: normalizeText(customer.country || "US").toUpperCase()
});

export const normalizeQuoteCart = (items = []) => [...items]
  .map((item) => ({
    sku: normalizeText(item?.sku).toUpperCase(),
    quantity: normalizeInt(item?.quantity)
  }))
  .sort((left, right) => left.sku.localeCompare(right.sku));

export const normalizeParcelPlanForFingerprint = (plan = {}) => ({
  key: normalizeText(plan.key),
  parcels: (Array.isArray(plan.parcels) ? plan.parcels : []).map((parcel) => ({
    family: normalizeText(parcel.family),
    packageCode: normalizeText(parcel.packageCode),
    supplier: normalizeText(parcel.supplier),
    quantity: normalizeInt(parcel.quantity),
    skus: (Array.isArray(parcel.skus) ? parcel.skus : []).map((sku) =>
      normalizeText(sku).toUpperCase()
    ).sort(),
    length: Number(parcel.length),
    width: Number(parcel.width),
    height: Number(parcel.height),
    weightOz: Number(parcel.weightOz),
    boxCostCents: normalizeInt(parcel.boxCostCents)
  }))
});

export const getCarrierConfigurationFingerprintInput = () => ({
  carrierAccounts: normalizeText(process.env.EASYPOST_CARRIER_ACCOUNT_IDS)
    .split(",").map((entry) => entry.trim()).filter(Boolean).sort(),
  keyMode: String(process.env.EASYPOST_API_KEY || "").trim().startsWith("EZTK")
    ? "test"
    : "production",
  fromStreet1: normalizeText(process.env.EASYPOST_FROM_STREET1).toLowerCase(),
  fromCity: normalizeText(process.env.EASYPOST_FROM_CITY).toLowerCase(),
  fromState: normalizeText(process.env.EASYPOST_FROM_STATE).toUpperCase(),
  fromCountry: normalizeText(process.env.EASYPOST_FROM_COUNTRY || "US").toUpperCase(),
  fromPostalCode: normalizeText(process.env.EASYPOST_FROM_ZIP).toUpperCase()
});

export const createShippingQuoteFingerprint = ({
  customer,
  items,
  parcelPlan,
  plannedShipDate,
  serviceLevel
}) => crypto.createHmac("sha256", getFingerprintSecret())
  .update(JSON.stringify(stableSort({
    version: 1,
    destination: normalizeQuoteAddress(customer),
    cart: normalizeQuoteCart(items),
    parcelPlan: normalizeParcelPlanForFingerprint(parcelPlan),
    plannedShipDate: normalizeText(plannedShipDate).slice(0, 10),
    serviceLevel: normalizeText(serviceLevel).toLowerCase(),
    carrierConfiguration: getCarrierConfigurationFingerprintInput()
  })))
  .digest("hex");

export const createSafeIdentifierFingerprint = (label, value) =>
  crypto.createHmac("sha256", getFingerprintSecret())
    .update(`${normalizeText(label)}:${normalizeText(value)}`)
    .digest("hex");

export const isLiveQuoteFeatureEnabled = () => {
  const configured = String(process.env.EASYPOST_LIVE_QUOTES_ENABLED || "").trim().toLowerCase();
  if (configured) return configured === "true" || configured === "1";
  return process.env.NODE_ENV !== "production";
};

export const getEasyPostBudgetConfig = (environment = process.env) => ({
  dailyRatingLimit: envInt("EASYPOST_DAILY_RATING_LIMIT", 100, environment),
  dailyAddressVerificationLimit: envInt(
    "EASYPOST_DAILY_ADDRESS_VERIFICATION_LIMIT",
    100,
    environment
  ),
  monthlyOverageLimitCents: envInt(
    "EASYPOST_MONTHLY_OVERAGE_LIMIT_CENTS",
    500,
    environment
  ),
  ratingOverageUnitCents: envInt(
    "EASYPOST_RATING_OVERAGE_UNIT_CENTS",
    1,
    environment
  ),
  addressVerificationOverageUnitCents: envInt(
    "EASYPOST_ADDRESS_VERIFICATION_OVERAGE_UNIT_CENTS",
    1,
    environment
  )
});

export const assertShippingChargeCoversCosts = ({
  postageCents,
  packagingCents,
  customerShippingChargeCents
}) => {
  const postage = normalizeInt(postageCents);
  const packaging = normalizeInt(packagingCents);
  const charged = normalizeInt(customerShippingChargeCents);
  if (postage <= 0 || charged < postage + packaging) {
    throw new Error("The shipping charge does not cover postage and packaging.");
  }
  return {
    postageCents: postage,
    packagingCents: packaging,
    customerShippingChargeCents: charged,
    shippingMarginCents: charged - postage - packaging
  };
};

export const reserveShippingQuoteUsage = async ({
  fingerprint,
  sessionFingerprint,
  ipFingerprint,
  serviceLevel,
  parcelPlan,
  plannedShipDate,
  parcelCount,
  now = new Date()
}) => {
  if (!supabaseAdmin) throw new Error("Shipping quote storage is unavailable.");
  const budget = getEasyPostBudgetConfig();
  const estimatedOverageCostCents =
    normalizeInt(parcelCount) * budget.ratingOverageUnitCents +
    budget.addressVerificationOverageUnitCents;
  const expiresAt = new Date(now.getTime() + CHECKOUT_SHIPPING_QUOTE_TTL_MS).toISOString();
  const { data, error } = await supabaseAdmin.rpc("reserve_easypost_quote", {
    p_fingerprint: fingerprint,
    p_session_fingerprint: sessionFingerprint,
    p_ip_fingerprint: ipFingerprint,
    p_service_level: serviceLevel,
    p_parcel_plan: parcelPlan,
    p_planned_ship_date: String(plannedShipDate || "").slice(0, 10),
    p_expires_at: expiresAt,
    p_parcel_count: normalizeInt(parcelCount),
    p_daily_rating_limit: budget.dailyRatingLimit,
    p_daily_verification_limit: budget.dailyAddressVerificationLimit,
    p_monthly_overage_limit_cents: budget.monthlyOverageLimitCents,
    p_estimated_overage_cost_cents: estimatedOverageCostCents
  });
  if (error) throw new Error("Shipping usage could not be recorded.", { cause: error });
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.state) throw new Error("Shipping usage could not be recorded.");
  return row;
};

const serializeSelectionForStorage = (selection) => ({
  quote: selection.quote,
  charge: selection.charge,
  option: selection.option,
  sourceServiceLevel: selection.sourceServiceLevel || selection.option?.id,
  deliveryDays: selection.deliveryDays,
  estimatedShipDateKey: selection.estimatedShipDateKey,
  estimatedShipDateLabel: selection.estimatedShipDateLabel,
  expectedArrivalDateKey: selection.expectedArrivalDateKey,
  expectedArrivalLabel: selection.expectedArrivalLabel
});

export const getStoredShippingSelection = (quoteRow, optionId) => {
  const storedOptions = Array.isArray(quoteRow?.quote_json?.shippingOptions)
    ? quoteRow.quote_json.shippingOptions
    : [];
  const stored = storedOptions.find((selection) => selection?.option?.id === optionId);
  if (stored) return stored;
  if (quoteRow?.service_level !== optionId || !quoteRow?.quote_json?.parcels) return null;
  return {
    quote: quoteRow.quote_json,
    charge: {
      postageCents: Number(quoteRow.postage_cents),
      packagingCents: Number(quoteRow.packaging_cents),
      amountCents: Number(quoteRow.charged_shipping_cents)
    },
    option: { id: quoteRow.service_level },
    deliveryDays: quoteRow.delivery_days,
    estimatedShipDateKey: quoteRow.planned_ship_date,
    estimatedShipDateLabel: quoteRow.quote_json?.estimatedShipDateLabel || "",
    expectedArrivalDateKey: quoteRow.expected_arrival_date,
    expectedArrivalLabel: quoteRow.quote_json?.expectedArrivalLabel || ""
  };
};

export const getShippingQuoteSelectionUpdate = (selection) => {
  const financials = assertShippingChargeCoversCosts({
    postageCents: selection?.charge?.postageCents,
    packagingCents: selection?.charge?.packagingCents,
    customerShippingChargeCents: selection?.charge?.amountCents
  });
  const firstRate = selection?.quote?.parcels?.[0]?.selectedRate || {};
  return {
    quote_json: {
      ...selection.quote,
      estimatedShipDateLabel: selection.estimatedShipDateLabel || "",
      expectedArrivalLabel: selection.expectedArrivalLabel || ""
    },
    postage_cents: financials.postageCents,
    packaging_cents: financials.packagingCents,
    unrounded_cents: financials.postageCents + financials.packagingCents,
    rounding_cents: financials.shippingMarginCents,
    discount_cents: 0,
    charged_shipping_cents: financials.customerShippingChargeCents,
    shipping_margin_cents: financials.shippingMarginCents,
    currency: "USD",
    delivery_days: Number.isFinite(selection.deliveryDays) ? selection.deliveryDays : null,
    service_level: selection.option.id,
    carrier: String(firstRate.carrier || ""),
    service: String(firstRate.service || ""),
    expected_arrival_date: selection.expectedArrivalDateKey || null
  };
};

export const finalizeReservedShippingQuote = async ({
  quoteId,
  selection,
  selections,
  fingerprint
}) => {
  if (!supabaseAdmin) throw new Error("Shipping quote storage is unavailable.");
  const availableSelections = (Array.isArray(selections) ? selections : [selection])
    .filter(Boolean);
  const primarySelection = availableSelections[0];
  if (!primarySelection) throw new Error("No shipping option was available to save.");
  const primaryUpdate = getShippingQuoteSelectionUpdate(primarySelection);
  const { data, error } = await supabaseAdmin
    .from("checkout_shipping_quotes")
    .update({
      ...primaryUpdate,
      quote_json: {
        quoteVersion: 2,
        shippingOptions: availableSelections.map(serializeSelectionForStorage)
      },
      verified_address_id: String(primarySelection?.verifiedAddressId || "") || null,
      status: "quoted",
      updated_at: new Date().toISOString()
    })
    .eq("id", quoteId)
    .eq("fingerprint", fingerprint)
    .eq("status", "rating")
    .select("*")
    .single();
  if (error || !data) throw new Error("The shipping quote could not be saved.", { cause: error });
  return data;
};

export const markReservedShippingQuoteFailed = async (quoteId) => {
  if (!supabaseAdmin || !quoteId) return;
  await supabaseAdmin.rpc("fail_easypost_quote", { p_quote_id: quoteId });
};

export const serializeCachedShippingSelection = (quoteRow, option) => ({
  quoteToken: quoteRow.id,
  expiresAt: quoteRow.expires_at,
  id: quoteRow.service_level,
  label: option?.label || (quoteRow.service_level === "expedited" ? "Expedited Shipping" : "Shipping"),
  amountCents: Number(quoteRow.charged_shipping_cents),
  transitLabel: option?.transitLabel || "",
  deliveryEstimate: option?.deliveryEstimate,
  estimatedShipDate: quoteRow.planned_ship_date,
  estimatedShipDateLabel: quoteRow.quote_json?.estimatedShipDateLabel || "",
  expectedArrivalDate: quoteRow.expected_arrival_date,
  expectedArrivalLabel: quoteRow.quote_json?.expectedArrivalLabel || ""
});

export const serializeStoredShippingSelection = (selection, quoteToken, expiresAt) => ({
  quoteToken,
  expiresAt,
  id: selection.option.id,
  label: selection.option.label,
  amountCents: Number(selection.charge.amountCents),
  transitLabel: selection.option.transitLabel,
  deliveryEstimate: selection.option.deliveryEstimate,
  estimatedShipDate: selection.estimatedShipDateKey,
  estimatedShipDateLabel: selection.estimatedShipDateLabel,
  expectedArrivalDate: selection.expectedArrivalDateKey,
  expectedArrivalLabel: selection.expectedArrivalLabel
});

export const serializeCachedShippingSelections = (quoteRow, options = []) => {
  const stored = Array.isArray(quoteRow?.quote_json?.shippingOptions)
    ? quoteRow.quote_json.shippingOptions
    : [];
  if (stored.length > 0) {
    return stored.map((selection) =>
      serializeStoredShippingSelection(selection, quoteRow.id, quoteRow.expires_at)
    );
  }
  const option = options.find((candidate) => candidate.id === quoteRow.service_level);
  return [serializeCachedShippingSelection(quoteRow, option)];
};
