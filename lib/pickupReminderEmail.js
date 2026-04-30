import { sendMail, emailConfig } from "@/lib/email";
import { buildPickupCalendarInvite } from "@/lib/pickupCalendarInvite";
import { getPendingPreorderItemsByOrder } from "@/lib/pendingPickupItems";
import {
  MARKET_TIMEZONE,
  formatMarketDate,
  getPickupDetails,
  getPrepSheetWeekInfo
} from "@/lib/pickupDetails";
import {
  addItemToMap,
  getJoinedOrderData,
  getJoinedProductData,
  isFridayOrderInMarketTimezone,
  mapToSortedItems,
  normalizeSku,
  toQty,
  toText
} from "@/lib/pickupOrderCandidates";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const SUPPORT_PHONE_RAW = "7134781878";
const SUPPORT_PHONE_DISPLAY = "(713) 478-1878";
const EMAIL_SIGN_OFF = "Stay cultured,";
const EMAIL_SIGN_OFF_NAME = "The Vida Verde Team";
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

const formatItemQuantityLines = (items) =>
  (Array.isArray(items) ? items : [])
    .map((item) => {
      const quantity = toQty(item?.quantity);
      const name = toText(item?.name, 120) || normalizeSku(item?.sku);
      if (!name || quantity <= 0) return "";
      return `- ${name} x${quantity}`;
    })
    .filter(Boolean);

const buildReminderEmailContent = ({ order, pickupDetails, hasPickupCalendarAttachment }) => {
  const items = Array.isArray(order?.items) ? order.items : [];
  const pendingItems = Array.isArray(order?.pendingItems) ? order.pendingItems : [];
  const itemLines = formatItemQuantityLines(items);
  const pendingLines = formatItemQuantityLines(pendingItems);
  const customerName = toText(order?.customerName, 120);
  const greeting = customerName ? `Hi ${customerName},` : "Hi there,";
  const subject = `Reminder: pick up your Vida Verde order tomorrow`;
  const pickupPolicyLines = Array.isArray(pickupDetails?.policy_lines)
    ? pickupDetails.policy_lines.slice(0, 4)
    : [];
  const intro =
    `This is a reminder that your Vida Verde order is scheduled for pickup tomorrow, ${toText(
      pickupDetails?.market_date_label,
      120
    )}.`;
  const calendarAttachmentNotice =
    hasPickupCalendarAttachment
      ? "A calendar file is attached so you can add this pickup to Google Calendar."
      : "";
  const contactLine =
    `If you cannot make it to the market, text ${SUPPORT_PHONE_DISPLAY} as soon as possible.`;

  const text = [
    greeting,
    intro,
    "",
    "Your pickup list:",
    ...itemLines,
    "",
    pendingLines.length > 0
      ? [
          "Still not ready yet:",
          ...pendingLines,
          "We will email you again when those items are ready for a later pickup.",
          ""
        ].join("\n")
      : "",
    "Pickup details:",
    `Date: ${toText(pickupDetails?.market_date_label, 120)}`,
    `Market: ${toText(pickupDetails?.market_name, 120)}`,
    `Address: ${toText(pickupDetails?.market_address, 160)}`,
    `Window: ${toText(pickupDetails?.pickup_window, 64)}`,
    "",
    calendarAttachmentNotice,
    "",
    pickupPolicyLines.length > 0
      ? ["Reminder notes:", ...pickupPolicyLines.map((line) => `- ${line}`)].join("\n")
      : "",
    contactLine,
    "",
    EMAIL_SIGN_OFF,
    EMAIL_SIGN_OFF_NAME
  ]
    .filter(Boolean)
    .join("\n");

  const html = `
    <div style="font-family: 'Trebuchet MS', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      ${
        bannerUrl
          ? `
            <div style="margin-bottom: 24px;">
              <img
                src="${escapeHtml(bannerUrl)}"
                alt="Vida Verde order reminder banner"
                style="display: block; width: 100%; max-width: 900px; height: auto; border: 0;"
              />
            </div>
          `
          : ""
      }
      <h1 style="margin-bottom: 8px; text-align: center;">Pickup reminder</h1>
      <p style="margin-top: 0; margin-bottom: 12px;">${escapeHtml(greeting)}</p>
      <p style="margin-top: 0; margin-bottom: 0;">
        ${escapeHtml(intro)}
      </p>
      <h2 style="margin-top: 32px; margin-bottom: 12px;">Your pickup list</h2>
      <ul style="margin: 0; padding-left: 20px;">
        ${itemLines
          .map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line.slice(2))}</li>`)
          .join("")}
      </ul>
      ${
        pendingLines.length > 0
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">Still not ready yet</h2>
            <ul style="margin: 0; padding-left: 20px;">
              ${pendingLines
                .map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line.slice(2))}</li>`)
                .join("")}
            </ul>
            <p style="margin-top: 12px; margin-bottom: 0;">
              We will email you again when those items are ready for a later pickup.
            </p>
          `
          : ""
      }
      <h2 style="margin-top: 32px; margin-bottom: 12px;">Pickup details</h2>
      <table role="presentation" style="width: 100%; border-collapse: collapse;">
        <tbody>
          <tr>
            <td style="padding: 4px 0; color: #6b7280; width: 160px;">Date</td>
            <td style="padding: 4px 0;"><strong>${escapeHtml(
              pickupDetails?.market_date_label
            )}</strong></td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6b7280; width: 160px;">Market</td>
            <td style="padding: 4px 0;"><strong>${escapeHtml(
              pickupDetails?.market_name
            )}</strong></td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6b7280; width: 160px;">Address</td>
            <td style="padding: 4px 0;">${escapeHtml(pickupDetails?.market_address)}</td>
          </tr>
          <tr>
            <td style="padding: 4px 0; color: #6b7280; width: 160px;">Window</td>
            <td style="padding: 4px 0;">${escapeHtml(pickupDetails?.pickup_window)}</td>
          </tr>
        </tbody>
      </table>
      ${
        calendarAttachmentNotice
          ? `<p style="margin-top: 16px; margin-bottom: 0;">${escapeHtml(calendarAttachmentNotice)}</p>`
          : ""
      }
      ${
        pickupPolicyLines.length > 0
          ? `
            <div style="margin-top: 20px;">
              <strong style="display: block; margin-bottom: 8px;">Reminder notes</strong>
              <ul style="margin: 0; padding-left: 18px;">
                ${pickupPolicyLines
                  .map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line)}</li>`)
                  .join("")}
              </ul>
            </div>
          `
          : ""
      }
      <p style="margin-top: 24px; margin-bottom: 0;">
        If you cannot make it to the market, text
        <a href="sms:${escapeHtml(SUPPORT_PHONE_RAW)}" style="color: #1f2937;">${escapeHtml(
          SUPPORT_PHONE_DISPLAY
        )}</a>
        as soon as possible.
      </p>
      <p style="margin-top: 24px; margin-bottom: 0;">
        ${escapeHtml(EMAIL_SIGN_OFF)}<br />
        <strong>${escapeHtml(EMAIL_SIGN_OFF_NAME)}</strong>
      </p>
    </div>
  `;

  return { subject, text, html };
};

