import { sendMail, emailConfig } from "@/lib/email";
import { getConsumerShippingDetails } from "@/lib/consumerShipping";
import { buildPickupCalendarInvite } from "@/lib/pickupCalendarInvite";
import { getPickupDetails } from "@/lib/pickupDetails";
import { getProductMap } from "@/lib/products";
import {
  getEstimatedShipDate,
  SHIPPING_SCHEDULE_TIME_ZONE
} from "@/lib/shippingPricing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPreferredTrackingNumbers } from "@/lib/trackingNumbers";
import { isEasyPostTestMode } from "@/lib/easypost";

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);
const siteUrl = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
const configuredBannerUrl = String(process.env.ORDER_EMAIL_BANNER_URL || "").trim();
const bannerUrl =
  configuredBannerUrl || (siteUrl ? `${siteUrl}/email/order-confirmation-banner.png` : "");

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const normalizeCurrency = (value) => {
  const currency = String(value || "USD").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(currency) ? currency : "USD";
};

const formatMoney = (amountCents, currency) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: normalizeCurrency(currency)
  }).format((Number(amountCents) || 0) / 100);

const formatScheduleDate = (date, referenceDate = new Date()) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";

  const options = {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE
  };
  const yearFormatter = new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE
  });

  if (yearFormatter.format(date) !== yearFormatter.format(referenceDate)) {
    options.year = "numeric";
  }

  return new Intl.DateTimeFormat("en-US", options).format(date);
};

