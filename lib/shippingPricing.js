export const PRODUCT_TYPE_SAUERKRAUT = "sauerkraut";
export const PRODUCT_TYPE_HOT_SAUCE = "hot_sauce";

export const STANDARD_SHIPPING_OPTION_ID = "standard";
export const EXPEDITED_SHIPPING_OPTION_ID = "expedited";
export const OWNER_DELIVERY_SHIPPING_OPTION_ID = "owner_delivery";
export const DEFAULT_SHIPPING_OPTION_ID = STANDARD_SHIPPING_OPTION_ID;

export const FREE_SHIPPING_THRESHOLD_CENTS = 7500;
export const SAUERKRAUT_UNIT_PRICE_CENTS = 1199;
export const HOT_SAUCE_UNIT_PRICE_CENTS = 999;
export const LOCAL_SHIPPING_AREA_LABEL = "Greater Houston area";
export const LOCAL_SHIPPING_AREA_ERROR_MESSAGE =
  `Shipping is currently limited to ${LOCAL_SHIPPING_AREA_LABEL} TX ZIP codes.`;
export const PREORDER_READY_MAX_DAYS = 15;
export const PACKING_CUTOFF_HOUR = 8;
export const SHIPPING_SCHEDULE_TIME_ZONE = "America/Chicago";
export const SHIPPING_SCHEDULE_TITLE = "Shipping Schedule";
export const SHIPPING_SCHEDULE_INTRO =
  "We pack and ship orders every Tuesday and Saturday so each jar and bottle can be packed carefully. Orders placed by 8 AM on packing days usually ship the same day. Orders placed after 8 AM ship on the next packing day.";
export const SHIPPING_SCHEDULE_STANDARD_LINE =
  "Standard Shipping: ships on the next packing day, then typically arrives in 2–5 business days.";
export const SHIPPING_SCHEDULE_EXPEDITED_LINE =
  "Expedited Shipping: ships on the next packing day, then typically arrives in 1–3 business days.";
export const SHIPPING_SCHEDULE_EXPEDITED_NOTE =
  "Expedited shipping speeds up carrier transit, but all orders still follow our Tuesday/Saturday packing schedule.";

const LOCAL_SHIPPING_STATE_CODE = "TX";
const GREATER_HOUSTON_ZIP_PREFIXES = new Set(["770", "772", "773", "774", "775"]);
const TUESDAY = 2;
const SATURDAY = 6;
const PACKING_DAYS = new Set([TUESDAY, SATURDAY]);
const SCHEDULE_WEEKDAY_INDEX = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};
const SCHEDULE_DATE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: SHIPPING_SCHEDULE_TIME_ZONE,
  weekday: "short",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23"
});

export const OWNER_DELIVERY_OPTION = {
  id: OWNER_DELIVERY_SHIPPING_OPTION_ID,
  label: "Personal delivery by the owner",
  amountCents: 100000,
  transitLabel: "Ships on the next packing day, then is coordinated directly within 2-7 days.",
  carrierTransitLabel: "2-7 days",
  note: `${LOCAL_SHIPPING_AREA_LABEL} TX ZIP codes only.`,
  deliveryEstimate: {
    minimum: { unit: "day", value: 2 },
    maximum: { unit: "day", value: 7 }
  }
};

const PRODUCT_TYPE_BY_SKU = {
  VV1: PRODUCT_TYPE_SAUERKRAUT,
  VV2: PRODUCT_TYPE_SAUERKRAUT,
  VV3: PRODUCT_TYPE_SAUERKRAUT,
  VV4: PRODUCT_TYPE_SAUERKRAUT,
  VV5: PRODUCT_TYPE_HOT_SAUCE,
  VV6: PRODUCT_TYPE_HOT_SAUCE
};

