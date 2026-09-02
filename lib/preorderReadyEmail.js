import { randomUUID } from "node:crypto";

import { getConsumerShippingDetails } from "@/lib/consumerShipping";
import { sendMail, emailConfig } from "@/lib/email";
import { buildPickupCalendarInvite } from "@/lib/pickupCalendarInvite";
import { getPendingPreorderItemsByOrder } from "@/lib/pendingPickupItems";
import { getPickupDetails } from "@/lib/pickupDetails";
import {
  getEstimatedShipDate,
  getLatestExpectedDeliveryDate,
  SHIPPING_SCHEDULE_TIME_ZONE
} from "@/lib/shippingPricing";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { isEasyPostTestMode } from "@/lib/easypost";

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);
const toErrorText = (value, max = 1000) =>
  String(value?.message || value?.details || value || "Preorder-ready email delivery failed.")
    .trim()
    .slice(0, max);
const siteUrl = String(process.env.SITE_URL || "").trim().replace(/\/$/, "");
const configuredBannerUrl = String(process.env.ORDER_EMAIL_BANNER_URL || "").trim();
const bannerUrl =
  configuredBannerUrl || (siteUrl ? `${siteUrl}/email/order-confirmation-banner.png` : "");
const SUPPORT_PHONE_RAW = "7134781878";
const SUPPORT_PHONE_DISPLAY = "(713) 478-1878";
export const PREORDER_READY_EMAIL_DELAY_MS = 5 * 60 * 1000;
export const PREORDER_READY_EMAIL_CLAIM_LEASE_MS = 30 * 60 * 1000;
export const PREORDER_READY_EMAIL_ORDER_LIMIT = 4;
export const PREORDER_READY_EMAIL_MAX_EVENTS_PER_ORDER = 200;
export const PREORDER_READY_EMAIL_WORKER_BUDGET_MS = 45_000;

const messageIdDomain = (() => {
  try {
    return new URL(siteUrl).hostname || "vida-verde.invalid";
  } catch {
    return "vida-verde.invalid";
  }
})();

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

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

const buildItemsSignature = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => `${toText(item?.sku, 32).toUpperCase()}:${Number.parseInt(item?.quantity, 10) || 0}`)
    .filter(Boolean)
    .sort()
    .join("|");

const formatItemsText = (items) =>
  items
    .map((item) => {
      const quantity = Number.parseInt(item?.quantity, 10) || 0;
      const name = toText(item?.name, 120) || toText(item?.sku, 32);
      if (!name || quantity <= 0) return "";
      return `- ${name} x${quantity}`;
    })
    .filter(Boolean);

const toMessageIdPart = (value, fallback) => {
  const normalized = toText(value, 120)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
};

export const buildPreorderReadyMessageId = (order) => {
  const orderId = toMessageIdPart(order?.orderId, "order");
  const firstReleaseEventId = toMessageIdPart(order?.releaseEventIds?.[0], "release");
  return `<preorder-ready-${orderId}-${firstReleaseEventId}@${messageIdDomain}>`;
};

const formatShippingDate = (value) => {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SHIPPING_SCHEDULE_TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric"
  }).format(date);
};

export const getConsumerShippingMethod = (
  order = {},
  { hasRemainingPreorders = false } = {}
) => {
  const details = getConsumerShippingDetails(order);
  const referenceDate = new Date(order?.emailReferenceTime || Date.now());
  const estimatedShipDate = getEstimatedShipDate({
    orderDate: referenceDate,
    hasPreorderItems: hasRemainingPreorders
  });
  const expectedArrivalDate = getLatestExpectedDeliveryDate({
    orderDate: referenceDate,
    shippingOption: details,
    hasPreorderItems: hasRemainingPreorders
  });

  return {
    ...details,
    shipDateLabel: formatShippingDate(estimatedShipDate),
    expectedArrivalLabel: formatShippingDate(expectedArrivalDate)
  };
};

const buildAddressLines = (order) =>
  [
    toText(order?.customerName, 120),
    toText(order?.address1, 120),
    toText(order?.address2, 120),
    [order?.city, order?.state, order?.postalCode]
      .map((part) => toText(part, 64))
      .filter(Boolean)
      .join(", ")
  ].filter(Boolean);

