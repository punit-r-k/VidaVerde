import { sendMail, emailConfig } from "@/lib/email";
import { getPickupDetails } from "@/lib/pickupDetails";
import { getProductMap } from "@/lib/products";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

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
const SUPPORT_PHONE_TEL = `+1${SUPPORT_PHONE_RAW}`;
const EMAIL_SIGN_OFF = "Stay cultured,";
const EMAIL_SIGN_OFF_NAME = "The Vida Verde Team";
const PREORDER_ONLY_TIMING_NOTICE =
  "Pre-order timing is not guaranteed for the next market because fermentation and restock timing can vary.";
const MIXED_ORDER_TIMING_NOTICE =
  "Your reservation items are confirmed for the pickup date below. Your pre-ordered items are still in progress and will likely be ready on a different market day.";

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
  hasPreorderItems: false,
  hasReadyReservationItems: false,
  hasMixedReservationAndPreorderItems: false,
  readyReservationItems: [],
  preorderItems: []
};

const getOrderPreorderStatus = async (orderId) => {
  const normalizedOrderId = toText(orderId, 36);
  if (!normalizedOrderId) return EMPTY_PREORDER_STATUS;

  const { data, error } = await supabaseAdmin
    .from("order_items")
    .select("sku, quantity, preorder_qty, products(name)")
    .eq("order_id", normalizedOrderId);

  if (error) {
    console.error("order confirmation preorder lookup error:", error);
    return EMPTY_PREORDER_STATUS;
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
  items,
  preorderStatus
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
  const addressLines = fulfillment === "market" ? [] : buildAddressLines(customer);
  const orderPlacedAt = placedAt ? new Date(placedAt) : new Date();
  const pickupDetails =
    fulfillment === "market"
      ? getPickupDetails({
          now: Number.isNaN(orderPlacedAt.getTime()) ? new Date() : orderPlacedAt
        })
      : null;
  const pickupScenario = getPickupScenario(fulfillment, preorderStatus);
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
  const contactLine = `If you have any questions, call or text ${SUPPORT_PHONE_DISPLAY}.`;
  const fulfillmentCopy =
    fulfillment === "market"
      ? pickupScenario === "mixed"
        ? "Some items from your order are confirmed for the pickup date below. The rest are pre-ordered for a later market day, and we will email you again when those items are ready."
        : pickupScenario === "preorder_only"
          ? "Your order includes pre-order items. We will follow up by email after they are restocked so you can confirm whether the next market pickup works for you."
          : "Your order is reserved for pickup at the details below."
      : "We will ship this order to the address below once it is packed.";
  const orderSummaryHeading =
    pickupScenario === "mixed" || pickupScenario === "preorder_only"
      ? "Full paid order"
      : "Order summary";
  const orderSummaryLead =
    pickupScenario === "mixed"
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
    pickupScenario === "mixed" && readyReservationLines.length > 0
      ? ["Confirmed for the pickup date below:", ...readyReservationLines].join("\n")
      : "",
    (pickupScenario === "mixed" || pickupScenario === "preorder_only") &&
      preorderLines.length > 0
      ? [
          pickupScenario === "mixed"
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
    pickupNotice
      ? [pickupNotice.title + ":", ...pickupNotice.lines.map((line) => `- ${line}`)].join("\n")
      : "",
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
        pickupScenario === "mixed" && readyReservationLines.length > 0
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">Confirmed for this pickup date</h2>
            <ul style="margin: 0; padding-left: 20px;">
              ${readyReservationLines
                .map((line) => `<li style="margin-bottom: 6px;">${escapeHtml(line.slice(2))}</li>`)
                .join("")}
            </ul>
          `
          : ""
      }
      ${
        (pickupScenario === "mixed" || pickupScenario === "preorder_only") &&
        preorderLines.length > 0
          ? `
            <h2 style="margin-top: 32px; margin-bottom: 12px;">${
              pickupScenario === "mixed"
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

  const preorderStatus = await getOrderPreorderStatus(order?.orderId);

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
    items,
    preorderStatus
  });

  return sendMail({
    to: recipient,
    subject,
    text,
    html
  });
}