const SHIPPING_TIERS = {
  free_shipping: {
    tier: "free_shipping",
    label: "Free Shipping",
    standardAmount: 0,
    expeditedAmount: 999,
    standardName: "Free Standard Shipping",
    expeditedName: "Expedited Shipping Upgrade"
  },
  small: {
    tier: "small",
    label: "Small",
    standardAmount: 699,
    expeditedAmount: 1199,
    standardName: "Standard Shipping",
    expeditedName: "Expedited Shipping"
  },
  single_jar: {
    tier: "single_jar",
    label: "Single Jar",
    standardAmount: 799,
    expeditedAmount: 1499,
    standardName: "Standard Shipping",
    expeditedName: "Expedited Shipping"
  },
  standard: {
    tier: "standard",
    label: "Standard",
    standardAmount: 999,
    expeditedAmount: 1499,
    standardName: "Standard Shipping",
    expeditedName: "Expedited Shipping"
  },
  bundle: {
    tier: "bundle",
    label: "Bundle",
    standardAmount: 1499,
    expeditedAmount: 1999,
    standardName: "Standard Shipping",
    expeditedName: "Expedited Shipping"
  },
  large_bundle: {
    tier: "large_bundle",
    label: "Large Bundle",
    standardAmount: 1899,
    expeditedAmount: 2499,
    standardName: "Standard Shipping",
    expeditedName: "Expedited Shipping"
  }
};

const STANDARD_ESTIMATE = {
  label: "Ships on the next packing day, then typically arrives in 2–5 business days.",
  carrierTransitLabel: "2–5 business days",
  deliveryEstimate: {
    minimum: { unit: "business_day", value: 2 },
    maximum: { unit: "business_day", value: 5 }
  }
};

const EXPEDITED_ESTIMATE = {
  label: "Ships on the next packing day, then typically arrives in 1–3 business days.",
  carrierTransitLabel: "1–3 business days",
  deliveryEstimate: {
    minimum: { unit: "business_day", value: 1 },
    maximum: { unit: "business_day", value: 3 }
  }
};

const toCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const toCents = (value) => {
  const cents = Number(value);
  return Number.isFinite(cents) && cents > 0 ? Math.floor(cents) : 0;
};

const toNullableCents = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const cents = Number(value);
  return Number.isFinite(cents) && cents >= 0 ? Math.floor(cents) : null;
};

const toDate = (value) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
};

const getScheduleParts = (value) => {
  const date = toDate(value);
  const parts = SCHEDULE_DATE_TIME_FORMATTER.formatToParts(date).reduce(
    (acc, part) => {
      if (part.type !== "literal") {
        acc[part.type] = part.value;
      }
      return acc;
    },
    {}
  );
  const weekdayKey = String(parts.weekday || "").slice(0, 3);

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    millisecond: date.getMilliseconds(),
    weekday: SCHEDULE_WEEKDAY_INDEX[weekdayKey]
  };
};

function getScheduleDateTime({
  year,
  month,
  day,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
}) {
  const utcGuess = new Date(Date.UTC(
    year,
    month - 1,
    day,
    hour,
    minute,
    second,
    millisecond
  ));
  const offset = getScheduleOffsetMs(utcGuess);
  const scheduleDate = new Date(utcGuess.getTime() - offset);
  const verifiedOffset = getScheduleOffsetMs(scheduleDate);

  return verifiedOffset === offset
    ? scheduleDate
    : new Date(utcGuess.getTime() - verifiedOffset);
}

function getScheduleOffsetMs(date) {
  const parts = getScheduleParts(date);
  const utcForScheduleParts = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
    parts.millisecond
  );
  return utcForScheduleParts - date.getTime();
}

const addScheduleCalendarDays = (date, days) => {
  const parts = getScheduleParts(date);
  const calendarDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  calendarDate.setUTCDate(calendarDate.getUTCDate() + toCount(days));

  return getScheduleDateTime({
    year: calendarDate.getUTCFullYear(),
    month: calendarDate.getUTCMonth() + 1,
    day: calendarDate.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second,
    millisecond: parts.millisecond
  });
};

const addScheduleBusinessDays = (date, days) => {
  let nextDate = toDate(date);
  let remaining = toCount(days);

  while (remaining > 0) {
    nextDate = addScheduleCalendarDays(nextDate, 1);
    const day = getScheduleParts(nextDate).weekday;
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return nextDate;
};

const addDeliveryDays = (date, days, unit) =>
  unit === "business_day"
    ? addScheduleBusinessDays(date, days)
    : addScheduleCalendarDays(date, days);

const isAfterPackingCutoff = (date) => {
  const parts = getScheduleParts(date);
  const cutoff = getScheduleDateTime({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: PACKING_CUTOFF_HOUR
  });
  return toDate(date).getTime() > cutoff.getTime();
};

export const getNextPackingDate = (orderDate = new Date()) => {
  const startDate = toDate(orderDate);

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addScheduleCalendarDays(startDate, offset);
    const candidateParts = getScheduleParts(candidate);
    if (!PACKING_DAYS.has(candidateParts.weekday)) continue;
    if (offset === 0 && isAfterPackingCutoff(startDate)) continue;

    return getScheduleDateTime({
      year: candidateParts.year,
      month: candidateParts.month,
      day: candidateParts.day,
      hour: PACKING_CUTOFF_HOUR
    });
  }

  return null;
};