const buildOrderEntry = (orderData, orderId, createdAt) => ({
  orderId,
  createdAt,
  customerName: toText(orderData?.customer_name, 120),
  customerEmail: toText(orderData?.customer_email, 254),
  customerPhone: toText(orderData?.customer_phone, 64),
  itemsMap: new Map(),
  releaseEventIds: [],
  includesStandardPickupReservation: false
});

const buildReminderCandidates = async ({ now = new Date() } = {}) => {
  const timezone = MARKET_TIMEZONE;
  const weekInfo = getPrepSheetWeekInfo(timezone, now);
  const pickupDetails = {
    ...getPickupDetails({ timeZone: timezone, now }),
    market_date: weekInfo.market_date,
    market_date_label: formatMarketDate(weekInfo.market_date, timezone)
  };

  const [itemsResult, releasedResult] = await Promise.all([
    supabaseAdmin
      .from("order_items")
      .select(
        "order_id, sku, quantity, preorder_qty, products(name), orders!inner(id, fulfillment, created_at, pickup_date, status, customer_name, customer_email, customer_phone, pickup_reminder_email_sent_at)"
      )
      .eq("orders.pickup_date", weekInfo.market_date)
      .eq("orders.status", "paid"),
    supabaseAdmin
      .from("preorder_release_events")
      .select(
        "id, order_id, sku, quantity, created_at, pickup_reminder_email_sent_at, products(name), orders!inner(id, fulfillment, status, customer_name, customer_email, customer_phone)"
      )
      .gte("created_at", weekInfo.collection_start_at)
      .lt("created_at", weekInfo.collection_end_at)
      .eq("orders.status", "paid")
      .is("pickup_reminder_email_sent_at", null)
  ]);

  if (itemsResult.error) {
    return { ok: false, error: itemsResult.error };
  }

  if (releasedResult.error) {
    return { ok: false, error: releasedResult.error };
  }

  const orders = new Map();

  for (const row of itemsResult.data || []) {
    const orderData = getJoinedOrderData(row);
    const orderId = toText(orderData?.id || row?.order_id, 36);
    const createdAt = orderData?.created_at ? new Date(orderData.created_at) : null;
    const quantity = toQty(row?.quantity);
    const preorderQty = Math.min(toQty(row?.preorder_qty), quantity);
    const readyQty = Math.max(quantity - preorderQty, 0);
    const alreadySent = Boolean(orderData?.pickup_reminder_email_sent_at);

    if (
      !orderId ||
      orderData?.fulfillment !== "market" ||
      !createdAt ||
      Number.isNaN(createdAt.getTime()) ||
      quantity <= 0 ||
      readyQty <= 0 ||
      alreadySent
    ) {
      continue;
    }

    if (isFridayOrderInMarketTimezone(createdAt, timezone)) {
      continue;
    }

    const entry = orders.get(orderId) || buildOrderEntry(orderData, orderId, orderData?.created_at);
    const productData = getJoinedProductData(row);

    entry.includesStandardPickupReservation = true;
    addItemToMap(entry.itemsMap, {
      sku: row?.sku,
      name: toText(productData?.name, 120) || normalizeSku(row?.sku),
      quantity: readyQty
    });
    orders.set(orderId, entry);
  }

  for (const row of releasedResult.data || []) {
    const orderData = getJoinedOrderData(row);
    const orderId = toText(orderData?.id || row?.order_id, 36);
    const releaseEventId = toText(row?.id, 36);
    const quantity = toQty(row?.quantity);

    if (
      !orderId ||
      !releaseEventId ||
      orderData?.fulfillment !== "market" ||
      quantity <= 0
    ) {
      continue;
    }

    const entry = orders.get(orderId) || buildOrderEntry(orderData, orderId, row?.created_at);
    const productData = getJoinedProductData(row);

    entry.releaseEventIds.push(releaseEventId);
    addItemToMap(entry.itemsMap, {
      sku: row?.sku,
      name: toText(productData?.name, 120) || normalizeSku(row?.sku),
      quantity
    });
    orders.set(orderId, entry);
  }

  const candidates = [...orders.values()]
    .map((order) => ({
      ...order,
      items: mapToSortedItems(order.itemsMap)
    }))
    .filter((order) => order.items.length > 0 && toText(order.customerEmail, 254));
  const pendingItemsByOrder = await getPendingPreorderItemsByOrder(
    candidates.map((order) => order.orderId),
    { logLabel: "pickup reminder pending preorder lookup" }
  );
  if (!(pendingItemsByOrder instanceof Map)) {
    return { ok: false, error: "We couldn't check which preorder items are still waiting." };
  }

  return {
    ok: true,
    pickupDetails,
    candidates: candidates.map((order) => ({
      ...order,
      pendingItems: pendingItemsByOrder.get(order.orderId) || []
    }))
  };
};