const parseScheduleDateKey = (value) => {
  const dateKey = toText(value, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const date = new Date(`${dateKey}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
};

const formatFulfillmentLabel = (value) =>
  value === "market" ? "Farmers market pickup" : "Shipping";

const compareItems = (left, right) =>
  toText(left?.name, 120).localeCompare(toText(right?.name, 120), undefined, {
    sensitivity: "base"
  }) || toText(left?.sku, 32).localeCompare(toText(right?.sku, 32), undefined, {
    sensitivity: "base"
  });

const addItemToMap = (itemsMap, item) => {
  if (!(itemsMap instanceof Map) || !item) return;

  const sku = toText(item?.sku, 32).toUpperCase();
  const quantity = Number.parseInt(item?.quantity, 10) || 0;
  const name = toText(item?.name, 120) || sku;
  if (!sku || quantity <= 0) return;

  const existing = itemsMap.get(sku);
  if (existing) {
    existing.quantity += quantity;
    if (!toText(existing.name, 120)) {
      existing.name = name;
    }
    return;
  }

  itemsMap.set(sku, {
    sku,
    name,
    quantity
  });
};

const mapToSortedItems = (itemsMap) =>
  [...(itemsMap instanceof Map ? itemsMap.values() : [])].sort(compareItems);

const formatItemQuantityLines = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => {
      const quantity = Number.parseInt(item?.quantity, 10) || 0;
      const name = toText(item?.name, 120) || toText(item?.sku, 32);
      if (!name || quantity <= 0) return "";
      return `- ${name} x${quantity}`;
    })
    .filter(Boolean);

const formatPhoneNumber = (value) => {
  const raw = toText(value, 64);
  if (!raw) return "";

  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }

  if (digits.length === 11 && digits.startsWith("1")) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }

  return raw;
};

const SUPPORT_PHONE_RAW = "7134781878";
const SUPPORT_PHONE_DISPLAY = formatPhoneNumber(SUPPORT_PHONE_RAW);
const EMAIL_SIGN_OFF = "Stay cultured,";
const EMAIL_SIGN_OFF_NAME = "The Vida Verde Team";
export const ORDER_CONFIRMATION_BCC_RECIPIENTS = Object.freeze([
  "punit@peridotkonda.com",
  "vidaverdemicrogreens@gmail.com",
  "vvsauerkraut@gmail.com"
]);
export const ORDER_CONFIRMATION_TRACKING_STATES = Object.freeze({
  AVAILABLE: "available",
  PENDING: "pending",
  PREORDER_PENDING: "preorder_pending",
  TEST_NOT_APPLICABLE: "test_not_applicable"
});
const PREORDER_ONLY_TIMING_NOTICE =
  "Pre-order timing is not guaranteed for the next market because fermentation and restock timing can vary.";
const MIXED_ORDER_TIMING_NOTICE =
  "Your reservation items are confirmed for the pickup date below. Your pre-ordered items are still in progress and will likely be ready on a different market day.";
const SHIPPING_PREORDER_ONLY_TIMING_NOTICE =
  "Pre-order timing is not guaranteed because fermentation and restock timing can vary. Once the order is ready, it will ship on the next Wednesday.";
const SHIPPING_MIXED_ORDER_TIMING_NOTICE =
  "Your in-stock items are reserved. We will ship the order after the pre-ordered items are ready unless we contact you about a split shipment.";

const buildPreorderFollowUpMessage = (marketName) =>
  `We are not assigning a pickup date yet. We will send a follow-up email once your items are restocked. In that email, you can confirm whether you are able to come to the next ${toText(
    marketName,
    120
  )} pickup or let us know if you are not.`;

const buildMixedOrderFollowUpMessage = (marketName) =>
  `We will send another email as soon as your pre-ordered items come back in stock with the next ${toText(
    marketName,
    120
  )} pickup date for those items.`;

const buildShippingPreorderFollowUpMessage = () =>
  "We will send another email once your pre-ordered items are restocked, then prepare the shipment and send its tracking number.";

const buildAddressLines = (customer) =>
  [
    toText(customer?.name, 120),
    toText(customer?.address1, 120),
    toText(customer?.address2, 120),
    [customer?.city, customer?.state, customer?.postal_code]
      .map((part) => toText(part, 64))
      .filter(Boolean)
      .join(", ")
  ].filter(Boolean);

const buildCustomerLines = (customer) =>
  [
    toText(customer?.name, 120),
    toText(customer?.email, 254),
    formatPhoneNumber(customer?.phone)
  ].filter(Boolean);

const buildShippingLines = (
  customer,
  addressLines,
  {
    estimatedShipDateText = "",
    expectedArrivalText = "",
    hasPreorderItems = false
  } = {}
) => {
  const shippingOption = getConsumerShippingDetails(customer);
  const shipDateLabel = hasPreorderItems
    ? "Estimated ship date after preorder window"
    : "Estimated ship date";
  const lines = [
    `Method: ${shippingOption.label}`,
    estimatedShipDateText ? `${shipDateLabel}: ${estimatedShipDateText}` : "",
    `Expected arrival: ${expectedArrivalText || shippingOption.expectedArrivalText}`,
    "When it arrives: Open and inspect the package. Refrigerate upon arrival, then carefully burp each jar to release any existing gas."
  ].filter(Boolean);

  if (addressLines.length > 0) {
    lines.push("Ship to:");
    lines.push(...addressLines.map((line) => `  ${line}`));
  }

  return lines;
};

export const resolveOrderConfirmationTrackingState = ({
  fulfillment,
  isTestOrder = false,
  allowTestShipping = false,
  hasPreorderItems = false,
  trackingNumbers = []
} = {}) => {
  if (fulfillment !== "ship") return null;
  if (Array.isArray(trackingNumbers) && trackingNumbers.length > 0) {
    return ORDER_CONFIRMATION_TRACKING_STATES.AVAILABLE;
  }
  if (isTestOrder && !allowTestShipping) {
    return ORDER_CONFIRMATION_TRACKING_STATES.TEST_NOT_APPLICABLE;
  }
  if (hasPreorderItems) {
    return ORDER_CONFIRMATION_TRACKING_STATES.PREORDER_PENDING;
  }
  return ORDER_CONFIRMATION_TRACKING_STATES.PENDING;
};

const getPickupScenario = (fulfillment, preorderStatus) => {
  if (fulfillment !== "market") return "shipping";

  if (preorderStatus?.hasMixedReservationAndPreorderItems) {
    return "mixed";
  }

  if (preorderStatus?.hasPreorderItems) {
    return "preorder_only";
  }

  return "standard";
};

const buildPickupLines = (pickupDetails, { pickupScenario = "standard" } = {}) => {
  if (!pickupDetails) return [];

  const lines = [
    `Market: ${toText(pickupDetails.market_name, 120)}`,
    `Address: ${toText(pickupDetails.market_address, 160)}`,
    `Pickup window: ${toText(pickupDetails.pickup_window, 64)}`
  ];

  if (pickupScenario === "preorder_only") {
    lines.push(
      `Restock follow-up: ${buildPreorderFollowUpMessage(pickupDetails.market_name)}`
    );
  } else {
    lines.push(`Pickup date: ${toText(pickupDetails.market_date_label, 120)}`);
  }

  return lines.filter(Boolean);
};

const buildPickupNotice = (pickupDetails, pickupScenario) => {
  if (!pickupDetails || pickupScenario === "standard" || pickupScenario === "shipping") {
    return null;
  }

  if (pickupScenario === "mixed") {
    return {
      title: "Pre-ordered items",
      lines: [
        MIXED_ORDER_TIMING_NOTICE,
        buildMixedOrderFollowUpMessage(pickupDetails.market_name)
      ]
    };
  }

  return {
    title: "Pre-order timing",
    lines: [
      PREORDER_ONLY_TIMING_NOTICE,
      buildPreorderFollowUpMessage(pickupDetails.market_name)
    ]
  };
};

const formatTextSummaryLine = (label, amount) => {
  return `${String(label || "").padEnd(12, " ")} ${amount}`;
};

const enrichItems = async (items) => {
  const normalizedItems = (Array.isArray(items) ? items : [])
    .map((item) => ({
      sku: toText(item?.sku, 32).toUpperCase(),
      quantity: Number.parseInt(item?.quantity, 10) || 0,
      price_cents: Number.parseInt(item?.price_cents, 10) || 0
    }))
    .filter((item) => item.sku && item.quantity > 0);

  if (normalizedItems.length === 0) {
    return [];
  }

  const productMap = await getProductMap(normalizedItems.map((item) => item.sku));

  return normalizedItems.map((item) => ({
    ...item,
    name: toText(productMap.get(item.sku)?.name || item.sku, 120)
  }));
};

const EMPTY_PREORDER_STATUS = {
  error: null,
  hasPreorderItems: false,
  hasReadyReservationItems: false,
  hasMixedReservationAndPreorderItems: false,
  readyReservationItems: [],
  preorderItems: []
};

const getAuthoritativeOrderEmailContext = async (orderId) => {
  const normalizedOrderId = toText(orderId, 36);
  if (!normalizedOrderId) {
    return {
      ok: false,
      code: "invalid_payload",
      error: new Error("Order ID is required for confirmation delivery.")
    };
  }
  if (!supabaseAdmin) {
    return {
      ok: false,
      code: "dependency_unavailable",
      error: new Error("Order confirmation storage is not connected.")
    };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("fulfillment, is_test_order, status, stripe_fulfillment_retired_at")
      .eq("id", normalizedOrderId)
      .maybeSingle();

    if (error) throw error;
    if (!data) {
      return {
        ok: false,
        code: "invalid_payload",
        error: new Error("The order could not be found for confirmation delivery.")
      };
    }

    const status = toText(data.status, 32).toLowerCase();
    if (status !== "paid" || data.stripe_fulfillment_retired_at) {
      return {
        ok: false,
        code: "order_ineligible",
        error: new Error("The order is not eligible for confirmation delivery.")
      };
    }

    return {
      ok: true,
      fulfillment: data.fulfillment === "market" ? "market" : "ship",
      isTestOrder: data.is_test_order === true,
      status
    };
  } catch (error) {
    console.error("order confirmation context lookup error:", error);
    return {
      ok: false,
      code: "dependency_unavailable",
      error: error instanceof Error
        ? error
        : new Error(error?.message || "Order confirmation lookup failed.")
    };
  }
};

const getOrderPreorderStatus = async (orderId) => {
  const normalizedOrderId = toText(orderId, 36);
  if (!normalizedOrderId) {
    return {
      ...EMPTY_PREORDER_STATUS,
      error: new Error("Order ID is required for preorder lookup.")
    };
  }
  if (!supabaseAdmin) {
    return {
      ...EMPTY_PREORDER_STATUS,
      error: new Error("Order preorder storage is not connected.")
    };
  }

  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("sku, quantity, preorder_qty, products(name)")
    .eq("order_id", normalizedOrderId);

  if (error) {
    console.error("order confirmation preorder lookup error:", error);
    return {
      ...EMPTY_PREORDER_STATUS,
      error: error instanceof Error
        ? error
        : new Error(error?.message || "Order preorder lookup failed.")
    };
  }

  const readyReservationItemsMap = new Map();
  const preorderItemsMap = new Map();
  const status = (data || []).reduce(
    (acc, item) => {
      const sku = toText(item?.sku, 32).toUpperCase();
      const quantity = Math.max(Number.parseInt(item?.quantity, 10) || 0, 0);
      const preorderQty = Math.min(
        Math.max(Number.parseInt(item?.preorder_qty, 10) || 0, 0),
        quantity
      );
      const readyReservationQty = Math.max(quantity - preorderQty, 0);
      const productData = Array.isArray(item?.products) ? item.products[0] : item?.products;
      const name = toText(productData?.name, 120) || sku;

      if (preorderQty > 0) {
        acc.hasPreorderItems = true;
        addItemToMap(preorderItemsMap, {
          sku,
          name,
          quantity: preorderQty
        });
      }

      if (readyReservationQty > 0) {
        acc.hasReadyReservationItems = true;
        addItemToMap(readyReservationItemsMap, {
          sku,
          name,
          quantity: readyReservationQty
        });
      }

      return acc;
    },
    { ...EMPTY_PREORDER_STATUS }
  );

  return {
    ...status,
    readyReservationItems: mapToSortedItems(readyReservationItemsMap),
    preorderItems: mapToSortedItems(preorderItemsMap),
    hasMixedReservationAndPreorderItems:
      status.hasPreorderItems && status.hasReadyReservationItems
  };
};

const getOrderTrackingNumbers = async (orderId) => {
  const normalizedOrderId = toText(orderId, 36);
  if (!normalizedOrderId) {
    return { numbers: [], error: new Error("Order ID is required for tracking lookup.") };
  }
  if (!supabaseAdmin) {
    return { numbers: [], error: new Error("Shipment tracking is not connected.") };
  }

  try {
    const { data, error } = await supabaseAdmin
      .from("shipments")
      .select(
        "tracking_number, shipment_parcels(parcel_index, tracking_number, shipment_quotes(quote_json))"
      )
      .eq("order_id", normalizedOrderId)
      .maybeSingle();

    if (error) throw error;

    const quoteTimings = (Array.isArray(data?.shipment_parcels)
      ? data.shipment_parcels
      : [])
      .map((parcel) => {
        const shipmentQuote = Array.isArray(parcel?.shipment_quotes)
          ? parcel.shipment_quotes[0]
          : parcel?.shipment_quotes;
        return shipmentQuote?.quote_json || null;
      })
      .filter(Boolean);
    const latestDateKey = (field) => quoteTimings
      .map((quote) => toText(quote?.[field], 10))
      .filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))
      .sort()
      .at(-1) || "";

    return {
      numbers: getPreferredTrackingNumbers({
        parcels: data?.shipment_parcels,
        aggregateTrackingNumber: data?.tracking_number
      }),
      estimatedShipDate: latestDateKey("estimatedShipDate"),
      expectedArrivalDate: latestDateKey("expectedArrivalDate"),
      error: null
    };
  } catch (error) {
    console.error("order confirmation tracking lookup error:", error);
    return {
      numbers: [],
      estimatedShipDate: "",
      expectedArrivalDate: "",
      error: error instanceof Error
        ? error
        : new Error(error?.message || "Shipment tracking lookup failed.")
    };
  }
};

const getOrderPickupContext = ({ fulfillment, placedAt, preorderStatus, items }) => {
  const orderPlacedAt = placedAt ? new Date(placedAt) : new Date();
  const pickupDetails =
    fulfillment === "market"
      ? getPickupDetails({
          now: Number.isNaN(orderPlacedAt.getTime()) ? new Date() : orderPlacedAt
        })
      : null;
  const pickupScenario = getPickupScenario(fulfillment, preorderStatus);
  const calendarReadyItems =
    pickupScenario === "mixed"
      ? preorderStatus?.readyReservationItems || []
      : pickupScenario === "standard"
        ? (Array.isArray(items) ? items : []).map((item) => ({
            sku: item?.sku,
            name: item?.name,
            quantity: item?.quantity
          }))
        : [];
  const calendarPendingItems =
    pickupScenario === "mixed" || pickupScenario === "preorder_only"
      ? preorderStatus?.preorderItems || []
      : [];

  return {
    pickupDetails,
    pickupScenario,
    calendarReadyItems,
    calendarPendingItems
  };
};

export const buildEmailContent = ({
  orderId,
  fulfillment,
  currency,
  subtotal,
  tax,
  shipping,
  total,
  placedAt,
  receiptNumber,
  paymentMethodLabel,
  customer,
  items,
  preorderStatus,
  trackingNumbers = [],
  shipmentTiming = {},
  trackingState = null,
  pickupContext,
  hasPickupCalendarAttachment
}) => {
  const receiptNumberText = toText(receiptNumber, 120);
  const shortOrderId = toText(orderId, 36);
  const fulfillmentLabel = formatFulfillmentLabel(fulfillment);
  const paymentMethodText = toText(paymentMethodLabel, 120);
  const itemLines = items.map((item) => ({
    ...item,
    lineTotal: item.quantity * item.price_cents
  }));
  const readyReservationLines = formatItemQuantityLines(preorderStatus?.readyReservationItems);
  const preorderLines = formatItemQuantityLines(preorderStatus?.preorderItems);
  const customerLines = buildCustomerLines(customer);
  const isShipping = fulfillment !== "market";
  const hasPreorderBreakout = Boolean(preorderStatus?.hasPreorderItems);
  const hasMixedPreorderBreakout = Boolean(
    preorderStatus?.hasMixedReservationAndPreorderItems
  );
  const orderPlacedAt = placedAt ? new Date(placedAt) : new Date();
  const persistedEstimatedShipDate = parseScheduleDateKey(
    shipmentTiming?.estimatedShipDate
  );
  const estimatedShipDate = isShipping
    ? persistedEstimatedShipDate || getEstimatedShipDate({
        orderDate: orderPlacedAt,
        hasPreorderItems: hasPreorderBreakout
      })
    : null;
  const estimatedShipDateText = formatScheduleDate(estimatedShipDate, orderPlacedAt);
  const estimatedShipDateLabel = hasPreorderBreakout
    ? "Estimated ship date after preorder window"
    : "Estimated ship date";
  const persistedExpectedArrival = parseScheduleDateKey(
    shipmentTiming?.expectedArrivalDate
  );
  const expectedArrivalText = persistedExpectedArrival
    ? formatScheduleDate(persistedExpectedArrival, orderPlacedAt)
    : "";
  const addressLines = fulfillment === "market" ? [] : buildAddressLines(customer);
  const shippingLines =
    fulfillment === "market"
      ? []
      : buildShippingLines(customer, addressLines, {
          estimatedShipDateText,
          expectedArrivalText,
          hasPreorderItems: hasPreorderBreakout
        });
  const canonicalShippingOption = getConsumerShippingDetails(customer);
  const shippingMethodLabel = canonicalShippingOption.label;
  const shippingTransitLabel = expectedArrivalText || canonicalShippingOption.expectedArrivalText;
  const normalizedTrackingNumbers = [...new Set(
    (Array.isArray(trackingNumbers) ? trackingNumbers : [])
      .map((value) => toText(value, 120))
      .filter(Boolean)
  )];
  const trackingText = trackingState === ORDER_CONFIRMATION_TRACKING_STATES.AVAILABLE
    ? ["Shipment tracking:", ...normalizedTrackingNumbers.map((number) => `- ${number}`)].join("\n")
    : trackingState === ORDER_CONFIRMATION_TRACKING_STATES.TEST_NOT_APPLICABLE
      ? "Shipment tracking: Not applicable. Tracking is not generated for financial test orders."
      : trackingState === ORDER_CONFIRMATION_TRACKING_STATES.PREORDER_PENDING
        ? "Shipment tracking: Pending until your pre-order is ready. We’ll email the tracking number when the shipment is prepared."
        : "Shipment tracking: We’ll email the tracking number when the shipment is prepared.";
  const pickupDetails = pickupContext?.pickupDetails || null;
  const pickupScenario = pickupContext?.pickupScenario || getPickupScenario(fulfillment, preorderStatus);
  const pickupLines = buildPickupLines(pickupDetails, { pickupScenario });
  const pickupNotice = buildPickupNotice(pickupDetails, pickupScenario);
  const omittedPickupPolicyLine =
    "Pickup orders are reserved only after payment is successfully processed.";
  const pickupPolicyLines = pickupScenario === "preorder_only"
    ? []
    : Array.isArray(pickupDetails?.policy_lines)
      ? pickupDetails.policy_lines
          .filter((line) => line !== omittedPickupPolicyLine)
          .slice(0, 4)
      : [];
  const note = toText(customer?.note, 500);
  const contactLine = `If you have any questions, text ${SUPPORT_PHONE_DISPLAY}.`;
  const calendarAttachmentNotice =
    fulfillment === "market"
      ? pickupScenario === "preorder_only"
        ? "We are not attaching a calendar file yet because these items do not have a confirmed pickup date. We will send one as soon as pickup is scheduled."
        : hasPickupCalendarAttachment
          ? "A calendar file is attached so you can add this pickup to Google Calendar."
          : ""
      : "";
  const fulfillmentCopy =
    fulfillment === "market"
      ? pickupScenario === "mixed"
        ? "Some items from your order are confirmed for the pickup date below. The rest are pre-ordered for a later market day, and we will email you again when those items are ready."
        : pickupScenario === "preorder_only"
          ? "Your order includes pre-order items. We will follow up by email after they are restocked so you can confirm whether the next market pickup works for you."
          : "Your order is reserved for pickup at the details below."
      : hasMixedPreorderBreakout
        ? "Your in-stock items are reserved, and your pre-ordered items are in progress. We will ship this order to the address below after the pre-order items are ready."
        : hasPreorderBreakout
          ? "Your order includes pre-order items. We will email you after they are restocked, then ship to the address below once packed."
          : "We will ship this order to the address below once it is packed.";
  const orderSummaryHeading =
    pickupScenario === "mixed" || pickupScenario === "preorder_only" || hasPreorderBreakout
      ? "Full paid order"
      : "Order summary";
  const orderSummaryLead =
    isShipping && hasMixedPreorderBreakout
      ? "This paid receipt includes both the in-stock items reserved today and the pre-ordered items still being prepared before shipment."
      : isShipping && hasPreorderBreakout
        ? "These items were paid for today and will ship after the pre-ordered items are ready."
        : pickupScenario === "mixed"
      ? "This paid receipt includes both the items confirmed for the pickup date below and the items still being fermented for a later market day."
      : pickupScenario === "preorder_only"
        ? "These items were paid for today and will be scheduled for pickup once they are ready."
        : "";

  const subject = "Vida Verde Order Confirmation";

  const textSections = [
    [
      "Thank you for your Vida Verde order!",
      fulfillmentCopy,
      receiptNumberText ? `Receipt number: ${receiptNumberText}` : "",
      shortOrderId ? `Order ID: ${shortOrderId}` : "",
      `Fulfillment: ${fulfillmentLabel}`,
      paymentMethodText ? `Payment method: ${paymentMethodText}` : ""
    ]
      .filter(Boolean)
      .join("\n"),
    (pickupScenario === "mixed" || (isShipping && hasMixedPreorderBreakout)) &&
      readyReservationLines.length > 0
      ? [
          isShipping ? "Reserved now:" : "Confirmed for the pickup date below:",
          ...readyReservationLines
        ].join("\n")
      : "",
    (pickupScenario === "mixed" || pickupScenario === "preorder_only" || hasPreorderBreakout) &&
      preorderLines.length > 0
      ? [
          isShipping
            ? "Pre-ordered items in this order:"
            : pickupScenario === "mixed"
            ? "Still pre-ordered for later:"
            : "Pre-ordered items in this order:",
          ...preorderLines
        ].join("\n")
      : "",
    [
      `${orderSummaryHeading}:`,
      orderSummaryLead,
      ...itemLines.map(
        (item) =>
          `- ${item.name} x${item.quantity} @ ${formatMoney(
            item.price_cents,
            currency
          )} = ${formatMoney(item.lineTotal, currency)}`
      )
    ]
      .filter(Boolean)
      .join("\n"),
    [
      formatTextSummaryLine("Subtotal", formatMoney(subtotal, currency)),
      formatTextSummaryLine("Tax", formatMoney(tax, currency)),
      formatTextSummaryLine("Shipping", formatMoney(shipping, currency)),
      formatTextSummaryLine("TOTAL", formatMoney(total, currency))
    ].join("\n"),
    pickupLines.length > 0 ? ["Pickup details:", ...pickupLines].join("\n") : "",
    shippingLines.length > 0 ? ["Shipping details:", ...shippingLines].join("\n") : "",
    isShipping ? trackingText : "",
    isShipping && hasPreorderBreakout
      ? [
          hasMixedPreorderBreakout
            ? "Pre-ordered items:"
            : "Pre-order timing:",
          hasMixedPreorderBreakout
            ? SHIPPING_MIXED_ORDER_TIMING_NOTICE
            : SHIPPING_PREORDER_ONLY_TIMING_NOTICE,
          buildShippingPreorderFollowUpMessage()
        ].join("\n")
      : "",
    calendarAttachmentNotice,
    pickupNotice
      ? [pickupNotice.title + ":", ...pickupNotice.lines.map((line) => `- ${line}`)].join("\n")
      : "",
    pickupPolicyLines.length > 0
      ? ["Pickup policy reminders:", ...pickupPolicyLines.map((line) => `- ${line}`)].join("\n")
      : "",
    customerLines.length > 0 ? ["Customer:", ...customerLines].join("\n") : "",
    shippingLines.length === 0 && addressLines.length > 0
      ? ["Shipping address:", ...addressLines].join("\n")
      : "",
    note ? `Order note:\n${note}` : "",
    ["--------------------", contactLine, EMAIL_SIGN_OFF, EMAIL_SIGN_OFF_NAME].join("\n")
  ].filter(Boolean);

  const summaryRows = [
    {
      label: "Subtotal",
      value: formatMoney(subtotal, currency),
      isTotal: false
    },
    {
      label: "Tax",
      value: formatMoney(tax, currency),
      isTotal: false
    },
    {
      label: "Shipping",
      value: formatMoney(shipping, currency),
      isTotal: false
    },
    {
      label: "Total",
      value: formatMoney(total, currency),
      isTotal: true
    }
  ];

  const html = `
    <div style="font-family: 'Trebuchet MS', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      ${
        bannerUrl
          ? `
            <div style="margin-bottom: 24px;">
              <img
                src="${escapeHtml(bannerUrl)}"
                alt="Vida Verde order confirmation banner"
                style="display: block; width: 100%; max-width: 900px; height: auto; border: 0;"
              />
            </div>
          `
          : ""
      }
      <h1 style="margin-bottom: 8px; text-align: center;">Thank you for your Vida Verde order!</h1>
      <p style="margin-top: 0; margin-bottom: 12px; text-align: center;">${escapeHtml(
        fulfillmentCopy
      )}</p>
      <p style="margin-top: 0; text-align: left;">
        ${receiptNumberText ? `Receipt number: <strong>${escapeHtml(receiptNumberText)}</strong><br />` : ""}
        ${shortOrderId ? `Order ID: <strong>${escapeHtml(shortOrderId)}</strong><br />` : ""}
        Fulfillment: <strong>${escapeHtml(fulfillmentLabel)}</strong>${
          paymentMethodText
            ? `<br />Payment method: <strong>${escapeHtml(paymentMethodText)}</strong>`
            : ""
        }
      </p>
      ${
        (pickupScenario === "mixed" || (isShipping && hasMixedPreorderBreakout)) &&
        readyReservationLines.length > 0
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">${
              isShipping ? "Reserved now" : "Confirmed for this pickup date"
            }</h2>
            <ul style="margin: 0; padding-left: 20px;">
              ${readyReservationLines
                .map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line.slice(2))}</li>`)
                .join("")}
            </ul>
          `
          : ""
      }
      ${
        (pickupScenario === "mixed" || pickupScenario === "preorder_only" || hasPreorderBreakout) &&
        preorderLines.length > 0
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">${
              isShipping
                ? "Pre-ordered items in this order"
                : pickupScenario === "mixed"
                ? "Still pre-ordered for later"
                : "Pre-ordered items in this order"
            }</h2>
            <ul style="margin: 0; padding-left: 20px;">
              ${preorderLines
                .map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line.slice(2))}</li>`)
                .join("")}
            </ul>
          `
          : ""
      }
      ${
        shippingLines.length > 0
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">Shipping details</h2>
            <table role="presentation" style="width: 100%; border-collapse: collapse;">
              <tbody>
                ${
                  shippingMethodLabel
                    ? `
                      <tr>
                        <td style="padding: 4px 0; color: #6b7280; width: 160px;">Method</td>
                        <td style="padding: 4px 0;"><strong>${escapeHtml(shippingMethodLabel)}</strong></td>
                      </tr>
                    `
                    : ""
                }
                ${
                  estimatedShipDateText
                    ? `
                      <tr>
                        <td style="padding: 4px 0; color: #6b7280; width: 160px;">${escapeHtml(estimatedShipDateLabel)}</td>
                        <td style="padding: 4px 0;">${escapeHtml(estimatedShipDateText)}</td>
                      </tr>
                    `
                    : ""
                }
                ${
                  shippingTransitLabel
                    ? `
                      <tr>
                        <td style="padding: 4px 0; color: #6b7280; width: 160px;">Expected arrival</td>
                        <td style="padding: 4px 0;">${escapeHtml(shippingTransitLabel)}</td>
                      </tr>
                    `
                    : ""
                }
                <tr>
                  <td style="padding: 4px 0; color: #6b7280; width: 160px; vertical-align: top;">When it arrives</td>
                  <td style="padding: 4px 0;">Open and inspect the package. Refrigerate upon arrival, then carefully burp each jar to release any existing gas.</td>
                </tr>
                ${
                  addressLines.length > 0
                    ? `
                      <tr>
                        <td style="padding: 4px 0; color: #6b7280; width: 160px; vertical-align: top;">Ship to</td>
                        <td style="padding: 4px 0;">${addressLines.map((line) => escapeHtml(line)).join("<br />")}</td>
                      </tr>
                    `
                    : ""
                }
              </tbody>
            </table>
            <div style="margin-top: 18px; padding: 16px 18px; border-left: 4px solid #176b4d; border-radius: 8px; background: #eef7f1;">
              <strong style="display: block; margin-bottom: 7px; color: #14543d; font-size: 16px;">Shipment tracking</strong>
              ${
                trackingState === ORDER_CONFIRMATION_TRACKING_STATES.AVAILABLE
                  ? normalizedTrackingNumbers
                      .map(
                        (number) => `<span style="display: block; margin-top: 4px; color: #111827; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 17px; font-weight: 700; letter-spacing: 0.02em; overflow-wrap: anywhere;">${escapeHtml(number)}</span>`
                      )
                      .join("")
                  : trackingState === ORDER_CONFIRMATION_TRACKING_STATES.TEST_NOT_APPLICABLE
                    ? '<span style="display: block; color: #374151;">Not applicable. Tracking is not generated for financial test orders.</span>'
                    : trackingState === ORDER_CONFIRMATION_TRACKING_STATES.PREORDER_PENDING
                      ? '<span style="display: block; color: #374151;">Pending until your pre-order is ready. We’ll email the tracking number when the shipment is prepared.</span>'
                      : '<span style="display: block; color: #374151;">We’ll email the tracking number when the shipment is prepared.</span>'
              }
            </div>
            ${
              hasPreorderBreakout
                ? `
                  <div style="margin-top: 16px; padding: 14px 16px; border: 1px solid #d1d5db; background: #f8fafc;">
                    <strong style="display: block; margin-bottom: 6px;">${
                      hasMixedPreorderBreakout
                        ? "Pre-ordered items"
                        : "Pre-order timing"
                    }</strong>
                    <p style="margin: 0;">${escapeHtml(
                      hasMixedPreorderBreakout
                        ? SHIPPING_MIXED_ORDER_TIMING_NOTICE
                        : SHIPPING_PREORDER_ONLY_TIMING_NOTICE
                    )}</p>
                    <p style="margin: 10px 0 0;">${escapeHtml(buildShippingPreorderFollowUpMessage())}</p>
                  </div>
                `
                : ""
            }
          `
          : ""
      }
      ${
        pickupLines.length > 0
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">Pickup details</h2>
            <table role="presentation" style="width: 100%; border-collapse: collapse;">
              <tbody>
                <tr>
                  <td style="padding: 4px 0; color: #6b7280; width: 160px;">Market</td>
                  <td style="padding: 4px 0;"><strong>${escapeHtml(
                    pickupDetails.market_name
                  )}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #6b7280; width: 160px;">Address</td>
                  <td style="padding: 4px 0;">${escapeHtml(pickupDetails.market_address)}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #6b7280; width: 160px;">Pickup window</td>
                  <td style="padding: 4px 0;">${escapeHtml(pickupDetails.pickup_window)}</td>
                </tr>
                ${
                  pickupScenario === "preorder_only"
                    ? ""
                    : `
                      <tr>
                        <td style="padding: 4px 0; color: #6b7280; width: 160px;">Pickup date</td>
                        <td style="padding: 4px 0;"><strong>${escapeHtml(
                          pickupDetails.market_date_label
                        )}</strong></td>
                      </tr>
                    `
                }
              </tbody>
            </table>
            ${
              calendarAttachmentNotice
                ? `
                  <p style="margin-top: 16px; margin-bottom: 0;">${escapeHtml(
                    calendarAttachmentNotice
                  )}</p>
                `
                : ""
            }
            ${
              pickupNotice
                ? `
                  <div style="margin-top: 16px; padding: 14px 16px; border: 1px solid #d1d5db; background: #f8fafc;">
                    <strong style="display: block; margin-bottom: 6px;">${escapeHtml(
                      pickupNotice.title
                    )}</strong>
                    ${pickupNotice.lines
                      .map(
                        (line, index) => `
                          <p style="margin: ${index === 0 ? "0" : "10px 0 0"};">${escapeHtml(line)}</p>
                        `
                      )
                      .join("")}
                  </div>
                `
                : ""
            }
            ${
              pickupPolicyLines.length > 0
                ? `
                  <div style="margin-top: 16px;">
                    <strong style="display: block; margin-bottom: 8px;">Pickup policy reminders</strong>
                    <ul style="margin: 0; padding-left: 18px;">
                      ${pickupPolicyLines
                        .map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line)}</li>`)
                        .join("")}
                    </ul>
                  </div>
                `
                : ""
            }
          `
          : ""
      }
      <h2 style="margin-top: 32px; margin-bottom: 12px;">${escapeHtml(orderSummaryHeading)}</h2>
      ${
        orderSummaryLead
          ? `<p style="margin-top: 0; margin-bottom: 12px;">${escapeHtml(orderSummaryLead)}</p>`
          : ""
      }
      <table style="width: 100%; border-collapse: collapse;">
        <thead>
          <tr>
            <th align="left" style="border-bottom: 1px solid #d1d5db; padding: 8px 0; width: 50%;">Item</th>
            <th align="right" style="border-bottom: 1px solid #d1d5db; padding: 8px 0; width: 10%;">Qty</th>
            <th align="right" style="border-bottom: 1px solid #d1d5db; padding: 8px 0; width: 20%;">Unit</th>
            <th align="right" style="border-bottom: 1px solid #d1d5db; padding: 8px 0; width: 20%;">Line total</th>
          </tr>
        </thead>
        <tbody>
          ${itemLines
            .map(
              (item) => `
                <tr>
                  <td style="border-bottom: 1px solid #e5e7eb; padding: 12px 0; vertical-align: top;">
                    ${escapeHtml(item.name)}
                  </td>
                  <td align="right" style="border-bottom: 1px solid #e5e7eb; padding: 12px 0; vertical-align: top; white-space: nowrap; font-variant-numeric: tabular-nums;">
                    ${item.quantity}
                  </td>
                  <td align="right" style="border-bottom: 1px solid #e5e7eb; padding: 12px 0; vertical-align: top; white-space: nowrap; font-variant-numeric: tabular-nums;">
                    ${escapeHtml(
                    formatMoney(item.price_cents, currency)
                  )}
                  </td>
                  <td align="right" style="border-bottom: 1px solid #e5e7eb; padding: 12px 0; vertical-align: top; white-space: nowrap; font-variant-numeric: tabular-nums;">
                    ${escapeHtml(
                    formatMoney(item.lineTotal, currency)
                  )}
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
      <table role="presentation" style="margin-top: 20px; margin-left: auto; width: 100%; max-width: 320px; border-collapse: collapse; font-variant-numeric: tabular-nums;">
        <tbody>
          ${summaryRows
            .map(
              (row) => `
                <tr>
                  <td style="padding: ${row.isTotal ? "12px 14px" : "6px 0"}; ${
                    row.isTotal
                      ? "border-top: 2px solid #1f2937; background: #f3f4f6; font-size: 18px; font-weight: 700;"
                      : ""
                  }">
                    ${escapeHtml(row.label)}
                  </td>
                  <td align="right" style="padding: ${row.isTotal ? "12px 14px" : "6px 0"}; white-space: nowrap; ${
                    row.isTotal
                      ? "border-top: 2px solid #1f2937; background: #f3f4f6; font-size: 18px; font-weight: 700;"
                      : ""
                  }">
                    ${escapeHtml(row.value)}
                  </td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
      ${
        customerLines.length > 0
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">Customer</h2>
            <p style="margin: 0;">${customerLines.map((line) => escapeHtml(line)).join("<br />")}</p>
          `
          : ""
      }
      ${
        shippingLines.length === 0 && addressLines.length > 0
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">Shipping address</h2>
            <p style="margin: 0;">${addressLines.map((line) => escapeHtml(line)).join("<br />")}</p>
          `
          : ""
      }
      ${
        note
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">Order note</h2>
            <p style="white-space: pre-wrap; margin: 0;">${escapeHtml(note)}</p>
          `
          : ""
      }
      <div style="margin-top: 32px; padding-top: 20px; border-top: 2px dashed #d1d5db;">
      <p style="margin-top: 0;">
        If you have any questions, text
        <a href="sms:${escapeHtml(SUPPORT_PHONE_RAW)}" style="color: #1f2937;">${escapeHtml(
          SUPPORT_PHONE_DISPLAY
        )}</a>.
      </p>
      <p style="margin-top: 20px; margin-bottom: 0;">
        ${escapeHtml(EMAIL_SIGN_OFF)}<br />
        <strong>${escapeHtml(EMAIL_SIGN_OFF_NAME)}</strong>
      </p>
      </div>
    </div>
  `;

  return {
    subject,
    text: textSections.join("\n\n"),
    html
  };
};

export async function sendOrderConfirmationEmail(order, { messageId = "" } = {}) {
  if (!emailConfig) {
    return {
      ok: true,
      skipped: true,
      code: "configuration_unavailable",
      reason: "Email delivery is not set up right now."
    };
  }

  const recipient = toText(order?.customer?.email, 254);
  if (!recipient) {
    return {
      ok: false,
      code: "invalid_payload",
      error: "Customer email is missing."
    };
  }

  const items = await enrichItems(order?.items);
  if (items.length === 0) {
    return {
      ok: false,
      code: "invalid_payload",
      error: "Order items are missing."
    };
  }

  const orderContext = await getAuthoritativeOrderEmailContext(order?.orderId);
  if (!orderContext.ok) {
    return {
      ok: false,
      code: orderContext.code,
      error: orderContext.error?.message || "Order confirmation lookup failed."
    };
  }

  const authoritativeOrder = {
    ...order,
    fulfillment: orderContext.fulfillment
  };

  const preorderStatus = await getOrderPreorderStatus(authoritativeOrder.orderId);
  if (preorderStatus.error) {
    return {
      ok: false,
      code: "dependency_unavailable",
      error: preorderStatus.error.message || "Order preorder lookup failed."
    };
  }
  const allowTestShipping = orderContext.isTestOrder && isEasyPostTestMode();
  const trackingResult =
    authoritativeOrder.fulfillment === "ship" &&
      (!orderContext.isTestOrder || allowTestShipping)
      ? await getOrderTrackingNumbers(authoritativeOrder.orderId)
      : {
          numbers: [],
          estimatedShipDate: "",
          expectedArrivalDate: "",
          error: null
        };
  const trackingNumbers = trackingResult.numbers;
  const trackingState = resolveOrderConfirmationTrackingState({
    fulfillment: authoritativeOrder.fulfillment,
    isTestOrder: orderContext.isTestOrder,
    allowTestShipping,
    hasPreorderItems: preorderStatus.hasPreorderItems,
    trackingNumbers
  });
  const pickupContext = getOrderPickupContext({
    fulfillment: authoritativeOrder.fulfillment,
    placedAt: authoritativeOrder.placedAt,
    preorderStatus,
    items
  });
  const pickupCalendarInvite =
    authoritativeOrder.fulfillment === "market" && pickupContext.pickupScenario !== "preorder_only"
      ? buildPickupCalendarInvite({
          orderId: authoritativeOrder.orderId,
          pickupDetails: pickupContext.pickupDetails,
          readyItems: pickupContext.calendarReadyItems,
          pendingItems: pickupContext.calendarPendingItems
        })
      : null;

  const { subject, text, html } = buildEmailContent({
    orderId: authoritativeOrder.orderId,
    fulfillment: authoritativeOrder.fulfillment,
    currency: authoritativeOrder.currency,
    subtotal: authoritativeOrder.subtotal,
    tax: authoritativeOrder.tax,
    shipping: authoritativeOrder.shipping,
    total: authoritativeOrder.total,
    placedAt: authoritativeOrder.placedAt,
    receiptNumber: authoritativeOrder.receiptNumber,
    paymentMethodLabel: authoritativeOrder.paymentMethodLabel,
    customer: authoritativeOrder.customer,
    items,
    preorderStatus,
    trackingNumbers,
    shipmentTiming: {
      estimatedShipDate: trackingResult.estimatedShipDate,
      expectedArrivalDate: trackingResult.expectedArrivalDate
    },
    trackingState,
    pickupContext,
    hasPickupCalendarAttachment: Boolean(pickupCalendarInvite)
  });

  const delivery = await sendMail({
    to: recipient,
    subject,
    text,
    html,
    bcc: ORDER_CONFIRMATION_BCC_RECIPIENTS,
    messageId: toText(messageId, 320) || undefined,
    attachments: pickupCalendarInvite ? [pickupCalendarInvite] : undefined
  });

  if (!delivery.ok) {
    return {
      ...delivery,
      code: "smtp_failed",
      trackingState
    };
  }

  return {
    ...delivery,
    code: "sent",
    trackingState
  };
}