export const getEstimatedShipDate = ({
  orderDate = new Date(),
  hasPreorderItems = false,
  preorderReadyMaxDays = PREORDER_READY_MAX_DAYS
} = {}) => {
  const readyDate = hasPreorderItems
    ? addScheduleCalendarDays(orderDate, preorderReadyMaxDays)
    : toDate(orderDate);

  return getNextPackingDate(readyDate);
};

const normalizeStateCode = (value) =>
  String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);

const getPostalPrefix = (value) =>
  String(value || "").replace(/\D/g, "").slice(0, 3);

export const isGreaterHoustonShippingAddressEligible = ({
  state,
  postalCode
} = {}) =>
  normalizeStateCode(state) === LOCAL_SHIPPING_STATE_CODE &&
  GREATER_HOUSTON_ZIP_PREFIXES.has(getPostalPrefix(postalCode));

export const getLatestExpectedDeliveryDate = ({
  orderDate = new Date(),
  shippingOption,
  hasPreorderItems = false,
  preorderReadyMaxDays = PREORDER_READY_MAX_DAYS
} = {}) => {
  const maximumEstimate = shippingOption?.deliveryEstimate?.maximum || {};
  const maximumDays = toCount(maximumEstimate.value);
  if (maximumDays <= 0) return null;

  const shipDate = getEstimatedShipDate({
    orderDate,
    hasPreorderItems,
    preorderReadyMaxDays
  });
  if (!shipDate) return null;

  return addDeliveryDays(shipDate, maximumDays, maximumEstimate.unit);
};

const getCartItems = (cart = {}) => {
  if (Array.isArray(cart)) return cart;
  return Array.isArray(cart?.items) ? cart.items : [];
};

const getDefaultUnitPriceCents = (item) => {
  const productType = normalizeProductType(
    item?.productType || item?.product_type || item?.type,
    item?.sku
  );

  if (productType === PRODUCT_TYPE_SAUERKRAUT) return SAUERKRAUT_UNIT_PRICE_CENTS;
  if (productType === PRODUCT_TYPE_HOT_SAUCE) return HOT_SAUCE_UNIT_PRICE_CENTS;
  return null;
};

const getItemUnitPriceCents = (item) =>
  toNullableCents(
    item?.priceCents ??
      item?.price_cents ??
      item?.unitPriceCents ??
      item?.unit_price_cents ??
      item?.unitAmount ??
      item?.unit_amount
  ) ?? getDefaultUnitPriceCents(item);

const getItemLineTotalCents = (item) =>
  toNullableCents(
    item?.lineTotal ??
      item?.lineTotalCents ??
      item?.line_total_cents ??
      item?.totalCents ??
      item?.total_cents
  );

const getCartSubtotalCents = (cart = {}) => {
  const items = getCartItems(cart);
  let subtotalCents = 0;
  let hasCalculatedSubtotal = false;

  for (const item of items) {
    const quantity = toCount(item?.quantity);
    if (quantity <= 0) continue;

    const lineTotalCents = getItemLineTotalCents(item);
    if (lineTotalCents !== null) {
      subtotalCents += lineTotalCents;
      hasCalculatedSubtotal = true;
      continue;
    }

    const unitPriceCents = getItemUnitPriceCents(item);
    if (unitPriceCents !== null) {
      subtotalCents += unitPriceCents * quantity;
      hasCalculatedSubtotal = true;
    }
  }

  if (hasCalculatedSubtotal) return subtotalCents;

  return (
    toNullableCents(
      cart?.subtotalCents ??
        cart?.subtotal_cents ??
        cart?.amountSubtotalCents ??
        cart?.amount_subtotal
    ) ?? 0
  );
};

const formatCurrencyCents = (amountCents) =>
  `$${(toCents(amountCents) / 100).toFixed(2)}`;

