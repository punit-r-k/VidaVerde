import { getShippingChargeBreakdown } from "@/lib/shippingCharge";
import {
  getLatestExpectedDeliveryDate,
  getShippingTransitWindow,
  SHIPPING_SCHEDULE_TIME_ZONE
} from "@/lib/shippingPricing";
import { getEasyPostQuotes } from "@/lib/shippingQuotes";
import {
  chooseFastestQuote,
  getQuoteLatestDeliveryDate,
  getQuoteTransitDays
} from "@/lib/shippingRateRanking";

const formatTransitDays = (days) => {
  if (!Number.isFinite(days)) return "Delivery timing will be confirmed after checkout";
  return `${days} business ${days === 1 ? "day" : "days"}`;
};

const getScheduleDateKey = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date).reduce((result, part) => {
    if (part.type !== "literal") result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};

const formatExpectedArrivalDate = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
};

export async function selectCheckoutShippingQuote({
  customer,
  itemsPayload,
  requestedOption,
  hasPreorderItems = false,
  orderCreatedAt = new Date(),
  ratingContext
}) {
  const transitWindow = getShippingTransitWindow(requestedOption?.id);
  const quotes = await getEasyPostQuotes({
    customer_name: customer?.name || "Vida Verde Customer",
    customer_email: customer?.email || undefined,
    customer_phone: customer?.phone || undefined,
    address1: customer?.address1,
    address2: customer?.address2,
    city: customer?.city,
    state: customer?.state,
    postal_code: customer?.postalCode,
    country: customer?.country || "US",
    items_json: itemsPayload,
    created_at: orderCreatedAt.toISOString()
  }, {
    transitWindow,
    serviceLevel: requestedOption?.id,
    ratingContext
  });
  const quote = chooseFastestQuote(quotes);
  if (!quote) throw new Error("EasyPost returned no shipping rates.");

  const charge = getShippingChargeBreakdown(quote);
  if (charge.amountCents <= 0) {
    throw new Error("EasyPost returned an invalid shipping total.");
  }

  const deliveryDays = getQuoteTransitDays(quote);
  const transitDaysLabel = formatTransitDays(deliveryDays);
  const option = {
    ...requestedOption,
    amountCents: charge.amountCents,
    transitLabel: `Estimated delivery: ${transitDaysLabel}.`,
    deliveryEstimate: Number.isFinite(deliveryDays)
      ? {
          minimum: { unit: "business_day", value: deliveryDays },
          maximum: { unit: "business_day", value: deliveryDays }
        }
      : requestedOption?.deliveryEstimate
  };

  let expectedArrivalDate = hasPreorderItems
    ? null
    : getQuoteLatestDeliveryDate(quote);
  expectedArrivalDate = expectedArrivalDate || getLatestExpectedDeliveryDate({
    orderDate: orderCreatedAt,
    shippingOption: option,
    hasPreorderItems
  });
  const expectedArrivalDateKey = getScheduleDateKey(expectedArrivalDate);
  const expectedArrivalLabel = formatExpectedArrivalDate(expectedArrivalDate);
  if (expectedArrivalLabel) {
    option.transitLabel = `Expected arrival: ${expectedArrivalLabel}.`;
  }

  return {
    quote,
    charge,
    option,
    deliveryDays,
    expectedArrivalDate,
    expectedArrivalDateKey,
    expectedArrivalLabel
  };
}
