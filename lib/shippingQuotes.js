import { createEasyPostShipment } from "@/lib/easypost";
import { buildShippingPlans } from "@/lib/shippingParcels";

const centsFromRate = (rate) => Math.round(Number(rate?.rate || 0) * 100);
const maxDeliveryDays = (shipment) => shipment.shipping_option === "expedited" ? 3 : 5;

const normalizeRate = (rate) => ({
  id: String(rate?.id || ""),
  carrier: String(rate?.carrier || ""),
  service: String(rate?.service || ""),
  amountCents: centsFromRate(rate),
  currency: String(rate?.currency || "USD").toUpperCase(),
  deliveryDays: Number.isFinite(Number(rate?.delivery_days)) ? Number(rate.delivery_days) : null,
  deliveryDate: rate?.delivery_date || null
});

export async function getEasyPostQuotes(shipment) {
  const plans = buildShippingPlans(shipment.items_json);
  if (!plans.length || plans.every((plan) => !plan.parcels.length)) {
    throw new Error("This shipment has no recognized products to pack.");
  }
  const toAddress = {
    name: shipment.customer_name,
    street1: shipment.address1,
    street2: shipment.address2 || undefined,
    city: shipment.city,
    state: shipment.state,
    zip: shipment.postal_code,
    country: shipment.country || "US",
    phone: shipment.customer_phone || undefined,
    email: shipment.customer_email
  };
  const deadline = maxDeliveryDays(shipment);
  const quotes = [];

  for (const plan of plans) {
    const quotedParcels = [];
    for (const parcel of plan.parcels) {
      const easyPostShipment = await createEasyPostShipment({
        toAddress,
        parcel: { length: parcel.length, width: parcel.width, height: parcel.height, weight: parcel.weightOz }
      });
      const rates = (easyPostShipment.rates || []).map(normalizeRate)
        .filter((rate) => rate.id && rate.amountCents > 0)
        .filter((rate) => rate.deliveryDays === null || rate.deliveryDays <= deadline)
        .sort((a, b) => a.amountCents - b.amountCents);
      if (!rates.length) throw new Error(`No eligible EasyPost rate was returned for ${parcel.packageCode}.`);
      quotedParcels.push({ ...parcel, easyPostShipmentId: easyPostShipment.id, selectedRate: rates[0], rates: rates.slice(0, 5) });
    }
    const postageCents = quotedParcels.reduce((sum, parcel) => sum + parcel.selectedRate.amountCents, 0);
    quotes.push({
      planKey: plan.key,
      boxCostCents: plan.boxCostCents,
      postageCents,
      totalCostCents: plan.boxCostCents + postageCents,
      parcels: quotedParcels
    });
  }
  return quotes.sort((a, b) => a.totalCostCents - b.totalCostCents).slice(0, 5);
}