export const normalizeProductType = (value, sku = "") => {
  const normalized = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === PRODUCT_TYPE_SAUERKRAUT || normalized === "kraut") {
    return PRODUCT_TYPE_SAUERKRAUT;
  }
  if (
    normalized === PRODUCT_TYPE_HOT_SAUCE ||
    normalized === "hotsauce" ||
    normalized === "hot_sauce_bottle"
  ) {
    return PRODUCT_TYPE_HOT_SAUCE;
  }

  return PRODUCT_TYPE_BY_SKU[String(sku || "").trim().toUpperCase()] || "";
};

export const countShippingProductTypes = (items = []) =>
  (Array.isArray(items) ? items : []).reduce(
    (counts, item) => {
      const quantity = toCount(item?.quantity);
      if (quantity <= 0) return counts;

      const productType = normalizeProductType(
        item?.productType || item?.product_type || item?.type,
        item?.sku
      );

      if (productType === PRODUCT_TYPE_SAUERKRAUT) {
        counts.sauerkrautCount += quantity;
      } else if (productType === PRODUCT_TYPE_HOT_SAUCE) {
        counts.hotSauceCount += quantity;
      }

      counts.totalItems = counts.sauerkrautCount + counts.hotSauceCount;
      return counts;
    },
    {
      sauerkrautCount: 0,
      hotSauceCount: 0,
      totalItems: 0
    }
  );

export const getShippingTier = ({
  sauerkrautCount = 0,
  hotSauceCount = 0,
  subtotalCents = 0
} = {}) => {
  const safeSauerkrautCount = toCount(sauerkrautCount);
  const safeHotSauceCount = toCount(hotSauceCount);
  const totalItems = safeSauerkrautCount + safeHotSauceCount;
  const safeSubtotal = toCents(subtotalCents);

  if (safeSubtotal >= FREE_SHIPPING_THRESHOLD_CENTS) {
    return SHIPPING_TIERS.free_shipping;
  }

  if (safeSauerkrautCount === 0 && safeHotSauceCount === 1) {
    return SHIPPING_TIERS.small;
  }

  if (safeSauerkrautCount === 1 && safeHotSauceCount === 0) {
    return SHIPPING_TIERS.single_jar;
  }

  if (safeSauerkrautCount >= 3 || totalItems >= 7) {
    return SHIPPING_TIERS.large_bundle;
  }

  if (
    safeSauerkrautCount === 2 ||
    totalItems >= 4
  ) {
    return SHIPPING_TIERS.bundle;
  }

  return SHIPPING_TIERS.standard;
};

const getStandardShippingAmountCents = ({ counts, subtotalCents }) =>
  getShippingTier({
    sauerkrautCount: counts.sauerkrautCount,
    hotSauceCount: counts.hotSauceCount,
    subtotalCents
  }).standardAmount;

const getUpsellCandidate = ({
  counts,
  subtotalCents,
  addSauerkrautCount = 0,
  addHotSauceCount = 0,
  message
}) => {
  const nextCounts = {
    sauerkrautCount: counts.sauerkrautCount + addSauerkrautCount,
    hotSauceCount: counts.hotSauceCount + addHotSauceCount
  };
  nextCounts.totalItems = nextCounts.sauerkrautCount + nextCounts.hotSauceCount;

  const nextSubtotalCents =
    subtotalCents +
    addSauerkrautCount * SAUERKRAUT_UNIT_PRICE_CENTS +
    addHotSauceCount * HOT_SAUCE_UNIT_PRICE_CENTS;
  const currentStandardAmount = getStandardShippingAmountCents({
    counts,
    subtotalCents
  });
  const nextStandardAmount = getStandardShippingAmountCents({
    counts: nextCounts,
    subtotalCents: nextSubtotalCents
  });
  const unlocksFreeShipping = currentStandardAmount > 0 && nextStandardAmount === 0;
  const keepsStandardShippingSame = nextStandardAmount === currentStandardAmount;

  if (!unlocksFreeShipping && !keepsStandardShippingSame) {
    return null;
  }

  return {
    message,
    kind: unlocksFreeShipping ? "free_shipping" : "same_shipping",
    suggestedSauerkrautCount: addSauerkrautCount,
    suggestedHotSauceCount: addHotSauceCount,
    projectedSubtotalCents: nextSubtotalCents,
    projectedStandardShippingCents: nextStandardAmount
  };
};

const getFreeShippingUnlockCandidate = ({ counts, subtotalCents }) => {
  if (
    counts.sauerkrautCount === 3 &&
    counts.hotSauceCount === 3 &&
    subtotalCents < FREE_SHIPPING_THRESHOLD_CENTS
  ) {
    return getUpsellCandidate({
      counts,
      subtotalCents,
      addHotSauceCount: 1,
      message: "Add one hot sauce and your order ships standard for free."
    });
  }

  return null;
};