export const buildReadyEmailContent = ({
  order,
  pickupDetails,
  hasRemainingPreorders,
  hasPickupCalendarAttachment
}) => {
  const isShipping = order?.fulfillment === "ship";
  const isTestOrder = order?.isTestOrder === true;
  const isFinalShipping = isShipping && !hasRemainingPreorders;
  const trackingNotApplicable = isFinalShipping && isTestOrder && !isEasyPostTestMode();
  const readyItems = Array.isArray(order?.readyItems) ? order.readyItems : [];
  const readyForFulfillmentItems =
    Array.isArray(order?.fullPickupItems) && order.fullPickupItems.length > 0
      ? order.fullPickupItems
      : readyItems;
  const pendingItems = Array.isArray(order?.pendingItems) ? order.pendingItems : [];
  const readyLines = formatItemsText(readyItems);
  const readyForFulfillmentLines = formatItemsText(readyForFulfillmentItems);
  const pendingLines = formatItemsText(pendingItems);
  const hasExpandedPickupList =
    buildItemsSignature(readyForFulfillmentItems) !== buildItemsSignature(readyItems);
  const itemLead =
    isShipping
      ? hasRemainingPreorders
        ? readyLines.length === 1
          ? "A new item from your Vida Verde order is ready, and other preorder items are still in progress."
          : "New items from your Vida Verde order are ready, and other preorder items are still in progress."
        : readyLines.length === 1
          ? "A new item from your Vida Verde order just became ready to ship."
          : "New items from your Vida Verde order just became ready to ship."
      : readyLines.length === 1
        ? "A new item from your Vida Verde order just became ready for pickup."
        : "New items from your Vida Verde order just became ready for pickup.";
  const fullPickupLead = hasExpandedPickupList
    ? isShipping
      ? "This update adds to other Vida Verde items from the same order that are already set aside for shipment. Your full ready-to-ship list is below."
      : "This update adds to other Vida Verde items from the same order that are already set aside for you. Your full ready-for-pickup list is below."
    : "";
  const partialOrderNotice = hasRemainingPreorders
    ? pendingLines.length > 0
      ? "Some other preorder items from your order are still in progress. We listed them below and will send another update as soon as the rest are ready."
      : "Some other preorder items from your order are still in progress. We will send another update as soon as the rest are ready."
    : isShipping
      ? trackingNotApplicable
        ? "Everything that was pre-ordered for this test order is now ready. Shipment tracking is not generated for test orders."
        : "Everything that was pre-ordered for this order is now ready. We will email tracking after the shipment is released."
      : "Everything that was pre-ordered for this order is now ready for pickup.";
  const calendarAttachmentNotice =
    !isShipping && hasPickupCalendarAttachment
      ? "A calendar file is attached so you can add this pickup to Google Calendar."
      : "";
  const contactNotice =
    isShipping
      ? hasRemainingPreorders
        ? `If your shipping address needs to change, text ${SUPPORT_PHONE_DISPLAY} as soon as possible.`
        : trackingNotApplicable
          ? "This financial test did not create a shipment."
          : `Your order is ready for this address. If the address is wrong, text ${SUPPORT_PHONE_DISPLAY} before the shipment is released.`
      : `If you are not able to make it to the market, text ${SUPPORT_PHONE_DISPLAY} and we will work with you to organize a solution that works.`;
  const subject = isShipping
    ? hasRemainingPreorders
      ? "Vida Verde preorder update: items are ready"
      : "Great news: your Vida Verde pre-order is ready to ship"
    : `Great news: your Vida Verde pre-order is ready for ${toText(
        pickupDetails?.market_date_label,
        120
      )}`;
  const shippingMethod = getConsumerShippingMethod(order, {
    hasRemainingPreorders
  });
  const trackingNumbers = [...new Set(
    (Array.isArray(order?.trackingNumbers) ? order.trackingNumbers : [])
      .map((value) => toText(value, 120))
      .filter(Boolean)
  )];
  const addressLines = buildAddressLines(order);
  const fulfillmentDetailsText = isShipping
    ? [
        "Shipping details:",
        `Method: ${shippingMethod.label}`,
        `${hasRemainingPreorders ? "Estimated carrier-handoff date after preorder window" : "Estimated carrier-handoff date"}: ${shippingMethod.shipDateLabel}`,
        `Expected arrival: ${shippingMethod.expectedArrivalLabel}`,
        "When it arrives: Open and inspect the package. Carefully burp each jar to release any existing gas, then refrigerate.",
        addressLines.length > 0
          ? ["Ship to:", ...addressLines.map((line) => `  ${line}`)].join("\n")
          : ""
      ].filter(Boolean)
    : [
        "Pickup details:",
        `Day: ${toText(pickupDetails?.market_date_label, 120)}`,
        `Market: ${toText(pickupDetails?.market_name, 120)}`,
        `Address: ${toText(pickupDetails?.market_address, 160)}`,
        `Window: ${toText(pickupDetails?.pickup_window, 64)}`
      ];

  const text = [
    "Great news!",
    itemLead,
    "",
    hasExpandedPickupList ? fullPickupLead : "",
    isShipping
      ? hasRemainingPreorders
        ? "Ready items:"
        : "Ready to ship now:"
      : "Ready for pickup now:",
    ...readyForFulfillmentLines,
    "",
    pendingLines.length > 0
      ? ["Still not ready yet:", ...pendingLines, ""].join("\n")
      : "",
    ...fulfillmentDetailsText,
    isFinalShipping
      ? trackingNotApplicable
        ? "Shipment tracking: Not generated for this test order."
        : trackingNumbers.length > 0
          ? ["Shipment tracking:", ...trackingNumbers.map((number) => `- ${number}`)].join("\n")
          : "Shipment tracking: We will email it after the shipment is released."
      : "",
    "",
    partialOrderNotice,
    calendarAttachmentNotice,
    contactNotice,
    "",
    isShipping
      ? hasRemainingPreorders
        ? "We will email another update when the remaining items are ready."
        : trackingNotApplicable
          ? "No tracking number is generated for test orders."
          : trackingNumbers.length > 0
            ? "Keep the tracking number above for shipment updates."
            : "We will email tracking after the shipment is released."
      : "We are excited to see you at the market.",
    "Vida Verde"
  ].join("\n");

  const html = `
    <div style="font-family: 'Trebuchet MS', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      ${
        bannerUrl
          ? `
            <div style="margin-bottom: 24px;">
              <img
                src="${escapeHtml(bannerUrl)}"
                alt="Vida Verde preorder ready banner"
                style="display: block; width: 100%; max-width: 900px; height: auto; border: 0;"
              />
            </div>
          `
          : ""
      }
      <h1 style="margin-bottom: 10px;">Great news!</h1>
      <p style="margin-top: 0;">${escapeHtml(itemLead)}</p>
      ${
        fullPickupLead
          ? `
            <div style="margin-top: 20px; padding: 14px 16px; background: #eef7ef; border: 1px solid #c9decf;">
              ${escapeHtml(fullPickupLead)}
            </div>
          `
          : ""
      }
      <h2 style="margin-top: 28px; margin-bottom: 10px;">${
        isShipping
          ? hasRemainingPreorders
            ? "Ready items"
            : "Ready to ship now"
          : "Ready for pickup now"
      }</h2>
      <ul style="margin: 0; padding-left: 20px;">
        ${readyForFulfillmentLines.map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line.slice(2))}</li>`).join("")}
      </ul>
      ${
        pendingLines.length > 0
          ? `
            <h2 style="margin-top: 28px; margin-bottom: 10px;">Still not ready yet</h2>
            <ul style="margin: 0; padding-left: 20px;">
              ${pendingLines.map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line.slice(2))}</li>`).join("")}
            </ul>
          `
          : ""
      }
      <h2 style="margin-top: 28px; margin-bottom: 10px;">${
        isShipping ? "Shipping details" : "Pickup details"
      }</h2>
      ${
        isShipping
          ? `
            <table role="presentation" style="width: 100%; border-collapse: collapse;">
              <tbody>
                ${
                  `<tr>
                    <td style="padding: 4px 0; color: #6b7280; width: 120px;">Method</td>
                    <td style="padding: 4px 0;"><strong>${escapeHtml(shippingMethod.label)}</strong></td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #6b7280; width: 160px;">${hasRemainingPreorders ? "Estimated carrier-handoff date after preorder window" : "Estimated carrier-handoff date"}</td>
                    <td style="padding: 4px 0;">${escapeHtml(shippingMethod.shipDateLabel)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #6b7280; width: 160px;">Expected arrival</td>
                    <td style="padding: 4px 0;">${escapeHtml(shippingMethod.expectedArrivalLabel)}</td>
                  </tr>
                  <tr>
                    <td style="padding: 4px 0; color: #6b7280; width: 160px; vertical-align: top;">When it arrives</td>
                    <td style="padding: 4px 0;">Open and inspect the package. Carefully burp each jar to release any existing gas, then refrigerate.</td>
                  </tr>`
                }
                ${
                  addressLines.length > 0
                    ? `
                      <tr>
                        <td style="padding: 4px 0; color: #6b7280; width: 120px; vertical-align: top;">Ship to</td>
                        <td style="padding: 4px 0;">${addressLines.map((line) => escapeHtml(line)).join("<br />")}</td>
                      </tr>
                    `
                    : ""
                }
              </tbody>
            </table>
            ${
              isFinalShipping
                ? `
                  <div style="margin-top: 18px; padding: 16px 18px; border-left: 4px solid #176b4d; border-radius: 8px; background: #eef7f1;">
                    <strong style="display: block; margin-bottom: 7px; color: #14543d; font-size: 16px;">Shipment tracking</strong>
                    ${
                      trackingNotApplicable
                        ? '<span style="display: block; color: #374151;">Not generated for this test order.</span>'
                        : trackingNumbers.length > 0
                          ? trackingNumbers
                              .map(
                                (number) => `<span style="display: block; margin-top: 4px; color: #111827; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 17px; font-weight: 700; letter-spacing: 0.02em; overflow-wrap: anywhere;">${escapeHtml(number)}</span>`
                              )
                              .join("")
                        : '<span style="display: block; color: #374151;">We will email tracking after the shipment is released.</span>'
                    }
                  </div>
                `
                : ""
            }
          `
          : `
            <table role="presentation" style="width: 100%; border-collapse: collapse;">
              <tbody>
                <tr>
                  <td style="padding: 4px 0; color: #6b7280; width: 120px;">Day</td>
                  <td style="padding: 4px 0;"><strong>${escapeHtml(
                    pickupDetails?.market_date_label
                  )}</strong></td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #6b7280; width: 120px;">Market</td>
                  <td style="padding: 4px 0;">${escapeHtml(pickupDetails?.market_name)}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #6b7280; width: 120px;">Address</td>
                  <td style="padding: 4px 0;">${escapeHtml(pickupDetails?.market_address)}</td>
                </tr>
                <tr>
                  <td style="padding: 4px 0; color: #6b7280; width: 120px;">Window</td>
                  <td style="padding: 4px 0;">${escapeHtml(pickupDetails?.pickup_window)}</td>
                </tr>
              </tbody>
            </table>
          `
      }
      <div style="margin-top: 20px; padding: 14px 16px; background: #f5f3e8; border: 1px solid #d8d2bc;">
        ${escapeHtml(partialOrderNotice)}
      </div>
      ${
        calendarAttachmentNotice
          ? `<p style="margin-top: 16px; margin-bottom: 0;">${escapeHtml(calendarAttachmentNotice)}</p>`
          : ""
      }
      <p style="margin-top: 16px; margin-bottom: 0;">
        ${
          isShipping
            ? hasRemainingPreorders
              ? "If your shipping address needs to change, text"
              : trackingNotApplicable
                ? "This financial test did not create a shipment. Questions? Text"
                : "Your shipment is already being prepared for this address. If the address is wrong, text"
            : "If you are not able to make it to the market, text"
        }
        <a href="sms:${escapeHtml(SUPPORT_PHONE_RAW)}" style="color: #1f2937;">${escapeHtml(
          SUPPORT_PHONE_DISPLAY
        )}</a>
        ${
          isShipping
            ? hasRemainingPreorders
              ? "as soon as possible."
              : trackingNotApplicable
                ? "."
                : "immediately. Changes may no longer be possible."
            : "and we will work with you to organize a solution that works."
        }
      </p>
      <p style="margin-top: 24px; margin-bottom: 0;">${
        isShipping
          ? hasRemainingPreorders
            ? "We will email another update when the remaining items are ready."
            : trackingNotApplicable
              ? "No tracking number is generated for test orders."
              : trackingNumbers.length > 0
                ? "Keep the tracking number above for shipment updates."
              : "We will email tracking after the shipment is released."
          : "We are excited to see you at the market."
      }<br /><strong>Vida Verde</strong></p>
    </div>
  `;

  return { subject, text, html };
};

