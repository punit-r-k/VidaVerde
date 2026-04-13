const WEEKDAY_INDEX = {
  sun: 0,
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6
};

export const MARKET_TIMEZONE = "America/Chicago";
export const MARKET_NAME = "Fulshear Farmers Market";
export const MARKET_ADDRESS = "9035 Bois d'Arc Ln, Richmond, TX 77406";
export const MARKET_DAY_LABEL = "Every Saturday";
export const MARKET_PICKUP_WINDOW = "9am-1pm";
export const MARKET_PICKUP_LABEL = `Pickup at ${MARKET_NAME}`;
export const SAME_DAY_PICKUP_CUTOFF_LABEL = "8:00am Saturday";
export const MARKET_PICKUP_SUMMARY =
  "Reserve online, pay to hold your order, then pick up on site during the posted market window.";
export const MARKET_PICKUP_POLICY_VERSION = "2026-04-13";
const MARKET_SUPPORT_PHONE_DISPLAY = "(713) 478-1878";
export const MARKET_PICKUP_ACKNOWLEDGEMENT_LABEL =
  "I understand pickup stock is not reserved until payment succeeds, and I accept the pickup timing, missed-pickup, and market-closure terms.";
export const MARKET_PICKUP_ACKNOWLEDGEMENT_NOTICE =
  "Pickup inventory is only reserved after payment is successfully processed. " +
  `Paid in-stock orders completed before ${SAME_DAY_PICKUP_CUTOFF_LABEL} are eligible for that Saturday only if the item is still available when payment goes through. ` +
  "Pickup orders must be collected during the listed market window. " +
  `If you may miss pickup or need to request an order change, call or text ${MARKET_SUPPORT_PHONE_DISPLAY} as soon as possible. ` +
  "We work in good faith to accommodate customer needs when product quality, food safety, and scheduling allow.";

const MARKET_CUTOFF_HOUR = 8;
const PREP_SHEET_ROLL_HOUR = 14;
const MINUTE_IN_MS = 60_000;
const OFFSET_PATTERN = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/;

export const SAME_DAY_PICKUP_NOTICE =
  `Paid in-stock orders completed any time before ${SAME_DAY_PICKUP_CUTOFF_LABEL} are eligible ` +
  "for pickup that Saturday, subject to inventory when payment is processed.";
export const SAME_DAY_PICKUP_EXAMPLE_NOTICE =
  "Orders placed earlier in the week, or even at 7:59am Saturday, can still be picked up that Saturday if the item remains in stock.";
export const FOLLOWING_WEEK_PICKUP_NOTICE =
  `Orders completed at or after ${SAME_DAY_PICKUP_CUTOFF_LABEL}, or requiring additional fermentation time, ` +
  "move to the next available pickup date.";
export const WEATHER_CLOSURE_NOTICE =
  "Pickup availability depends on market operations, weather, vendor safety, and other events outside our control. " +
  "If pickup must be canceled, delayed, or relocated, affected customers will be notified using the contact information provided at checkout.";
export const MARKET_UPDATES_NOTICE =
  `Customers are responsible for monitoring order messages and ${MARKET_NAME} updates before arriving for pickup.`;
export const PICKUP_HELP_NOTICE =
  `If you may miss pickup or need to request an order change, call or text ${MARKET_SUPPORT_PHONE_DISPLAY} as soon as possible. ` +
  "Vida Verde will work in good faith to accommodate customer needs when product quality, food safety, and scheduling allow.";
export const MISSED_PICKUP_NOTICE =
  "Orders not collected during the listed pickup window may be treated as missed pickups. " +
  `Customers should contact ${MARKET_SUPPORT_PHONE_DISPLAY} sooner than later if they expect to be delayed. ` +
  "Product availability is not guaranteed after market close, but Vida Verde will work in good faith to accommodate the situation when feasible, subject to product quality, food safety, scheduling, and applicable law.";
export const ORDER_CHANGE_NOTICE =
  "Requested cancellations, quantity changes, or pickup-date changes are not guaranteed after payment or once packing and production scheduling have begun. " +
  `Customers should call or text ${MARKET_SUPPORT_PHONE_DISPLAY} as early as possible, and Vida Verde will work in good faith to accommodate needs in a fair and equitable manner when feasible.`;
export const PICKUP_TRANSFER_NOTICE =
  "Once an order is handed to the customer or the customer's designated pickup person, " +
  "storage, transport, refrigeration, and safe handling become the customer's responsibility.";
export const LIMITED_REMEDY_NOTICE =
  "To the extent permitted by law, Vida Verde's responsibility for a pickup order is limited to rescheduling pickup, " +
  "issuing store credit, refunding the affected order, or providing another remedy required by law, and will not exceed the amount paid for the order.";
export const FAIR_SERVICE_NOTICE =
  "Vida Verde's goal is to serve customers and allocate product in a fair and equitable manner across all orders while protecting product quality and food safety.";
