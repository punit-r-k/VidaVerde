import { shipmentIdSchema, shipmentLabelPurchaseSchema } from "@/lib/adminSchemas";
import { secureAdminRoute } from "@/lib/apiSecurity";
import { buyEasyPostShipment } from "@/lib/easypost";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const runtime = "nodejs";
const ROLES = ["admin", "ops_admin"];
const RATE_LIMIT = getRouteRateLimitConfig("ADMIN_SHIPMENT_LABELS_POST", { windowMs: 60_000, ipMax: 20, userMax: 10 });

export async function POST(request, context) {
  const security = await secureAdminRoute(request, { scope: "admin:shipment-labels:post", requiredRoles: ROLES, rateLimit: RATE_LIMIT });
  if (!security.ok) return security.response;
  const { respond } = security;
  const id = shipmentIdSchema.safeParse((await context.params).id);
  const body = shipmentLabelPurchaseSchema.safeParse(await request.json().catch(() => null));
  if (!id.success || !body.success) return respond.json({ error: id.error?.issues[0]?.message || body.error?.issues[0]?.message || "Invalid request." }, { status: 400 });
  if (!supabaseAdmin) return respond.json({ error: "Shipping data is not connected." }, { status: 500 });

  const { data: shipment } = await supabaseAdmin.from("shipments").select("id, status").eq("id", id.data).maybeSingle();
  if (!shipment) return respond.json({ error: "Shipment not found." }, { status: 404 });
  const { data: quote } = await supabaseAdmin.from("shipment_quotes").select("*").eq("id", body.data.quote_id).eq("shipment_id", id.data).maybeSingle();
  if (!quote || new Date(quote.expires_at).getTime() <= Date.now()) return respond.json({ error: "That quote is missing or expired. Get fresh rates first." }, { status: 409 });

  try {
    const purchased = [];
    for (let index = 0; index < quote.quote_json.parcels.length; index += 1) {
      const parcel = quote.quote_json.parcels[index];
      const { data: existing } = await supabaseAdmin.from("shipment_parcels").select("*").eq("easypost_shipment_id", parcel.easyPostShipmentId).maybeSingle();
      if (existing) {
        purchased.push(existing);
        continue;
      }
      const bought = await buyEasyPostShipment(parcel.easyPostShipmentId, parcel.selectedRate.id);
      const label = bought.postage_label || {};
      const record = {
        shipment_id: id.data, quote_id: quote.id, parcel_index: index + 1,
        product_family: parcel.family, package_code: parcel.packageCode, supplier: parcel.supplier,
        item_quantity: parcel.quantity, length: parcel.length, width: parcel.width, height: parcel.height,
        weight_oz: parcel.weightOz, box_cost_cents: parcel.boxCostCents,
        easypost_shipment_id: bought.id, easypost_rate_id: parcel.selectedRate.id,
        postage_cents: parcel.selectedRate.amountCents, carrier: bought.selected_rate?.carrier || parcel.selectedRate.carrier,
        service: bought.selected_rate?.service || parcel.selectedRate.service, tracking_number: bought.tracking_code || "",
        label_url: label.label_url || "", label_pdf_url: label.label_pdf_url || "", status: "label_purchased", purchased_at: new Date().toISOString()
      };
      const { error: parcelError } = await supabaseAdmin.from("shipment_parcels").upsert(record, { onConflict: "easypost_shipment_id" });
      if (parcelError) throw parcelError;
      purchased.push(record);
    }
    const first = purchased[0];
    const { error: updateError } = await supabaseAdmin.from("shipments").update({
      status: "label_purchased", label_provider: "easypost", label_url: first?.label_url || "",
      tracking_number: purchased.map((parcel) => parcel.tracking_number).filter(Boolean).join(", "),
      carrier: [...new Set(purchased.map((parcel) => parcel.carrier).filter(Boolean))].join(", "),
      service: [...new Set(purchased.map((parcel) => parcel.service).filter(Boolean))].join(", "),
      label_purchased_at: new Date().toISOString(), updated_at: new Date().toISOString()
    }).eq("id", id.data);
    if (updateError) throw updateError;
    return respond.json({ shipment_id: id.data, parcels: purchased });
  } catch (purchaseError) {
    console.error("EasyPost label purchase failed:", purchaseError?.message || purchaseError);
    return respond.json({ error: purchaseError?.message || "The labels could not be purchased." }, { status: 502 });
  }
}
