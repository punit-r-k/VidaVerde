export const PRODUCT_TYPE_SAUERKRAUT = "sauerkraut";
export const PRODUCT_TYPE_HOT_SAUCE = "hot_sauce";

export const NORMAL_SHIPPING_OPTION_ID = "normal";
export const EXPEDITED_SHIPPING_OPTION_ID = "expedited";
export const FASTEST_SHIPPING_OPTION_ID = "fastest";
export const DEFAULT_SHIPPING_OPTION_ID = NORMAL_SHIPPING_OPTION_ID;

export const CONTINENTAL_US_SHIPPING_AREA_LABEL = "continental United States";
export const CONTINENTAL_US_SHIPPING_AREA_ERROR_MESSAGE =
  `Shipping is currently available to the ${CONTINENTAL_US_SHIPPING_AREA_LABEL} only.`;
export const PREORDER_READY_MAX_DAYS = 15;

const WEEKDAY_DEFINITIONS = [
  { index: 0, name: "Sunday", aliases: ["sun", "sunday"] },
  { index: 1, name: "Monday", aliases: ["mon", "monday"] },
  { index: 2, name: "Tuesday", aliases: ["tue", "tues", "tuesday"] },
  { index: 3, name: "Wednesday", aliases: ["wed", "weds", "wednesday"] },
  { index: 4, name: "Thursday", aliases: ["thu", "thur", "thurs", "thursday"] },
  { index: 5, name: "Friday", aliases: ["fri", "friday"] },
  { index: 6, name: "Saturday", aliases: ["sat", "saturday"] }
];
const WEEKDAY_BY_ALIAS = new Map(
  WEEKDAY_DEFINITIONS.flatMap((day) => day.aliases.map((alias) => [alias, day]))
);
const DEFAULT_SHIPPING_DAYS = "Saturday";
const DEFAULT_SHIPPING_CUTOFF_TIME = "07:00";
const DEFAULT_SHIPPING_TIME_ZONE = "America/Chicago";

const requireProductionScheduleValue = (value, fallback, variableName) => {
  const normalized = String(value || "").trim();
  if (normalized) return normalized;
  if (process.env.NODE_ENV === "production") {
    throw new Error(`Missing production shipping schedule configuration: set ${variableName}.`);
  }
  return fallback;
};

