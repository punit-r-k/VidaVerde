import { sendMail, emailConfig } from "@/lib/email";
import { getPickupDetails } from "@/lib/pickupDetails";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);

const escapeHtml = (value) =>
  String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const formatReadyItemsText = (items) =>
  items
    .map((item) => {
      const quantity = Number.parseInt(item?.quantity, 10) || 0;
      const name = toText(item?.name, 120) || toText(item?.sku, 32);
      if (!name || quantity <= 0) return "";
      return `- ${name} x${quantity}`;
    })
    .filter(Boolean);

const buildReadyEmailContent = ({ order, pickupDetails, hasRemainingPreorders }) => {
  const readyLines = formatReadyItemsText(order.readyItems);
  const itemLead =
    readyLines.length === 1
      ? "Your pre-ordered item is ready for pickup."
      : "Your pre-ordered items are ready for pickup.";
  const partialOrderNotice = hasRemainingPreorders
    ? "Some other preorder items from your order are still in progress. We will send another update as soon as the rest are ready."
    : "Everything that was pre-ordered for this order is now ready for pickup.";
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
    "Pickup details:",
    `Day: ${toText(pickupDetails?.market_date_label, 120)}`,
    `Market: ${toText(pickupDetails?.market_name, 120)}`,
    `Address: ${toText(pickupDetails?.market_address, 160)}`,
    `Window: ${toText(pickupDetails?.pickup_window, 64)}`,
    "",
    partialOrderNotice,
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
      <p style="margin-top: 24px; margin-bottom: 0;">We are excited to see you at the market.<br /><strong>Vida Verde</strong></p>
    </div>
  `;

  return { subject, text, html };
};

const groupReadyRowsByOrder = (rows) =>
  (rows || []).reduce((acc, row) => {
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
      readyItems: [],
      releaseEventIds: []
    };

    current.readyItems.push({
      sku,
      name,
      quantity
    });
    current.releaseEventIds.push(releaseEventId);

    acc.set(orderId, current);
    return acc;
  }, new Map());

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

  const { data: remainingRows, error: remainingError } = await supabaseAdmin
    .from("preorder_queue")
    .select("order_id")
    .in("order_id", orderIds)
    .gt("remaining", 0);

  if (remainingError) {
    return { ok: false, error: remainingError };
  }

  const remainingOrderIds = new Set(
    (remainingRows || []).map((row) => toText(row?.order_id, 36)).filter(Boolean)
  );
  const pickupDetails = getPickupDetails({ now: new Date() });
  let sentCount = 0;
  const errors = [];

  for (const order of orders.values()) {
    const { subject, text, html } = buildReadyEmailContent({
      order,
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