const getFreeShippingThresholdMessage = ({
  subtotalCents,
  formattedAmountAwayFromFreeShipping
}) => {
  if (subtotalCents >= FREE_SHIPPING_THRESHOLD_CENTS) {
    return "Free standard shipping unlocked.";
  }

  if (subtotalCents >= 7000) {
    return `You're almost at free standard shipping, only ${formattedAmountAwayFromFreeShipping} away.`;
  }

  if (subtotalCents >= 6500) {
    return `You're ${formattedAmountAwayFromFreeShipping} away from free standard shipping.`;
  }

  if (subtotalCents >= 5000) {
    return "Free standard shipping starts at $75.";
  }

  return "";
};

const getSameShippingCostCandidate = ({ counts, subtotalCents }) => {
  const { sauerkrautCount, hotSauceCount } = counts;

  if (sauerkrautCount === 0 && hotSauceCount === 1) {
    return getUpsellCandidate({
      counts,
      subtotalCents,
      addHotSauceCount: 1,
      message: "You can add another hot sauce without increasing shipping."
    });
  }

  if (sauerkrautCount === 0 && hotSauceCount === 2) {
    return getUpsellCandidate({
      counts,
      subtotalCents,
      addHotSauceCount: 1,
      message: "You can add another hot sauce before shipping increases."
    });
  }

  if (sauerkrautCount === 1 && hotSauceCount === 0) {
    return getUpsellCandidate({
      counts,
      subtotalCents,
      addHotSauceCount: 1,
      message: "You can add one hot sauce without increasing shipping."
    });
  }

  if (sauerkrautCount === 1 && hotSauceCount === 1) {
    return getUpsellCandidate({
      counts,
      subtotalCents,
      addHotSauceCount: 1,
      message: "You can add another hot sauce before shipping increases."
    });
  }

  if (sauerkrautCount === 2 && hotSauceCount === 0) {
    return getUpsellCandidate({
      counts,
      subtotalCents,
      addHotSauceCount: 1,
      message: "You can add one hot sauce without increasing shipping."
    });
  }

  if (sauerkrautCount === 2 && hotSauceCount === 1) {
    return getUpsellCandidate({
      counts,
      subtotalCents,
      addHotSauceCount: 1,
      message: "You can add another hot sauce without increasing shipping."
    });
  }

  if (sauerkrautCount === 2 && hotSauceCount === 2) {
    return getUpsellCandidate({
      counts,
      subtotalCents,
      addHotSauceCount: 1,
      message: "You can add another hot sauce without increasing shipping."
    });
  }

  return null;
};

export const getCartUpsellMessage = (cart = {}) => {
  const items = getCartItems(cart);
  const counts = countShippingProductTypes(items);
  const subtotalCents = getCartSubtotalCents(cart);
  const amountAwayFromFreeShippingCents = Math.max(
    FREE_SHIPPING_THRESHOLD_CENTS - subtotalCents,
    0
  );
  const formattedAmountAwayFromFreeShipping = formatCurrencyCents(
    amountAwayFromFreeShippingCents
  );
  const baseMessage = {
    sauerkrautCount: counts.sauerkrautCount,
    hotSauceCount: counts.hotSauceCount,
    totalItems: counts.totalItems,
    subtotalCents,
    amountAwayFromFreeShippingCents,
    formattedAmountAwayFromFreeShipping
  };

  if (counts.totalItems <= 0) return null;

  const freeShippingUnlockCandidate = getFreeShippingUnlockCandidate({
    counts,
    subtotalCents
  });

  if (subtotalCents >= 6500 && freeShippingUnlockCandidate) {
    return {
      ...baseMessage,
      ...freeShippingUnlockCandidate
    };
  }

  const freeShippingThresholdMessage = getFreeShippingThresholdMessage({
    subtotalCents,
    formattedAmountAwayFromFreeShipping
  });

  if (freeShippingThresholdMessage) {
    return {
      ...baseMessage,
      kind: "free_shipping",
      message: freeShippingThresholdMessage
    };
  }

  if (freeShippingUnlockCandidate) {
    return {
      ...baseMessage,
      ...freeShippingUnlockCandidate
    };
  }

  const sameShippingCostCandidate = getSameShippingCostCandidate({
    counts,
    subtotalCents
  });

  return sameShippingCostCandidate
    ? {
        ...baseMessage,
        ...sameShippingCostCandidate
      }
    : null;
};

