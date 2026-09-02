import { getShippingChargeBreakdown } from "./shippingCharge.js";
import {
  EXPEDITED_SHIPPING_OPTION_ID,
  getEstimatedShipDate,
  getLatestExpectedDeliveryDate,
  getShippingTransitWindow,
  NORMAL_SHIPPING_OPTION_ID,
  SHIPPING_SCHEDULE_TIME_ZONE
} from "./shippingPricing.js";
import { resolveCustomerShippingSelections } from "./shippingOptionPolicy.js";
import {
  getEasyPostQuotes,
  getEasyPostQuotesForServiceLevels
} from "./shippingQuotes.js";
import {
  chooseFastestQuote,
  getQuoteLatestDeliveryDate,
  getQuoteTransitDays
} from "./shippingRateRanking.js";

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

const buildCheckoutShipment = ({ customer, itemsPayload, orderCreatedAt }) => ({
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
});

const buildCheckoutSelection = ({
  quotes,
  itemsPayload,
  requestedOption,
  hasPreorderItems = false,
  orderCreatedAt = new Date()
}) => {
  const quote = chooseFastestQuote(quotes);
  if (!quote) return null;

  const itemCount = (Array.isArray(itemsPayload) ? itemsPayload : []).reduce(
    (sum, item) => sum + Math.max(0, Number.parseInt(item?.quantity, 10) || 0),
    0
  );
  const subtotalCents = (Array.isArray(itemsPayload) ? itemsPayload : []).reduce(
    (sum, item) =>
      sum +
      Math.max(0, Number.parseInt(item?.quantity, 10) || 0) *
        Math.max(0, Number.parseInt(item?.price_cents, 10) || 0),
    0
  );
  const charge = getShippingChargeBreakdown(quote, {
    subtotalCents,
    itemCount,
    serviceLevel: requestedOption?.id
  });
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
  const estimatedShipDate = getEstimatedShipDate({
    orderDate: orderCreatedAt,
    hasPreorderItems
  });
  const estimatedShipDateKey = getScheduleDateKey(estimatedShipDate);
  const estimatedShipDateLabel = formatExpectedArrivalDate(estimatedShipDate);

  return {
    quote,
    charge,
    option,
    deliveryDays,
    estimatedShipDate,
    estimatedShipDateKey,
    estimatedShipDateLabel,
    expectedArrivalDate,
    expectedArrivalDateKey,
    expectedArrivalLabel
  };
};

export async function selectCheckoutShippingQuote({
  customer,
  itemsPayload,
  requestedOption,
  hasPreorderItems = false,
  orderCreatedAt = new Date(),
  ratingContext
}) {
  const quotes = await getEasyPostQuotes(
    buildCheckoutShipment({ customer, itemsPayload, orderCreatedAt }),
    {
      transitWindow: getShippingTransitWindow(requestedOption?.id),
      serviceLevel: requestedOption?.id,
      ratingContext
    }
  );
  const selection = buildCheckoutSelection({
    quotes,
    itemsPayload,
    requestedOption,
    hasPreorderItems,
    orderCreatedAt
  });
  if (!selection) throw new Error("EasyPost returned no shipping rates.");
  return selection;
}

export async function selectCheckoutShippingOptions({
  customer,
  itemsPayload,
  normalOption,
  expeditedOption,
  hasPreorderItems = false,
  orderCreatedAt = new Date(),
  ratingContext
}) {
  const quotesByServiceLevel = await getEasyPostQuotesForServiceLevels(
    buildCheckoutShipment({ customer, itemsPayload, orderCreatedAt }),
    {
      serviceLevels: [normalOption, expeditedOption].map((option) => ({
        serviceLevel: option.id,
        transitWindow: getShippingTransitWindow(option.id)
      })),
      ratingContext
    }
  );
  const normalSelection = buildCheckoutSelection({
    quotes: quotesByServiceLevel[NORMAL_SHIPPING_OPTION_ID],
    itemsPayload,
    requestedOption: normalOption,
    hasPreorderItems,
    orderCreatedAt
  });
  const expeditedSelection = buildCheckoutSelection({
    quotes: quotesByServiceLevel[EXPEDITED_SHIPPING_OPTION_ID],
    itemsPayload,
    requestedOption: expeditedOption,
    hasPreorderItems,
    orderCreatedAt
  });
  const resolved = resolveCustomerShippingSelections({
    normalSelection,
    expeditedSelection,
    normalOption
  });
  return [resolved.normalSelection, resolved.expeditedSelection].filter(Boolean);
}
