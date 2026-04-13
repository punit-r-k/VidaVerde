import { sendMail, emailConfig } from "@/lib/email";
import { getPickupDetails } from "@/lib/pickupDetails";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);
const SUPPORT_PHONE_RAW = "7134781878";
const SUPPORT_PHONE_DISPLAY = "(713) 478-1878";
const SUPPORT_PHONE_TEL = `+1${SUPPORT_PHONE_RAW}`;

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

const buildReadyEmailContent = ({ order, pickupDetails, hasRemainingPreorders }) => {
  const readyItems = Array.isArray(order?.readyItems) ? order.readyItems : [];
  const fullPickupItems =
    Array.isArray(order?.fullPickupItems) && order.fullPickupItems.length > 0
      ? order.fullPickupItems
      : readyItems;
  const readyLines = formatItemsText(readyItems);
  const fullPickupLines = formatItemsText(fullPickupItems);
  const hasPickupReminder =
    buildItemsSignature(fullPickupItems) !== buildItemsSignature(readyItems);
  const itemLead =
    readyLines.length === 1
      ? "A new item from your Vida Verde order just became ready for pickup."
      : "New items from your Vida Verde order just became ready for pickup.";
  const fullPickupLead = hasPickupReminder
    ? "This update adds to other Vida Verde items from the same order that are already set aside for you. We included your full pickup list below so you have one market-day checklist."
    : "";
  const partialOrderNotice = hasRemainingPreorders
    ? "Some other preorder items from your order are still in progress. We will send another update as soon as the rest are ready."
    : "Everything that was pre-ordered for this order is now ready for pickup.";
  const contactNotice =
    `If you are not able to make it to the market, call or text ${SUPPORT_PHONE_DISPLAY} and we will work with you to organize a solution that works.`;
  const subject = `Great news: your Vida Verde pre-order is ready for ${toText(
    pickupDetails?.market_date_label,
    120
  )}`;

  const text = [
    "Great news!",
    itemLead,
    "",
    "Ready now:",
    ...readyLines,
    "",
    hasPickupReminder
      ? [
          fullPickupLead,
          "",
          "Your full Vida Verde pickup list for this order:",
          ...fullPickupLines,
          ""
        ].join("\n")
      : "",
    "Pickup details:",
    `Day: ${toText(pickupDetails?.market_date_label, 120)}`,
    `Market: ${toText(pickupDetails?.market_name, 120)}`,
    `Address: ${toText(pickupDetails?.market_address, 160)}`,
    `Window: ${toText(pickupDetails?.pickup_window, 64)}`,
    "",
    partialOrderNotice,
    contactNotice,
    "",
    "We are excited to see you at the market.",
    "Vida Verde"
  ].join("\n");

  const html = `
    <div style="font-family: 'Trebuchet MS', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      <h1 style="margin-bottom: 10px;">Great news!</h1>
      <p style="margin-top: 0;">${escapeHtml(itemLead)}</p>
      <h2 style="margin-top: 28px; margin-bottom: 10px;">Ready now</h2>
      <ul style="margin: 0; padding-left: 20px;">
        ${readyLines.map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line.slice(2))}</li>`).join("")}
      </ul>
      ${
        hasPickupReminder
          ? `
            <div style="margin-top: 20px; padding: 14px 16px; background: #eef7ef; border: 1px solid #c9decf;">
              ${escapeHtml(fullPickupLead)}
            </div>
            <h2 style="margin-top: 28px; margin-bottom: 10px;">Your full Vida Verde pickup list</h2>
            <ul style="margin: 0; padding-left: 20px;">
              ${fullPickupLines.map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line.slice(2))}</li>`).join("")}
            </ul>
          `
          : ""
      }
      <h2 style="margin-top: 28px; margin-bottom: 10px;">Pickup details</h2>
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
      <div style="margin-top: 20px; padding: 14px 16px; background: #f5f3e8; border: 1px solid #d8d2bc;">
        ${escapeHtml(partialOrderNotice)}
      </div>
      <p style="margin-top: 16px; margin-bottom: 0;">
        If you are not able to make it to the market, call or text
        <a href="tel:${escapeHtml(SUPPORT_PHONE_TEL)}" style="color: #1f2937;">${escapeHtml(
          SUPPORT_PHONE_DISPLAY
        )}</a>
        and we will work with you to organize a solution that works.
      </p>
      <p style="margin-top: 24px; margin-bottom: 0;">We are excited to see you at the market.<br /><strong>Vida Verde</strong></p>
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
      customerName: toText(orderData?.customer_name, 120),
      customerEmail: email,
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
      customerName: order.customerName,
      customerEmail: order.customerEmail,
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
      "preorder ready pickup order_items lookup error:",
      orderItemsResult.error
    );
    return null;
  }

  if (releasedItemsResult.error) {
    console.error(
      "preorder ready pickup release lookup error:",
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

export async function sendPreorderReadyPickupEmails({ sku } = {}) {
  const cleanSku = toText(sku, 64).toUpperCase();
  if (!cleanSku) {
    return { ok: false, error: "SKU is required." };
  }

  if (!supabaseAdmin) {
    return { ok: false, error: "Supabase is not configured." };
  }

  if (!emailConfig) {
    return {
      ok: true,
      skipped: true,
      sentCount: 0,
      reason: "Email transport is not configured."
    };
  }

  const { data, error } = await supabaseAdmin
    .from("preorder_release_events")
    .select(
      "id, order_id, sku, quantity, created_at, products(name), orders!inner(id, status, fulfillment, customer_name, customer_email)"
    )
    .eq("sku", cleanSku)
    .eq("orders.status", "paid")
    .eq("orders.fulfillment", "market")
    .is("ready_pickup_email_sent_at", null)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    return { ok: false, error };
  }

  const orders = groupReadyRowsByOrder(data);
  const orderIds = [...orders.keys()];
  if (orderIds.length === 0) {
    return { ok: true, sentCount: 0 };
  }

  const [remainingResult, fullPickupItemsByOrder] = await Promise.all([
    supabaseAdmin
      .from("preorder_queue")
      .select("order_id")
      .in("order_id", orderIds)
      .gt("remaining", 0),
    getFullPickupItemsByOrder(orderIds)
  ]);

  if (remainingResult.error) {
    return { ok: false, error: remainingResult.error };
  }

  const remainingOrderIds = new Set(
    (remainingResult.data || [])
      .map((row) => toText(row?.order_id, 36))
      .filter(Boolean)
  );
  const pickupDetails = getPickupDetails({ now: new Date() });
  let sentCount = 0;
  const errors = [];

  for (const order of orders.values()) {
    const enrichedOrder = {
      ...order,
      fullPickupItems:
        fullPickupItemsByOrder instanceof Map
          ? fullPickupItemsByOrder.get(order.orderId) || order.readyItems
          : order.readyItems
    };
    const { subject, text, html } = buildReadyEmailContent({
      order: enrichedOrder,
      pickupDetails,
      hasRemainingPreorders: remainingOrderIds.has(order.orderId)
    });

    const emailResult = await sendMail({
      to: order.customerEmail,
      subject,
      text,
      html
    });

    if (!emailResult.ok) {
      errors.push({
        orderId: order.orderId,
        error: emailResult.error
      });
      continue;
    }

    sentCount += 1;

    const { error: markError } = await supabaseAdmin
      .from("preorder_release_events")
      .update({
        ready_pickup_email_sent_at: new Date().toISOString()
      })
      .in("id", order.releaseEventIds)
      .is("ready_pickup_email_sent_at", null);

    if (markError) {
      errors.push({
        orderId: order.orderId,
        error: markError
      });
    }
  }

  return {
    ok: errors.length === 0,
    sentCount,
    errors
  };
}