export const parseShippingScheduleDays = (value) => {
  const entries = String(value || "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  const days = [];
  const seen = new Set();
  for (const entry of entries) {
    const day = WEEKDAY_BY_ALIAS.get(entry);
    if (!day) {
      throw new Error(
        `Invalid shipping day "${entry}". Use comma-separated weekday names such as Saturday or Wednesday,Saturday.`
      );
    }
    if (!seen.has(day.index)) {
      seen.add(day.index);
      days.push({ index: day.index, name: day.name });
    }
  }
  if (days.length === 0) {
    throw new Error("Configure at least one shipping day.");
  }
  return days;
};

export const parseShippingCutoffTime = (value) => {
  const normalized = String(value || "").trim();
  const match = /^(?<hour>\d{2}):(?<minute>\d{2})$/.exec(normalized);
  const hour = Number(match?.groups?.hour);
  const minute = Number(match?.groups?.minute);
  if (!match || hour > 23 || minute > 59) {
    throw new Error("Invalid shipping cutoff time. Use 24-hour HH:mm format such as 07:00.");
  }
  return { hour, minute, value: normalized };
};

const formatList = (values) => {
  if (values.length <= 1) return values[0] || "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
};

const formatCutoffClockTime = ({ hour, minute }) => {
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
};

const configuredShippingDays = requireProductionScheduleValue(
  process.env.NEXT_PUBLIC_SHIPPING_DAYS,
  DEFAULT_SHIPPING_DAYS,
  "NEXT_PUBLIC_SHIPPING_DAYS"
);
const configuredShippingCutoff = requireProductionScheduleValue(
  process.env.NEXT_PUBLIC_SHIPPING_CUTOFF_TIME,
  DEFAULT_SHIPPING_CUTOFF_TIME,
  "NEXT_PUBLIC_SHIPPING_CUTOFF_TIME"
);
export const SHIPPING_SCHEDULE_TIME_ZONE = requireProductionScheduleValue(
  process.env.NEXT_PUBLIC_SHIPPING_TIME_ZONE,
  DEFAULT_SHIPPING_TIME_ZONE,
  "NEXT_PUBLIC_SHIPPING_TIME_ZONE"
);

try {
  new Intl.DateTimeFormat("en-US", { timeZone: SHIPPING_SCHEDULE_TIME_ZONE }).format();
} catch {
  throw new Error(
    `Invalid NEXT_PUBLIC_SHIPPING_TIME_ZONE "${SHIPPING_SCHEDULE_TIME_ZONE}". Use an IANA time zone such as America/Chicago.`
  );
}

export const SHIPPING_SCHEDULE_DAYS = Object.freeze(
  parseShippingScheduleDays(configuredShippingDays).map((day) => Object.freeze(day))
);
export const SHIPPING_CUTOFF = Object.freeze(
  parseShippingCutoffTime(configuredShippingCutoff)
);
export const SHIPPING_SCHEDULE_DAY_LABEL = formatList(
  SHIPPING_SCHEDULE_DAYS.map((day) => day.name)
);
const shippingTimeZoneLabel =
  new Intl.DateTimeFormat("en-US", {
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE,
    timeZoneName: "longGeneric"
  })
    .formatToParts(new Date("2026-01-15T12:00:00Z"))
    .find((part) => part.type === "timeZoneName")?.value ||
  SHIPPING_SCHEDULE_TIME_ZONE;
export const SHIPPING_CUTOFF_LABEL =
  `${formatCutoffClockTime(SHIPPING_CUTOFF)} ${shippingTimeZoneLabel}`;
export const SHIPPING_SCHEDULE_TITLE = "Shipping Schedule";
export const SHIPPING_SCHEDULE_INTRO =
  SHIPPING_SCHEDULE_DAYS.length === 1
    ? `${SHIPPING_SCHEDULE_DAY_LABEL} is our weekly estimated carrier-handoff day. Orders completed before ${SHIPPING_CUTOFF_LABEL} on ${SHIPPING_SCHEDULE_DAY_LABEL} are estimated to be handed to the carrier that day. Orders completed at or after the cutoff follow the next shipping cycle.`
    : `${SHIPPING_SCHEDULE_DAY_LABEL} are our configured estimated carrier-handoff days. Orders completed before ${SHIPPING_CUTOFF_LABEL} on a configured handoff day are estimated to be handed to the carrier that day. Orders completed at or after the cutoff follow the next shipping cycle.`;
export const SHIPPING_SCHEDULE_STANDARD_LINE =
  "Shipping: estimated delivery in 3–5 business days after the estimated carrier-handoff date.";
export const SHIPPING_SCHEDULE_EXPEDITED_LINE =
  "Expedited Shipping: estimated delivery in 1–3 business days after the estimated carrier-handoff date.";
export const SHIPPING_SCHEDULE_EXPEDITED_NOTE =
  "The estimated carrier-handoff date, final shipping charge, and expected arrival are shown before payment.";

const CONTINENTAL_US_STATE_CODES = new Set([
  "AL",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY"
]);
const PACKING_DAYS = new Set(SHIPPING_SCHEDULE_DAYS.map((day) => day.index));
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

const PRODUCT_TYPE_BY_SKU = {
  VV1: PRODUCT_TYPE_SAUERKRAUT,
  VV2: PRODUCT_TYPE_SAUERKRAUT,
  VV3: PRODUCT_TYPE_SAUERKRAUT,
  VV4: PRODUCT_TYPE_SAUERKRAUT,
  VV5: PRODUCT_TYPE_HOT_SAUCE,
  VV6: PRODUCT_TYPE_HOT_SAUCE
};

const NORMAL_ESTIMATE = {
  label: SHIPPING_SCHEDULE_STANDARD_LINE
    .replace(/^Shipping:\s*/u, "")
    .replace(/^estimated/u, "Estimated"),
  deliveryEstimate: {
    minimum: { unit: "business_day", value: 3 },
    maximum: { unit: "business_day", value: 5 }
  }
};

const EXPEDITED_ESTIMATE = {
  label: SHIPPING_SCHEDULE_EXPEDITED_LINE
    .replace(/^Expedited Shipping:\s*/u, "")
    .replace(/^estimated/u, "Estimated"),
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

const isAtOrAfterPackingCutoff = (date) => {
  const parts = getScheduleParts(date);
  const cutoff = getScheduleDateTime({
    year: parts.year,
    month: parts.month,
    day: parts.day,
    hour: SHIPPING_CUTOFF.hour,
    minute: SHIPPING_CUTOFF.minute
  });
  return toDate(date).getTime() >= cutoff.getTime();
};

export const getNextPackingDate = (orderDate = new Date()) => {
  const startDate = toDate(orderDate);

  for (let offset = 0; offset <= 7; offset += 1) {
    const candidate = addScheduleCalendarDays(startDate, offset);
    const candidateParts = getScheduleParts(candidate);
    if (!PACKING_DAYS.has(candidateParts.weekday)) continue;
    if (offset === 0 && isAtOrAfterPackingCutoff(startDate)) continue;

    return getScheduleDateTime({
      year: candidateParts.year,
      month: candidateParts.month,
      day: candidateParts.day,
      hour: SHIPPING_CUTOFF.hour,
      minute: SHIPPING_CUTOFF.minute
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

export const getExpectedDeliveryDateFromShipDate = ({
  shipDate,
  shippingOption
} = {}) => {
  const maximumEstimate = shippingOption?.deliveryEstimate?.maximum || {};
  const maximumDays = toCount(maximumEstimate.value);
  if (maximumDays <= 0) return null;

  return addDeliveryDays(toDate(shipDate), maximumDays, maximumEstimate.unit);
};

const normalizeStateCode = (value) =>
  String(value || "").trim().toUpperCase().replace(/[^A-Z]/g, "").slice(0, 2);

export const isContinentalUnitedStatesShippingAddressEligible = ({
  state
} = {}) => {
  const stateCode = normalizeStateCode(state);
  return CONTINENTAL_US_STATE_CODES.has(stateCode);
};

export const getLatestExpectedDeliveryDate = ({
  orderDate = new Date(),
  shippingOption,
  hasPreorderItems = false,
  preorderReadyMaxDays = PREORDER_READY_MAX_DAYS
} = {}) => {
  const shipDate = getEstimatedShipDate({
    orderDate,
    hasPreorderItems,
    preorderReadyMaxDays
  });
  if (!shipDate) return null;

  return getExpectedDeliveryDateFromShipDate({ shipDate, shippingOption });
};

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

export const getShippingOptionsForCart = ({ items = [], subtotalCents = 0 } = {}) => {
  const counts = countShippingProductTypes(items);
  const normalOption = {
    id: NORMAL_SHIPPING_OPTION_ID,
    label: "Shipping",
    amountCents: 0,
    transitLabel: NORMAL_ESTIMATE.label,
    note: "Live postage plus packaging is calculated for the entered address.",
    deliveryEstimate: NORMAL_ESTIMATE.deliveryEstimate
  };
  const expeditedOption = {
    id: EXPEDITED_SHIPPING_OPTION_ID,
    label: "Expedited Shipping",
    amountCents: 0,
    transitLabel: EXPEDITED_ESTIMATE.label,
    note: "Live postage plus packaging is calculated for the entered address.",
    deliveryEstimate: EXPEDITED_ESTIMATE.deliveryEstimate
  };

  return {
    tier: "live_rate",
    sauerkrautCount: counts.sauerkrautCount,
    hotSauceCount: counts.hotSauceCount,
    totalItems: counts.totalItems,
    subtotalCents: toCents(subtotalCents),
    normalOption,
    expeditedOption,
    options: [normalOption, expeditedOption]
  };
};

export const getCustomerShippingOptions = ({
  shipping
} = {}) => {
  const baseOptions = Array.isArray(shipping?.options)
    ? shipping.options
    : getShippingOptionsForCart().options;

  return baseOptions;
};

export const normalizeShippingOptionId = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  if ([
    EXPEDITED_SHIPPING_OPTION_ID,
    FASTEST_SHIPPING_OPTION_ID,
    "expidited",
    "express"
  ].includes(normalized)) return EXPEDITED_SHIPPING_OPTION_ID;

  if ([
    NORMAL_SHIPPING_OPTION_ID,
    "standard",
    "owner_delivery",
    "regular",
    "personal_delivery",
    "owner"
  ].includes(normalized)) return NORMAL_SHIPPING_OPTION_ID;

  return DEFAULT_SHIPPING_OPTION_ID;
};

export const getShippingTransitWindow = (value) => {
  const serviceLevel = normalizeShippingOptionId(value);
  return serviceLevel === EXPEDITED_SHIPPING_OPTION_ID
    ? { minimumDays: 1, maximumDays: 3 }
    : { minimumDays: 3, maximumDays: 5 };
};

export const findShippingOption = ({
  shipping,
  optionId
} = {}) => {
  const normalizedOptionId = normalizeShippingOptionId(optionId);
  return getCustomerShippingOptions({ shipping })
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
        optionId: rawMetadataOptionId
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
  const amountMatch = getCustomerShippingOptions({ shipping })
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
