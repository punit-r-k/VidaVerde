import { sendMail, emailConfig } from "@/lib/email";
import { getPickupDetails } from "@/lib/pickupDetails";
import { getProductMap } from "@/lib/products";

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

const formatFulfillmentLabel = (value) =>
  value === "market" ? "Farmers market pickup" : "Shipping";

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
const SUPPORT_PHONE_TEL = `+1${SUPPORT_PHONE_RAW}`;
const EMAIL_SIGN_OFF = "Stay cultured,";
const EMAIL_SIGN_OFF_NAME = "The Vida Verde Team";

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

const buildPickupLines = (pickupDetails) => {
  if (!pickupDetails) return [];

  return [
    `Market: ${toText(pickupDetails.market_name, 120)}`,
    `Address: ${toText(pickupDetails.market_address, 160)}`,
    `Pickup window: ${toText(pickupDetails.pickup_window, 64)}`,
    `Pickup date: ${toText(pickupDetails.market_date_label, 120)}`
  ].filter(Boolean);
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

const buildEmailContent = ({
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
  items
}) => {
  const receiptNumberText = toText(receiptNumber, 120);
  const shortOrderId = toText(orderId, 36);
  const fulfillmentLabel = formatFulfillmentLabel(fulfillment);
  const paymentMethodText = toText(paymentMethodLabel, 120);
  const itemLines = items.map((item) => ({
    ...item,
    lineTotal: item.quantity * item.price_cents
  }));
  const customerLines = buildCustomerLines(customer);
  const addressLines = fulfillment === "market" ? [] : buildAddressLines(customer);
  const orderPlacedAt = placedAt ? new Date(placedAt) : new Date();
  const pickupDetails =
    fulfillment === "market"
      ? getPickupDetails({
          now: Number.isNaN(orderPlacedAt.getTime()) ? new Date() : orderPlacedAt
        })
      : null;
  const pickupLines = buildPickupLines(pickupDetails);
  const pickupPolicyLines = Array.isArray(pickupDetails?.policy_lines)
    ? pickupDetails.policy_lines.slice(0, 4)
    : [];
  const note = toText(customer?.note, 500);
  const contactLine = `If you have any questions, call or text ${SUPPORT_PHONE_DISPLAY}.`;
  const fulfillmentCopy =
    fulfillment === "market"
      ? "Your order is reserved for pickup at the details below."
      : "We will ship this order to the address below once it is packed.";

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
    [
      "Order summary:",
      ...itemLines.map(
        (item) =>
          `- ${item.name} x${item.quantity} @ ${formatMoney(
            item.price_cents,
            currency
          )} = ${formatMoney(item.lineTotal, currency)}`
      )
    ].join("\n"),
    [
      formatTextSummaryLine("Subtotal", formatMoney(subtotal, currency)),
      formatTextSummaryLine("Tax", formatMoney(tax, currency)),
      formatTextSummaryLine("Shipping", formatMoney(shipping, currency)),
      formatTextSummaryLine("TOTAL", formatMoney(total, currency))
    ].join("\n"),
    pickupLines.length > 0 ? ["Pickup details:", ...pickupLines].join("\n") : "",
    pickupPolicyLines.length > 0
      ? ["Pickup policy reminders:", ...pickupPolicyLines.map((line) => `- ${line}`)].join("\n")
      : "",
    customerLines.length > 0 ? ["Customer:", ...customerLines].join("\n") : "",
    addressLines.length > 0 ? ["Shipping address:", ...addressLines].join("\n") : "",
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
                <tr>
                  <td style="padding: 4px 0; color: #6b7280; width: 160px;">Pickup date</td>
                  <td style="padding: 4px 0;"><strong>${escapeHtml(
                    pickupDetails.market_date_label
                  )}</strong></td>
                </tr>
              </tbody>
            </table>
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
      <h2 style="margin-top: 32px; margin-bottom: 12px;">Order summary</h2>
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
        addressLines.length > 0
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
        If you have any questions, call or text
        <a href="tel:${escapeHtml(SUPPORT_PHONE_TEL)}" style="color: #1f2937;">${escapeHtml(
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

export async function sendOrderConfirmationEmail(order) {
  if (!emailConfig) {
    return {
      ok: true,
      skipped: true,
      reason: "Email transport is not configured."
    };
  }

  const recipient = toText(order?.customer?.email, 254);
  if (!recipient) {
    return {
      ok: false,
      error: "Customer email is missing."
    };
  }

  const items = await enrichItems(order?.items);
  if (items.length === 0) {
    return {
      ok: false,
      error: "Order items are missing."
    };
  }

  const { subject, text, html } = buildEmailContent({
    orderId: order?.orderId,
    fulfillment: order?.fulfillment,
    currency: order?.currency,
    subtotal: order?.subtotal,
    tax: order?.tax,
    shipping: order?.shipping,
    total: order?.total,
    placedAt: order?.placedAt,
    receiptNumber: order?.receiptNumber,
    paymentMethodLabel: order?.paymentMethodLabel,
    customer: order?.customer,
    items
  });

  return sendMail({
    to: recipient,
    subject,
    text,
    html
  });
}