export const getShippingOptionsForCart = ({ items = [], subtotalCents = 0 } = {}) => {
  const counts = countShippingProductTypes(items);
  const tier = getShippingTier({
    ...counts,
    subtotalCents
  });

  const standardOption = {
    id: STANDARD_SHIPPING_OPTION_ID,
    label: tier.standardName,
    amountCents: tier.standardAmount,
    transitLabel: STANDARD_ESTIMATE.label,
    carrierTransitLabel: STANDARD_ESTIMATE.carrierTransitLabel,
    note: "",
    deliveryEstimate: STANDARD_ESTIMATE.deliveryEstimate
  };
  const expeditedOption = {
    id: EXPEDITED_SHIPPING_OPTION_ID,
    label: tier.expeditedName,
    amountCents: tier.expeditedAmount,
    transitLabel: EXPEDITED_ESTIMATE.label,
    carrierTransitLabel: EXPEDITED_ESTIMATE.carrierTransitLabel,
    note: "",
    deliveryEstimate: EXPEDITED_ESTIMATE.deliveryEstimate
  };

  return {
    tier: tier.tier,
    tierLabel: tier.label,
    sauerkrautCount: counts.sauerkrautCount,
    hotSauceCount: counts.hotSauceCount,
    totalItems: counts.totalItems,
    subtotalCents: toCents(subtotalCents),
    standardOption,
    expeditedOption,
    options: [standardOption, expeditedOption]
  };
};

export const getCustomerShippingOptions = ({
  shipping,
  includeOwnerDelivery = false
} = {}) => {
  const baseOptions = Array.isArray(shipping?.options)
    ? shipping.options
    : getShippingOptionsForCart().options;

  return includeOwnerDelivery
    ? [...baseOptions, OWNER_DELIVERY_OPTION]
    : baseOptions;
};

export const normalizeShippingOptionId = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "regular") return STANDARD_SHIPPING_OPTION_ID;
  if (normalized === "expidited") return EXPEDITED_SHIPPING_OPTION_ID;
  if (normalized === "personal_delivery" || normalized === "owner") {
    return OWNER_DELIVERY_SHIPPING_OPTION_ID;
  }
  if (
    normalized === STANDARD_SHIPPING_OPTION_ID ||
    normalized === EXPEDITED_SHIPPING_OPTION_ID ||
    normalized === OWNER_DELIVERY_SHIPPING_OPTION_ID
  ) {
    return normalized;
  }

  return DEFAULT_SHIPPING_OPTION_ID;
};

export const findShippingOption = ({
  shipping,
  optionId,
  includeOwnerDelivery = true
} = {}) => {
  const normalizedOptionId = normalizeShippingOptionId(optionId);
  return getCustomerShippingOptions({ shipping, includeOwnerDelivery })
    .find((option) => option.id === normalizedOptionId) || null;
};

export const inferSelectedShippingOption = ({
  shipping,
  amountCents = 0,
  shippingRateMetadata = {}
} = {}) => {
  const rawMetadataOptionId =
    shippingRateMetadata.shipping_option ||
    shippingRateMetadata.option_id ||
    shippingRateMetadata.id ||
    "";
  const optionFromMetadata = rawMetadataOptionId
    ? findShippingOption({
        shipping,
        optionId: rawMetadataOptionId,
        includeOwnerDelivery: true
      })
    : null;

  if (optionFromMetadata) {
    return {
      ...optionFromMetadata,
      tier: shippingRateMetadata.shipping_tier || shipping?.tier || "",
      label: shippingRateMetadata.shipping_option_label || optionFromMetadata.label,
      transitLabel: shippingRateMetadata.shipping_estimate || optionFromMetadata.transitLabel
    };
  }

  const safeAmount = toCents(amountCents);
  const amountMatch = getCustomerShippingOptions({ shipping, includeOwnerDelivery: true })
    .find((option) => option.amountCents === safeAmount);

  if (amountMatch) {
    return {
      ...amountMatch,
      tier: shipping?.tier || ""
    };
  }

  return {
    id: "",
    label: safeAmount > 0 ? "Shipping" : "",
    amountCents: safeAmount,
    transitLabel: "",
    tier: shipping?.tier || ""
  };
};
