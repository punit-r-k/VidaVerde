import { verifyEasyPostWebhook } from "@/lib/easypost";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";

export async function POST(request) {
  const rawBody = await request.text();
  if (!verifyEasyPostWebhook(rawBody, {
    signature: request.headers.get("x-hmac-signature-v2"),
    timestamp: request.headers.get("x-timestamp"),
    path: request.headers.get("x-path"),
    method: request.method
  })) {
    return Response.json({ error: "Invalid webhook signature." }, { status: 401 });
  }
  const event = JSON.parse(rawBody);
  const result = event?.result || {};
  if (supabaseAdmin && event?.description === "tracker.updated" && result?.tracking_code) {
    const status = result.status === "delivered" ? "delivered" : result.status === "pre_transit" ? "label_purchased" : "shipped";
    const { data: parcels } = await supabaseAdmin.from("shipment_parcels").update({ status, updated_at: new Date().toISOString() }).eq("tracking_number", result.tracking_code).select("shipment_id");
    for (const parcel of parcels || []) {
      const { data: siblings } = await supabaseAdmin.from("shipment_parcels").select("status").eq("shipment_id", parcel.shipment_id);
      const statuses = (siblings || []).map((row) => row.status);
      const aggregate = statuses.length && statuses.every((value) => value === "delivered") ? "delivered" : statuses.some((value) => ["shipped", "delivered"].includes(value)) ? "shipped" : "label_purchased";
      await supabaseAdmin.from("shipments").update({ status: aggregate, ...(aggregate === "shipped" ? { shipped_at: new Date().toISOString() } : {}), updated_at: new Date().toISOString() }).eq("id", parcel.shipment_id);
    }
  }
  return Response.json({ received: true });
}
