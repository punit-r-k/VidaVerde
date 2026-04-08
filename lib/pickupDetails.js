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

const getPartValue = (parts, type) => {
  return parts.find((part) => part.type === type)?.value || "";
};

export const getDatePartsInTimezone = (date, timeZone = MARKET_TIMEZONE) => {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short"
  });
  const parts = formatter.formatToParts(date);

  return {
    year: Number.parseInt(getPartValue(parts, "year"), 10),
    month: Number.parseInt(getPartValue(parts, "month"), 10),
    day: Number.parseInt(getPartValue(parts, "day"), 10),
    weekday: getPartValue(parts, "weekday").toLowerCase()
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

export const getCurrentMarketWeekInfo = (
  timeZone = MARKET_TIMEZONE,
  now = new Date()
) => {
  const parts = getDatePartsInTimezone(now, timeZone);
  const weekdayPrefix = (parts.weekday || "").slice(0, 3);
  const weekdayIndex = WEEKDAY_INDEX[weekdayPrefix] ?? 0;
  const daysFromMonday = (weekdayIndex + 6) % 7;

  const monday = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day - daysFromMonday)
  );
  const saturday = new Date(monday);
  saturday.setUTCDate(monday.getUTCDate() + 5);
  const sunday = new Date(monday);
  sunday.setUTCDate(monday.getUTCDate() + 6);

  return {
    week_start_date: toDateKeyUTC(monday),
    week_end_date: toDateKeyUTC(sunday),
    market_date: toDateKeyUTC(saturday)
  };
};

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