const groupReadyRowsByOrder = (rows) =>
  [...(rows || []).reduce((acc, row) => {
    const orderData = Array.isArray(row?.orders) ? row.orders[0] : row?.orders;
    const productData = Array.isArray(row?.products) ? row.products[0] : row?.products;
    const orderId = toText(orderData?.id || row?.order_id, 36);
    const email = toText(orderData?.customer_email, 254);
    const releaseEventId = toText(row?.id, 36);
    const quantity = Number.parseInt(row?.quantity, 10) || 0;
    const releasedAt = toText(row?.created_at, 64);
    const sku = toText(row?.sku, 32).toUpperCase();
    const name = toText(productData?.name, 120) || sku;

    if (!orderId || !email || !releaseEventId || !sku || quantity <= 0 || !releasedAt) {
      return acc;
    }

    const current = acc.get(orderId) || {
      orderId,
      fulfillment: toText(orderData?.fulfillment, 16) === "ship" ? "ship" : "market",
      customerName: toText(orderData?.customer_name, 120),
      customerEmail: email,
      isTestOrder: orderData?.is_test_order === true,
      address1: toText(orderData?.address1, 120),
      address2: toText(orderData?.address2, 120),
      city: toText(orderData?.city, 120),
      state: toText(orderData?.state, 64),
      postalCode: toText(orderData?.postal_code, 32),
      shippingOption: toText(orderData?.shipping_option, 80),
      readyItemsMap: new Map(),
      releaseEventIds: []
    };

    addItemToMap(current.readyItemsMap, {
      sku,
      name,
      quantity
    });
    current.releaseEventIds.push(releaseEventId);

    acc.set(orderId, current);
    return acc;
  }, new Map()).entries()].reduce((acc, [orderId, order]) => {
    acc.set(orderId, {
      orderId,
      fulfillment: order.fulfillment,
      customerName: order.customerName,
      customerEmail: order.customerEmail,
      isTestOrder: order.isTestOrder,
      address1: order.address1,
      address2: order.address2,
      city: order.city,
      state: order.state,
      postalCode: order.postalCode,
      shippingOption: order.shippingOption,
      readyItems: mapToSortedItems(order.readyItemsMap),
      releaseEventIds: order.releaseEventIds
    });
    return acc;
  }, new Map());