export async function sendPickupReminderEmails({ now = new Date() } = {}) {
  if (!supabaseAdmin) {
    return { ok: false, error: "Orders are not connected right now." };
  }

  if (!emailConfig) {
    return {
      ok: true,
      skipped: true,
      sentCount: 0,
      reason: "Email delivery is not set up right now."
    };
  }

  const reminderCandidates = await buildReminderCandidates({ now });
  if (!reminderCandidates.ok) {
    return reminderCandidates;
  }

  const { pickupDetails, candidates } = reminderCandidates;
  if (candidates.length === 0) {
    return {
      ok: true,
      sentCount: 0,
      pickupDate: pickupDetails?.market_date_label || ""
    };
  }

  let sentCount = 0;
  const errors = [];
  const sentAt = new Date().toISOString();

  for (const order of candidates) {
    const pickupCalendarInvite = buildPickupCalendarInvite({
      orderId: order.orderId,
      pickupDetails,
      readyItems: order.items,
      pendingItems: order.pendingItems,
      timeZone: MARKET_TIMEZONE
    });
    const { subject, text, html } = buildReminderEmailContent({
      order,
      pickupDetails,
      hasPickupCalendarAttachment: Boolean(pickupCalendarInvite)
    });

    const emailResult = await sendMail({
      to: order.customerEmail,
      subject,
      text,
      html,
      attachments: pickupCalendarInvite ? [pickupCalendarInvite] : undefined
    });

    if (!emailResult.ok) {
      errors.push({
        orderId: order.orderId,
        error: emailResult.error
      });
      continue;
    }

    sentCount += 1;

    if (order.includesStandardPickupReservation) {
      const { error: orderMarkError } = await supabaseAdmin
        .from("orders")
        .update({
          pickup_reminder_email_sent_at: sentAt
        })
        .eq("id", order.orderId)
        .is("pickup_reminder_email_sent_at", null);

      if (orderMarkError) {
        errors.push({
          orderId: order.orderId,
          error: orderMarkError
        });
      }
    }

    if (order.releaseEventIds.length > 0) {
      const { error: releaseMarkError } = await supabaseAdmin
        .from("preorder_release_events")
        .update({
          pickup_reminder_email_sent_at: sentAt
        })
        .in("id", order.releaseEventIds)
        .is("pickup_reminder_email_sent_at", null);

      if (releaseMarkError) {
        errors.push({
          orderId: order.orderId,
          error: releaseMarkError
        });
      }
    }
  }

  return {
    ok: errors.length === 0,
    sentCount,
    pickupDate: pickupDetails?.market_date_label || "",
    errors
  };
}
