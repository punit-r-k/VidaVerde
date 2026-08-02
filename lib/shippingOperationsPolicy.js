const TRACKING_STATUS_RANK = Object.freeze({
  label_purchased: 1,
  shipped: 2,
  delivered: 3
});

const EASYPOST_PROGRESS_STATUSES = Object.freeze({
  pre_transit: "label_purchased",
  in_transit: "shipped",
  out_for_delivery: "shipped",
  available_for_pickup: "shipped",
  delivered: "delivered"
});

const normalizeStatus = (value) => String(value || "").trim().toLowerCase();

export const mapEasyPostTrackerStatus = (value) =>
  EASYPOST_PROGRESS_STATUSES[normalizeStatus(value)] || null;

export const getMonotonicTrackingStatus = (currentStatus, requestedStatus) => {
  const current = normalizeStatus(currentStatus);
  const requested = normalizeStatus(requestedStatus);
  const requestedRank = TRACKING_STATUS_RANK[requested];
  if (!requestedRank) return current || null;

  const currentRank = TRACKING_STATUS_RANK[current];
  if (!currentRank) {
    return current && !["pending_label", "purchasing_label"].includes(current)
      ? current
      : requested;
  }

  return requestedRank > currentRank ? requested : current;
};

export const getAggregateTrackingStatus = (statuses) => {
  const normalized = (Array.isArray(statuses) ? statuses : []).map(normalizeStatus);
  if (normalized.length === 0) return null;
  if (normalized.every((status) => status === "delivered")) return "delivered";
  if (normalized.some((status) => status === "shipped" || status === "delivered")) {
    return "shipped";
  }
  if (normalized.some((status) => status === "label_purchased")) {
    return "label_purchased";
  }
  return null;
};

const asTimestamp = (value) => {
  if (value instanceof Date) return value.getTime();
  return Number(value);
};

export const isShippingQuoteExpired = (quote, now = Date.now()) => {
  const expiresAt = Date.parse(String(quote?.expires_at || ""));
  const currentTime = asTimestamp(now);
  return !Number.isFinite(expiresAt) ||
    !Number.isFinite(currentTime) ||
    expiresAt <= currentTime;
};

export const isShippingQuoteUsable = (
  quote,
  { hasPurchasedParcels = false, now = Date.now() } = {}
) => Boolean(quote) && (hasPurchasedParcels || !isShippingQuoteExpired(quote, now));

export async function processEasyPostTrackerEvent(
  event,
  operations,
  { now = new Date() } = {}
) {
  if (event?.description !== "tracker.updated") {
    return { state: "ignored", matchedParcels: 0, updatedParcels: 0, updatedShipments: 0 };
  }

  const result = event?.result || {};
  const trackingNumber = String(result.tracking_code || "").trim();
  const targetStatus = mapEasyPostTrackerStatus(result.status);
  if (!trackingNumber || !targetStatus) {
    return { state: "ignored", matchedParcels: 0, updatedParcels: 0, updatedShipments: 0 };
  }

  const nowDate = now instanceof Date ? now : new Date(now);
  if (!Number.isFinite(nowDate.getTime())) {
    throw new TypeError("A valid tracking update timestamp is required.");
  }
  const updatedAt = nowDate.toISOString();
  const providerCarrier = normalizeStatus(result.carrier);
  const foundParcels = await operations.findParcels(trackingNumber);
  const parcels = (Array.isArray(foundParcels) ? foundParcels : []).filter((parcel) => {
    const savedCarrier = normalizeStatus(parcel?.carrier);
    return !providerCarrier || !savedCarrier || savedCarrier === providerCarrier;
  });

  const shipmentIds = new Set();
  let updatedParcels = 0;
  for (const parcel of parcels) {
    if (parcel?.shipment_id) shipmentIds.add(parcel.shipment_id);
    const nextStatus = getMonotonicTrackingStatus(parcel?.status, targetStatus);
    if (!nextStatus || nextStatus === normalizeStatus(parcel?.status)) continue;
    const updated = await operations.updateParcelStatus(parcel, nextStatus, updatedAt);
    if (updated !== false) updatedParcels += 1;
  }

  let updatedShipments = 0;
  for (const shipmentId of shipmentIds) {
    const siblingStatuses = await operations.getParcelStatuses(shipmentId);
    const aggregateStatus = getAggregateTrackingStatus(siblingStatuses);
    if (!aggregateStatus) continue;

    const shipment = await operations.getShipment(shipmentId);
    if (!shipment) continue;
    const currentStatus = normalizeStatus(shipment.status);
    const nextStatus = getMonotonicTrackingStatus(currentStatus, aggregateStatus);
    const shouldSetShippedAt =
      TRACKING_STATUS_RANK[nextStatus] >= TRACKING_STATUS_RANK.shipped &&
      !shipment.shipped_at;
    if (!nextStatus || (nextStatus === currentStatus && !shouldSetShippedAt)) continue;

    const updated = await operations.updateShipmentStatus(shipment, nextStatus, {
      shippedAt: shouldSetShippedAt ? updatedAt : null,
      updatedAt
    });
    if (updated !== false) updatedShipments += 1;
  }

  return {
    state: parcels.length > 0 ? "processed" : "not_found",
    matchedParcels: parcels.length,
    updatedParcels,
    updatedShipments
  };
}