const getFullPickupItemsByOrder = async (orderIds) => {
  const normalizedOrderIds = (Array.isArray(orderIds) ? orderIds : [])
    .map((value) => toText(value, 36))
    .filter(Boolean);
  if (normalizedOrderIds.length === 0) {
    return new Map();
  }

  const [orderItemsResult, releasedItemsResult] = await Promise.all([
    supabaseAdmin
      .from("order_items")
      .select("order_id, sku, quantity, preorder_qty, products(name)")
      .in("order_id", normalizedOrderIds),
    supabaseAdmin
      .from("preorder_release_events")
      .select("order_id, sku, quantity, products(name)")
      .in("order_id", normalizedOrderIds)
  ]);

  if (orderItemsResult.error) {
    console.error(
      "preorder ready order_items lookup error:",
      orderItemsResult.error
    );
    return null;
  }

  if (releasedItemsResult.error) {
    console.error(
      "preorder ready release lookup error:",
      releasedItemsResult.error
    );
    return null;
  }

  const itemsByOrder = new Map();
  const getOrderItemsMap = (orderId) => {
    const normalizedOrderId = toText(orderId, 36);
    if (!normalizedOrderId) return null;

    const existing = itemsByOrder.get(normalizedOrderId);
    if (existing) return existing;

    const created = new Map();
    itemsByOrder.set(normalizedOrderId, created);
    return created;
  };

  for (const row of orderItemsResult.data || []) {
    const orderId = toText(row?.order_id, 36);
    const sku = toText(row?.sku, 32).toUpperCase();
    const quantity = Number.parseInt(row?.quantity, 10) || 0;
    const preorderQty = Math.min(Number.parseInt(row?.preorder_qty, 10) || 0, quantity);
    const readyReservationQty = Math.max(quantity - preorderQty, 0);
    const productData = Array.isArray(row?.products) ? row.products[0] : row?.products;
    const name = toText(productData?.name, 120) || sku;
    if (!orderId || !sku || readyReservationQty <= 0) continue;

    const orderItemsMap = getOrderItemsMap(orderId);
    addItemToMap(orderItemsMap, {
      sku,
      name,
      quantity: readyReservationQty
    });
  }

  for (const row of releasedItemsResult.data || []) {
    const orderId = toText(row?.order_id, 36);
    const sku = toText(row?.sku, 32).toUpperCase();
    const quantity = Number.parseInt(row?.quantity, 10) || 0;
    const productData = Array.isArray(row?.products) ? row.products[0] : row?.products;
    const name = toText(productData?.name, 120) || sku;
    if (!orderId || !sku || quantity <= 0) continue;

    const orderItemsMap = getOrderItemsMap(orderId);
    addItemToMap(orderItemsMap, {
      sku,
      name,
      quantity
    });
  }

  return [...itemsByOrder.entries()].reduce((acc, [orderId, itemsMap]) => {
    acc.set(orderId, mapToSortedItems(itemsMap));
    return acc;
  }, new Map());
};

