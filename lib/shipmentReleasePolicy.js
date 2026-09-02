export const SHIPMENT_RELEASE_LEASE_MS = 15 * 60 * 1000;

export const getShipmentReleaseBlockReason = ({
  shipment,
  order,
  hasOutstandingPreorders = false,
  now = Date.now()
} = {}) => {
  if (!shipment) return "Shipment not found.";
  if (!order) return "The order for this shipment was not found.";
  if (order.is_test_order === true) return "Financial test orders cannot be released.";

  const status = String(shipment.status || "pending_label");
  if (["label_purchased", "shipped", "delivered"].includes(status)) {
    return "This shipment already has purchased labels.";
  }
  if (status === "cancelled") return "This shipment is cancelled.";
  if (status === "purchasing_label") {
    const startedAt = Date.parse(String(shipment.label_purchase_started_at || ""));
    const nowMs = now instanceof Date ? now.getTime() : Number(now);
    if (
      !Number.isFinite(startedAt) ||
      !Number.isFinite(nowMs) ||
      nowMs - startedAt < SHIPMENT_RELEASE_LEASE_MS
    ) {
      return "A label purchase is already in progress for this shipment.";
    }
  }
  if (order.fulfillment !== "ship") return "This order is not a shipping order.";
  if (order.status === "disputed") {
    return "This order cannot be released while its payment is disputed.";
  }
  if (order.status !== "paid") return "Only active paid orders can be released.";
  if (hasOutstandingPreorders) {
    return "This shipment is waiting for all preorder items to become ready.";
  }
  if (!["pending_label", "purchasing_label"].includes(status)) {
    return "This shipment is not awaiting manual release.";
  }
  return "";
};

export const summarizeShipmentReleaseQuote = ({ shipment, quote, order }) => ({
  shipment_id: shipment.id,
  quote_id: quote.id,
  expires_at: quote.expires_at,
  parcel_count: Array.isArray(quote?.quote_json?.parcels)
    ? quote.quote_json.parcels.length
    : 0,
  postage_cents: Number(quote.postage_cents || 0),
  packaging_cents: Number(quote.box_cost_cents || 0),
  customer_shipping_charge_cents: Number(order?.amount_shipping || 0),
  currency: String(quote.currency || "USD").toUpperCase()
});
