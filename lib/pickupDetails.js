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
export const MARKET_PICKUP_SUMMARY = "Reserve online, then pick up on site.";

const MARKET_CUTOFF_HOUR = 8;
const PREP_SHEET_ROLL_HOUR = 14;
const MINUTE_IN_MS = 60_000;
const OFFSET_PATTERN = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/;

export const SAME_DAY_PICKUP_NOTICE =
  `If stock is available, you can reserve a jar or bottle through ${SAME_DAY_PICKUP_CUTOFF_LABEL} ` +
  "for pickup that same day.";
export const SAME_DAY_PICKUP_EXAMPLE_NOTICE =
  "A reservation placed at 7:59am Saturday still qualifies for same-day pickup.";
export const FOLLOWING_WEEK_PICKUP_NOTICE =
  `Reservations placed after ${SAME_DAY_PICKUP_CUTOFF_LABEL} roll to the following available week.`;
export const WEATHER_CLOSURE_NOTICE =
  "The market can close due to weather conditions. If that happens, customers with reservations will be notified before the market begins.";
export const MARKET_UPDATES_NOTICE =
  `Please stay up to date with ${MARKET_NAME} availability, as they may announce closures before we do.`;
export const MARKET_PICKUP_NOTE_LINES = [
  `Every Saturday, ${MARKET_PICKUP_WINDOW}`,
  `In-stock orders placed by ${SAME_DAY_PICKUP_CUTOFF_LABEL} qualify for same-day pickup.`,
  "Later orders move to the next available week.",
  `Weather closures: reserved orders will be notified. Check ${MARKET_NAME} for updates.`
];
export const MARKET_PICKUP_POLICY_BULLETS = [
  `In-stock orders placed by ${SAME_DAY_PICKUP_CUTOFF_LABEL} qualify for same-day pickup.`,
  "Later orders move to the next available week."
];
export const MARKET_PICKUP_POLICY_NOTES = [
  WEATHER_CLOSURE_NOTICE,
  MARKET_UPDATES_NOTICE
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
      SAME_DAY_PICKUP_NOTICE,
      SAME_DAY_PICKUP_EXAMPLE_NOTICE,
      FOLLOWING_WEEK_PICKUP_NOTICE,
      WEATHER_CLOSURE_NOTICE,
      MARKET_UPDATES_NOTICE
    ]
  };
};