const claimPreorderReadyEmailEvents = async (order, { cutoffIso, staleBeforeIso }) => {
  const claimToken = randomUUID();
  const { data, error } = await supabaseAdmin.rpc("claim_preorder_ready_email_events", {
    p_order_id: order.orderId,
    p_event_ids: order.releaseEventIds,
    p_claim_token: claimToken,
    p_stale_before: staleBeforeIso,
    p_cutoff: cutoffIso
  });

  return {
    claimed: data === true,
    claimToken,
    error
  };
};

const releasePreorderReadyEmailEvents = async (order, claimToken) => {
  const { data, error } = await supabaseAdmin.rpc("release_preorder_ready_email_events", {
    p_event_ids: order.releaseEventIds,
    p_claim_token: claimToken
  });
  const releasedCount = Number(data);

  if (error) return error;
  if (releasedCount !== order.releaseEventIds.length) {
    return new Error("The preorder-ready email claim could not be fully released.");
  }
  return null;
};

const completePreorderReadyEmailEvents = async (order, claimToken, sentAt) => {
  const { data, error } = await supabaseAdmin.rpc("complete_preorder_ready_email_events", {
    p_event_ids: order.releaseEventIds,
    p_claim_token: claimToken,
    p_sent_at: sentAt
  });
  const completedCount = Number(data);

  if (error) return error;
  if (completedCount !== order.releaseEventIds.length) {
    return new Error("The preorder-ready email delivery marker was not saved for every item.");
  }
  return null;
};

