import { verifyEasyPostWebhook } from "@/lib/easypost";
import { securePublicRoute } from "@/lib/apiSecurity";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { readBoundedTextBody } from "@/lib/requestBody";
import {
  getMonotonicTrackingStatus,
  processEasyPostTrackerEvent
} from "@/lib/shippingOperationsPolicy";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
const MAX_WEBHOOK_BYTES = 256 * 1024;
const EASYPOST_WEBHOOK_RATE_LIMIT = getRouteRateLimitConfig("EASYPOST_WEBHOOK_POST", {
  windowMs: 60_000,
  ipMax: 240
});

const retryableDatabaseResponse = (respond) => respond.json(
  { error: "Tracking could not be saved. EasyPost should retry this update." },
  {
    status: 503,
    headers: { "Retry-After": "30" }
  }
);

const buildTrackingOperations = () => ({
  findParcels: async (trackingNumber) => {
    const { data, error } = await supabaseAdmin
      .from("shipment_parcels")
      .select("id,shipment_id,status,carrier")
      .eq("tracking_number", trackingNumber);
    if (error) throw error;
    return data || [];
  },
  updateParcelStatus: async (parcel, status, updatedAt) => {
    let currentStatus = parcel.status;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nextStatus = getMonotonicTrackingStatus(currentStatus, status);
      if (!nextStatus || nextStatus === String(currentStatus || "").toLowerCase()) {
        return false;
      }

      const { data: updated, error } = await supabaseAdmin
        .from("shipment_parcels")
        .update({ status: nextStatus, updated_at: updatedAt })
        .eq("id", parcel.id)
        .eq("status", currentStatus)
        .select("id,status")
        .maybeSingle();
      if (error) throw error;
      if (updated) return true;

      const { data: current, error: currentError } = await supabaseAdmin
        .from("shipment_parcels")
        .select("status")
        .eq("id", parcel.id)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) return false;
      currentStatus = current.status;
    }

    throw new Error("A concurrent parcel tracking update did not settle safely.");
  },
  getParcelStatuses: async (shipmentId) => {
    const { data, error } = await supabaseAdmin
      .from("shipment_parcels")
      .select("status")
      .eq("shipment_id", shipmentId);
    if (error) throw error;
    return (data || []).map((row) => row.status);
  },
  getShipment: async (shipmentId) => {
    const { data, error } = await supabaseAdmin
      .from("shipments")
      .select("id,status,shipped_at")
      .eq("id", shipmentId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  },
  updateShipmentStatus: async (shipment, status, { shippedAt, updatedAt }) => {
    let current = shipment;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const currentStatus = String(current?.status || "").toLowerCase();
      const nextStatus = getMonotonicTrackingStatus(currentStatus, status);
      const nextShippedAt = current?.shipped_at || shippedAt || null;
      if (!nextStatus || (nextStatus === currentStatus && current?.shipped_at)) {
        return false;
      }

      const { data: updated, error } = await supabaseAdmin
        .from("shipments")
        .update({
          status: nextStatus,
          ...(nextShippedAt ? { shipped_at: nextShippedAt } : {}),
          updated_at: updatedAt
        })
        .eq("id", shipment.id)
        .eq("status", current.status)
        .select("id,status,shipped_at")
        .maybeSingle();
      if (error) throw error;
      if (updated) return true;

      const { data: refreshed, error: refreshError } = await supabaseAdmin
        .from("shipments")
        .select("id,status,shipped_at")
        .eq("id", shipment.id)
        .maybeSingle();
      if (refreshError) throw refreshError;
      if (!refreshed) return false;
      current = refreshed;
    }

    throw new Error("A concurrent shipment tracking update did not settle safely.");
  }
});

export async function POST(request) {
  const security = await securePublicRoute(request, {
    scope: "easypost:webhook:post",
    rateLimit: EASYPOST_WEBHOOK_RATE_LIMIT,
    rateLimitExceededMessage: "Too many webhook requests. Please retry shortly."
  });
  if (!security.ok) return security.response;
  const { respond } = security;

  const bodyResult = await readBoundedTextBody(request, { maxBytes: MAX_WEBHOOK_BYTES });
  if (!bodyResult.ok) {
    return respond.json(
      { error: bodyResult.status === 413 ? "Webhook payload is too large." : "Invalid webhook request." },
      { status: bodyResult.status }
    );
  }
  const rawBody = bodyResult.text;

  if (!verifyEasyPostWebhook(rawBody, {
    signature: request.headers.get("x-hmac-signature")
  })) {
    return respond.json({ error: "Invalid webhook signature." }, { status: 401 });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return respond.json({ error: "Invalid webhook payload." }, { status: 400 });
  }

  if (!supabaseAdmin) return retryableDatabaseResponse(respond);

  try {
    const result = await processEasyPostTrackerEvent(
      event,
      buildTrackingOperations()
    );
    return respond.json({ received: true, ...result });
  } catch (error) {
    console.error("EasyPost tracking webhook database update failed:", error?.message || error);
    return retryableDatabaseResponse(respond);
  }
}