export const MARKET_PICKUP_NOTE_LINES = [
  `${MARKET_DAY_LABEL}, ${MARKET_PICKUP_WINDOW}.`,
  `Paid in-stock orders completed any time before ${SAME_DAY_PICKUP_CUTOFF_LABEL} are eligible for pickup that Saturday, if stock is available.`,
  "Orders not collected during the posted window are not guaranteed after market close.",
  `If you may miss pickup or need an order change, call or text ${MARKET_SUPPORT_PHONE_DISPLAY} as soon as possible.`,
  "Market closures or schedule changes may result in a rescheduled pickup, store credit, or refund.",
  "After pickup, refrigeration and safe handling are the customer's responsibility."
];
export const MARKET_PICKUP_POLICY_ITEMS = [
  {
    label: "Reservation & Timing",
    body:
      "Pickup orders are reserved only after payment is successfully processed. " +
      `Paid in-stock orders completed any time before ${SAME_DAY_PICKUP_CUTOFF_LABEL} are eligible for pickup that Saturday, if stock is available; ` +
      "orders completed later, or requiring more fermentation time, move to the next available pickup date."
  },
  {
    label: "Pickup Window",
    body:
      `Pickup is available only at ${MARKET_NAME} during ${MARKET_DAY_LABEL}, ${MARKET_PICKUP_WINDOW}. ` +
      "Customers are responsible for arriving during that window and providing accurate contact information for order updates."
  },
  {
    label: "Missed Pickups",
    body:
      "Orders not collected during the listed pickup window may be treated as missed pickups. " +
      `Customers should call or text ${MARKET_SUPPORT_PHONE_DISPLAY} as soon as possible if they expect to be late or miss pickup. ` +
      "Product availability is not guaranteed after market close, but Vida Verde will work in good faith to accommodate the situation when feasible, subject to product quality, food safety, scheduling, and applicable law."
  },
  {
    label: "Closures & Rescheduling",
    body:
      "Pickup depends on market operations, weather, vendor safety, and other events outside our control. " +
      "If pickup must be canceled, delayed, or relocated, Vida Verde may reschedule pickup, issue store credit, " +
      "or refund the affected order as the customer's exclusive remedy, except where law requires otherwise."
  },
  {
    label: "Food Safety & Liability",
    body:
      "Once an order is handed to the customer or the customer's designated pickup person, storage, transport, " +
      "refrigeration, and safe handling are the customer's responsibility. Vida Verde is not responsible for loss or quality issues " +
      "caused by delayed pickup or improper handling after pickup, and total liability will not exceed the amount paid for the order " +
      "to the extent permitted by law."
  },
  {
    label: "Changes & Cancellations",
    body:
      "Because production, packing, and inventory allocation begin quickly, cancellation requests, item changes, and pickup-date changes " +
      `are not guaranteed after payment. Customers should call or text ${MARKET_SUPPORT_PHONE_DISPLAY} as early as possible, ` +
      "and Vida Verde will work in good faith to accommodate needs in a fair and equitable manner when feasible. The pickup policy in effect on the order date applies to that order."
  }
];
export const MARKET_PICKUP_POLICY_BULLETS = MARKET_PICKUP_POLICY_ITEMS.map(
  (item) => `${item.label}: ${item.body}`
);
export const MARKET_PICKUP_POLICY_NOTES = [
  WEATHER_CLOSURE_NOTICE,
  MARKET_UPDATES_NOTICE,
  PICKUP_HELP_NOTICE,
  MISSED_PICKUP_NOTICE,
  FAIR_SERVICE_NOTICE,
  LIMITED_REMEDY_NOTICE
];

const toDateKeyUTC = (date) => date.toISOString().slice(0, 10);
const addDaysUTC = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const getPartValue = (parts, type) => {
  return parts.find((part) => part.type === type)?.value || "";
};

export const getDatePartsInTimezone = (date, timeZone = MARKET_TIMEZONE) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);

  return {
    year: Number.parseInt(getPartValue(parts, "year"), 10),
    month: Number.parseInt(getPartValue(parts, "month"), 10),
    day: Number.parseInt(getPartValue(parts, "day"), 10),
    weekday: getPartValue(parts, "weekday").toLowerCase(),
    hour: Number.parseInt(getPartValue(parts, "hour"), 10),
    minute: Number.parseInt(getPartValue(parts, "minute"), 10),
    second: Number.parseInt(getPartValue(parts, "second"), 10)
  };
};

export const getDateKeyInTimezone = (date, timeZone = MARKET_TIMEZONE) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  const parts = formatter.formatToParts(date);

  return [
    getPartValue(parts, "year"),
    getPartValue(parts, "month"),
    getPartValue(parts, "day")
  ].join("-");
};