const prepareShippingOrder = async (order, { hasRemainingPreorders }) => {
  if (order?.fulfillment !== "ship") {
    return { ok: true };
  }

  const shipmentRpc = isEasyPostTestMode()
    ? "sync_shipment_for_order_with_test_labels"
    : "sync_shipment_for_order";
  const { data: shipmentId, error } = await supabaseAdmin.rpc(shipmentRpc, {
    p_order_id: order.orderId
  });
  if (error) return { ok: false, error };
  if (hasRemainingPreorders) {
    return { ok: true };
  }
  if (!shipmentId) {
    return {
      ok: false,
      error: new Error("The shipment is not ready to prepare yet.")
    };
  }

  order.trackingNumbers = [];
  return { ok: true };
};

export async function sendPreorderReadyEmails({ now = new Date() } = {}) {
  if (!supabaseAdmin) {
    return { ok: false, error: "Orders are not connected right now." };
  }

  const nowMs = new Date(now).getTime();
  const cutoff = nowMs - PREORDER_READY_EMAIL_DELAY_MS;
  if (!Number.isFinite(nowMs) || !Number.isFinite(cutoff)) {
    return { ok: false, error: "The preorder-ready email time is invalid." };
  }
  const cutoffIso = new Date(cutoff).toISOString();
  const staleBeforeIso = new Date(
    nowMs - PREORDER_READY_EMAIL_CLAIM_LEASE_MS
  ).toISOString();
  const workerDeadlineAt = Date.now() + PREORDER_READY_EMAIL_WORKER_BUDGET_MS;

  const { data: candidateRows, error: candidateError } = await supabaseAdmin.rpc(
    "get_preorder_ready_email_candidate_orders",
    {
      p_cutoff: cutoffIso,
      p_stale_before: staleBeforeIso,
      p_limit: PREORDER_READY_EMAIL_ORDER_LIMIT,
      p_max_events_per_order: PREORDER_READY_EMAIL_MAX_EVENTS_PER_ORDER
    }
  );
  if (candidateError) {
    return { ok: false, error: candidateError };
  }

  const candidateCounts = new Map(
    (Array.isArray(candidateRows) ? candidateRows : [])
      .map((row) => [toText(row?.order_id, 36), Number(row?.event_count || 0)])
      .filter(([orderId, eventCount]) => orderId && Number.isInteger(eventCount))
  );
  const candidateOrderIds = [...candidateCounts.keys()];
  if (candidateOrderIds.length === 0) {
    return { ok: true, sentCount: 0 };
  }

  const readyEventsQuery = supabaseAdmin
    .from("preorder_release_events")
    .select(
      "id, order_id, sku, quantity, created_at, products(name), orders!inner(id, status, fulfillment, customer_name, customer_email, address1, address2, city, state, postal_code, shipping_option, is_test_order)"
    )
    .eq("orders.status", "paid")
    .is("ready_pickup_email_sent_at", null)
    .in("order_id", candidateOrderIds);

  const { data, error } = await readyEventsQuery
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(
      PREORDER_READY_EMAIL_ORDER_LIMIT * PREORDER_READY_EMAIL_MAX_EVENTS_PER_ORDER
    );

  if (error) {
    return { ok: false, error };
  }

  const groupedOrders = groupReadyRowsByOrder(data);
  const orders = new Map();
  let poisonedOrderCount = 0;
  let changedBatchCount = 0;
  for (const [orderId, order] of groupedOrders) {
    const expectedCount = candidateCounts.get(orderId);
    if (order.releaseEventIds.length > PREORDER_READY_EMAIL_MAX_EVENTS_PER_ORDER) {
      poisonedOrderCount += 1;
      continue;
    }
    if (order.releaseEventIds.length !== expectedCount) {
      changedBatchCount += 1;
      continue;
    }
    orders.set(orderId, order);
  }
  const orderIds = [...orders.keys()];
  if (orderIds.length === 0) {
    return {
      ok: true,
      sentCount: 0,
      poisonedOrderCount,
      changedBatchCount
    };
  }

  const [pendingItemsByOrder, fullPickupItemsByOrder] = await Promise.all([
    getPendingPreorderItemsByOrder(orderIds, {
      logLabel: "preorder ready pending preorder lookup"
    }),
    getFullPickupItemsByOrder(orderIds)
  ]);

  if (!(pendingItemsByOrder instanceof Map)) {
    return { ok: false, error: "We couldn't check which preorder items are still waiting." };
  }

  if (!(fullPickupItemsByOrder instanceof Map)) {
    return { ok: false, error: "We couldn't check which preorder items are ready." };
  }

  if (!emailConfig) {
    return {
      ok: true,
      skipped: true,
      sentCount: 0,
      pickupSentCount: 0,
      shippingSentCount: 0,
      errors: [],
      reason: "Email delivery is not set up right now."
    };
  }

  const pickupDetails = getPickupDetails({ now: new Date(nowMs) });
  let sentCount = 0;
  let pickupSentCount = 0;
  let shippingSentCount = 0;
  let claimSkippedCount = 0;
  let deliveryUncertainCount = 0;
  let deadlineDeferredCount = 0;
  const errors = [];

  const readyOrders = [...orders.values()];
  for (let orderIndex = 0; orderIndex < readyOrders.length; orderIndex += 1) {
    if (Date.now() >= workerDeadlineAt) {
      deadlineDeferredCount += readyOrders.length - orderIndex;
      break;
    }
    const order = readyOrders[orderIndex];
    const claim = await claimPreorderReadyEmailEvents(order, {
      cutoffIso,
      staleBeforeIso
    });
    if (claim.error) {
      errors.push({ orderId: order.orderId, error: toErrorText(claim.error) });
      continue;
    }
    if (!claim.claimed) {
      claimSkippedCount += 1;
      continue;
    }

    const hasRemainingPreorders = pendingItemsByOrder.has(order.orderId);
    const enrichedOrder = {
      ...order,
      emailReferenceTime: new Date(nowMs).toISOString(),
      fullPickupItems:
        fullPickupItemsByOrder instanceof Map
          ? fullPickupItemsByOrder.get(order.orderId) || order.readyItems
          : order.readyItems,
      pendingItems:
        pendingItemsByOrder.get(order.orderId) || []
    };
    let smtpAccepted = false;

    try {
      const shippingPreparation = await prepareShippingOrder(enrichedOrder, {
        hasRemainingPreorders
      });
      if (!shippingPreparation.ok) throw shippingPreparation.error;

      const pickupCalendarInvite =
        order.fulfillment === "market"
          ? buildPickupCalendarInvite({
              orderId: order.orderId,
              pickupDetails,
              readyItems: enrichedOrder.fullPickupItems,
              pendingItems: enrichedOrder.pendingItems
            })
          : null;
      const { subject, text, html } = buildReadyEmailContent({
        order: enrichedOrder,
        pickupDetails,
        hasRemainingPreorders,
        hasPickupCalendarAttachment: Boolean(pickupCalendarInvite)
      });

      const emailResult = await sendMail({
        to: order.customerEmail,
        subject,
        text,
        html,
        messageId: buildPreorderReadyMessageId(order),
        attachments: pickupCalendarInvite ? [pickupCalendarInvite] : undefined
      });
      if (!emailResult.ok) throw emailResult.error;
      smtpAccepted = true;

      const completionError = await completePreorderReadyEmailEvents(
        order,
        claim.claimToken,
        new Date().toISOString()
      );
      if (completionError) {
        deliveryUncertainCount += 1;
        errors.push({
          orderId: order.orderId,
          error: toErrorText(completionError)
        });
        continue;
      }

      sentCount += 1;
      if (order.fulfillment === "ship") {
        shippingSentCount += 1;
      } else {
        pickupSentCount += 1;
      }
    } catch (error) {
      errors.push({
        orderId: order.orderId,
        error: toErrorText(error)
      });

      if (!smtpAccepted) {
        const releaseError = await releasePreorderReadyEmailEvents(
          order,
          claim.claimToken
        );
        if (releaseError) {
          errors.push({
            orderId: order.orderId,
            error: toErrorText(releaseError)
          });
        }
      }
    }
  }

  return {
    ok: errors.length === 0,
    sentCount,
    pickupSentCount,
    shippingSentCount,
    claimSkippedCount,
    deliveryUncertainCount,
    deadlineDeferredCount,
    poisonedOrderCount,
    changedBatchCount,
    errors,
    error: errors[0]?.error || null
  };
}
