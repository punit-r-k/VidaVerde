import {
  MARKET_ADDRESS,
  MARKET_NAME,
  MARKET_TIMEZONE,
  getPickupDetails
} from "@/lib/pickupDetails";

const SUPPORT_PHONE_DISPLAY = "(713) 478-1878";
const ICS_PROD_ID = "-//Vida Verde//Pickup Calendar//EN";
const OFFSET_PATTERN = /^GMT(?:(?<sign>[+-])(?<hours>\d{1,2})(?::(?<minutes>\d{2}))?)?$/;
const FULL_PICKUP_WINDOW_LABEL = "9:00 AM-1:00 PM";

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);

const pad = (value) => String(value).padStart(2, "0");

const formatUtcDateTime = (date) => {
  const normalized = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(normalized.getTime())) return "";

  return [
    normalized.getUTCFullYear(),
    pad(normalized.getUTCMonth() + 1),
    pad(normalized.getUTCDate())
  ].join("") +
    "T" +
    [
      pad(normalized.getUTCHours()),
      pad(normalized.getUTCMinutes()),
      pad(normalized.getUTCSeconds())
    ].join("") +
    "Z";
};

const getPartValue = (parts, type) => parts.find((part) => part.type === type)?.value || "";

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

const parseDateKey = (dateKey) => {
  const text = toText(dateKey, 32);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;

  return {
    year: Number.parseInt(match[1], 10),
    month: Number.parseInt(match[2], 10),
    day: Number.parseInt(match[3], 10)
  };
};

const escapeIcsText = (value) =>
  String(value || "")
    .replaceAll("\\", "\\\\")
    .replaceAll("\r\n", "\\n")
    .replaceAll("\n", "\\n")
    .replaceAll(",", "\\,")
    .replaceAll(";", "\\;");

const foldIcsLine = (line) => {
  const text = String(line || "");
  if (text.length <= 73) return text;

  const segments = [];
  let cursor = 0;

  while (cursor < text.length) {
    const width = cursor === 0 ? 73 : 72;
    segments.push(text.slice(cursor, cursor + width));
    cursor += width;
  }

  return segments.join("\r\n ");
};

const formatItemQuantityLines = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => {
      const quantity = Number.parseInt(item?.quantity, 10) || 0;
      const name = toText(item?.name, 120) || toText(item?.sku, 32);
      if (!name || quantity <= 0) return "";
      return `- ${name} x${quantity}`;
    })
    .filter(Boolean);

const buildIcs = ({ uid, createdAt, summary, description, location, startsAt, endsAt }) => {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${ICS_PROD_ID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${formatUtcDateTime(createdAt)}`,
    `DTSTART:${formatUtcDateTime(startsAt)}`,
    `DTEND:${formatUtcDateTime(endsAt)}`,
    `SUMMARY:${escapeIcsText(summary)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    `LOCATION:${escapeIcsText(location)}`,
    "STATUS:CONFIRMED",
    "TRANSP:OPAQUE",
    "END:VEVENT",
    "END:VCALENDAR"
  ];

  return lines.map(foldIcsLine).join("\r\n");
};

const buildPickupInviteFilename = (marketDate) =>
  `vida-verde-pickup-${toText(marketDate, 32) || "event"}.ics`;

export const buildPickupCalendarInvite = ({
  orderId,
  pickupDetails,
  readyItems,
  pendingItems,
  timeZone = MARKET_TIMEZONE
} = {}) => {
  const normalizedOrderId = toText(orderId, 64);
  const normalizedPickupDetails = pickupDetails || getPickupDetails({ timeZone, now: new Date() });
  const marketDateParts = parseDateKey(normalizedPickupDetails?.market_date);

  if (!normalizedOrderId || !marketDateParts) {
    return null;
  }

  const startsAt = getUtcDateForLocalTime(
    {
      ...marketDateParts,
      hour: 9,
      minute: 0,
      second: 0
    },
    timeZone
  );
  const endsAt = getUtcDateForLocalTime(
    {
      ...marketDateParts,
      hour: 13,
      minute: 0,
      second: 0
    },
    timeZone
  );

  const readyLines = formatItemQuantityLines(readyItems);
  const pendingLines = formatItemQuantityLines(pendingItems);
  const summary = `Vida Verde Pickup at ${toText(normalizedPickupDetails?.market_name, 120) || MARKET_NAME}`;
  const description = [
    "Your Vida Verde pickup is scheduled during the full market window.",
    `Pickup time: ${FULL_PICKUP_WINDOW_LABEL}`,
    `Market: ${toText(normalizedPickupDetails?.market_name, 120) || MARKET_NAME}`,
    `Address: ${toText(normalizedPickupDetails?.market_address, 160) || MARKET_ADDRESS}`,
    "",
    readyLines.length > 0
      ? ["Ready for pickup:", ...readyLines].join("\n")
      : "Ready for pickup: No items are currently assigned to this pickup.",
    pendingLines.length > 0
      ? [
          "Still not ready yet:",
          ...pendingLines,
          "We will send another update when the remaining items are ready."
        ].join("\n")
      : "Everything in this order is ready for pickup.",
    "",
    `If you need help, text ${SUPPORT_PHONE_DISPLAY}.`
  ].join("\n");
  const uid = `pickup-${normalizedOrderId}-${toText(normalizedPickupDetails?.market_date, 32)}@vidaverde`;
  const content = buildIcs({
    uid,
    createdAt: new Date(),
    summary,
    description,
    location: toText(normalizedPickupDetails?.market_address, 160) || MARKET_ADDRESS,
    startsAt,
    endsAt
  });

  return {
    filename: buildPickupInviteFilename(normalizedPickupDetails?.market_date),
    content,
    contentType: "text/calendar; charset=utf-8; method=PUBLISH",
    contentDisposition: "attachment"
  };
};