const getTimeZoneOffsetMinutes = (date, timeZone = MARKET_TIMEZONE) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
    hour: "2-digit",
    hourCycle: "h23"
  });
  const parts = formatter.formatToParts(date);
  const offsetText = getPartValue(parts, "timeZoneName");
  const match = OFFSET_PATTERN.exec(offsetText);

  if (!match?.groups?.sign) {
    return 0;
  }

  const sign = match.groups.sign === "-" ? -1 : 1;
  const hours = Number.parseInt(match.groups.hours || "0", 10);
  const minutes = Number.parseInt(match.groups.minutes || "0", 10);

  return sign * (hours * 60 + minutes);
};

const getUtcDateForLocalTime = (
  { year, month, day, hour = 0, minute = 0, second = 0 },
  timeZone = MARKET_TIMEZONE
) => {
  const utcGuess = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, timeZone);

  return new Date(utcGuess.getTime() - offsetMinutes * 60_000);
};

const formatMarketDateTime = (value, timeZone = MARKET_TIMEZONE) => {
  if (!value) return "";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })
    .format(date)
    .replace(" AM", "am")
    .replace(" PM", "pm");
};

export const getCurrentMarketWeekInfo = (
  timeZone = MARKET_TIMEZONE,
  now = new Date(),
  {
    marketRollHour = MARKET_CUTOFF_HOUR,
    collectionStartHour = MARKET_CUTOFF_HOUR
  } = {}
) => {
  const parts = getDatePartsInTimezone(now, timeZone);
  const weekdayPrefix = (parts.weekday || "").slice(0, 3);
  const weekdayIndex = WEEKDAY_INDEX[weekdayPrefix] ?? 0;
  const daysUntilSaturday = (WEEKDAY_INDEX.sat - weekdayIndex + 7) % 7;

  let marketDate = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  marketDate = addDaysUTC(marketDate, daysUntilSaturday);

  if (weekdayIndex === WEEKDAY_INDEX.sat && parts.hour >= marketRollHour) {
    marketDate = addDaysUTC(marketDate, 7);
  }

  const collectionStartDate = addDaysUTC(marketDate, -7);
  const collectionStartAt = getUtcDateForLocalTime(
    {
      year: collectionStartDate.getUTCFullYear(),
      month: collectionStartDate.getUTCMonth() + 1,
      day: collectionStartDate.getUTCDate(),
      hour: collectionStartHour
    },
    timeZone
  );
  const collectionEndAt = getUtcDateForLocalTime(
    {
      year: marketDate.getUTCFullYear(),
      month: marketDate.getUTCMonth() + 1,
      day: marketDate.getUTCDate(),
      hour: collectionStartHour
    },
    timeZone
  );
  const collectionDisplayEndAt = new Date(collectionEndAt.getTime() - MINUTE_IN_MS);
  const collectionStartLabel = formatMarketDateTime(collectionStartAt, timeZone);
  const collectionEndLabel = formatMarketDateTime(collectionDisplayEndAt, timeZone);

  return {
    week_start_date: toDateKeyUTC(collectionStartDate),
    week_end_date: toDateKeyUTC(marketDate),
    market_date: toDateKeyUTC(marketDate),
    collection_start_at: collectionStartAt.toISOString(),
    collection_end_at: collectionEndAt.toISOString(),
    collection_start_label: collectionStartLabel,
    collection_end_label: collectionEndLabel,
    collection_window_label:
      collectionStartLabel && collectionEndLabel
        ? `${collectionStartLabel} to ${collectionEndLabel}`
        : ""
  };
};

export const getPrepSheetWeekInfo = (
  timeZone = MARKET_TIMEZONE,
  now = new Date()
) =>
  getCurrentMarketWeekInfo(timeZone, now, {
    marketRollHour: PREP_SHEET_ROLL_HOUR,
    collectionStartHour: MARKET_CUTOFF_HOUR
  });

export const formatMarketDate = (
  dateKey,
  timeZone = MARKET_TIMEZONE
) => {
  if (!dateKey) return "";

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(new Date(`${dateKey}T12:00:00Z`));
};

export const getPickupDetails = ({
  timeZone = MARKET_TIMEZONE,
  now = new Date()
} = {}) => {
  const weekInfo = getCurrentMarketWeekInfo(timeZone, now);

  return {
    market_name: MARKET_NAME,
    market_address: MARKET_ADDRESS,
    pickup_window: MARKET_PICKUP_WINDOW,
    same_day_cutoff_label: SAME_DAY_PICKUP_CUTOFF_LABEL,
    timezone: timeZone,
    market_date: weekInfo.market_date,
    market_date_label: formatMarketDate(weekInfo.market_date, timeZone),
    policy_lines: [
      "Pickup orders are reserved only after payment is successfully processed.",
      SAME_DAY_PICKUP_NOTICE,
      FOLLOWING_WEEK_PICKUP_NOTICE,
      MISSED_PICKUP_NOTICE,
      WEATHER_CLOSURE_NOTICE,
      PICKUP_TRANSFER_NOTICE
    ]
  };
};
