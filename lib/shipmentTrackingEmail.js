import { getConsumerShippingDetails } from "@/lib/consumerShipping";
import { emailConfig, sendMail } from "@/lib/email";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { getPreferredTrackingNumbers } from "@/lib/trackingNumbers";

const toText = (value, max = 500) => String(value || "").trim().slice(0, max);
const escapeHtml = (value) => String(value ?? "")
  .replace(/&/g, "&amp;")
  .replace(/</g, "&lt;")
  .replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;")
  .replace(/'/g, "&#39;");

const buildAddressLines = (shipment) => [
  shipment?.address1,
  shipment?.address2,
  [shipment?.city, shipment?.state, shipment?.postal_code].filter(Boolean).join(", "),
  shipment?.country
].map((value) => toText(value, 180)).filter(Boolean);

export async function sendShipmentTrackingEmail(payload, { messageId } = {}) {
  if (!supabaseAdmin) {
    return { ok: false, code: "dependency_unavailable", error: "Shipment tracking is not connected." };
  }
  if (!emailConfig) {
    return { ok: false, code: "configuration_unavailable", error: "Email delivery is not configured." };
  }

  const shipmentId = toText(payload?.shipmentId, 36);
  if (!shipmentId) {
    return { ok: false, code: "invalid_payload", error: "Shipment ID is required." };
  }

  const { data: shipment, error } = await supabaseAdmin
    .from("shipments")
    .select(
      "id, status, customer_name, customer_email, address1, address2, city, state, postal_code, country, shipping_option, shipping_option_label, shipping_estimate, tracking_number, orders!inner(status, fulfillment, is_test_order), shipment_parcels(parcel_index, tracking_number)"
    )
    .eq("id", shipmentId)
    .maybeSingle();
  if (error) {
    return { ok: false, code: "dependency_unavailable", error };
  }

  const order = Array.isArray(shipment?.orders) ? shipment.orders[0] : shipment?.orders;
  if (
    !shipment ||
    !["label_purchased", "shipped", "delivered"].includes(shipment.status) ||
    order?.status !== "paid" ||
    order?.fulfillment !== "ship" ||
    order?.is_test_order === true
  ) {
    return { ok: false, code: "order_ineligible", error: "The shipment is not eligible for tracking delivery." };
  }

  const trackingNumbers = getPreferredTrackingNumbers({
    parcels: shipment.shipment_parcels,
    aggregateTrackingNumber: shipment.tracking_number
  });
  if (trackingNumbers.length === 0) {
    return { ok: false, code: "dependency_unavailable", error: "Shipment tracking is not available yet." };
  }

  const shipping = getConsumerShippingDetails(shipment);
  const addressLines = buildAddressLines(shipment);
  const recipient = toText(shipment.customer_email, 254).toLowerCase();
  const name = toText(shipment.customer_name, 120);
  const subject = "Your Vida Verde shipment tracking";
  const text = [
    name ? `Hi ${name},` : "Hi,",
    "",
    "Your Vida Verde shipping labels are ready and your order is being prepared for carrier handoff.",
    `Shipping method: ${shipping.label}`,
    shipment.shipping_estimate ? toText(shipment.shipping_estimate, 240) : shipping.transitLabel,
    "",
    "Tracking:",
    ...trackingNumbers.map((number) => `- ${number}`),
    "",
    addressLines.length ? ["Ship to:", ...addressLines.map((line) => `  ${line}`)].join("\n") : "",
    "",
    "Tracking may take a little time to update after the carrier receives the package.",
    "Vida Verde"
  ].filter((line) => line !== "").join("\n");
  const html = `
    <div style="font-family: 'Trebuchet MS', Tahoma, sans-serif; color: #1f2937; line-height: 1.6;">
      <h1 style="color: #14543d;">Your shipment tracking</h1>
      <p>${name ? `Hi ${escapeHtml(name)},` : "Hi,"}</p>
      <p>Your Vida Verde shipping labels are ready and your order is being prepared for carrier handoff.</p>
      <p><strong>Shipping method:</strong> ${escapeHtml(shipping.label)}<br />${escapeHtml(shipment.shipping_estimate || shipping.transitLabel)}</p>
      <div style="margin: 20px 0; padding: 16px 18px; border-left: 4px solid #176b4d; background: #eef7f1;">
        <strong style="display: block; margin-bottom: 7px; color: #14543d;">Tracking</strong>
        ${trackingNumbers.map((number) => `<span style="display: block; margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 17px; font-weight: 700; overflow-wrap: anywhere;">${escapeHtml(number)}</span>`).join("")}
      </div>
      ${addressLines.length ? `<p><strong>Ship to:</strong><br />${addressLines.map(escapeHtml).join("<br />")}</p>` : ""}
      <p>Tracking may take a little time to update after the carrier receives the package.</p>
      <p>Vida Verde</p>
    </div>`;

  const result = await sendMail({ to: recipient, subject, text, html, messageId });
  return result.ok
    ? { ok: true, code: "sent", messageId: result.messageId }
    : { ok: false, code: "smtp_failed", error: result.error };
}
