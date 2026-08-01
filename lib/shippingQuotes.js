import { createEasyPostShipment } from "@/lib/easypost";
import { buildShippingPlans } from "@/lib/shippingParcels";
import { getEstimatedShipDate } from "@/lib/shippingPricing";
import {
  compareQuotesBySpeed,
  compareRatesBySpeed,
  getRateTransitDays,
  isRateWithinTransitWindow
} from "@/lib/shippingRateRanking";

const centsFromRate = (rate) => Math.round(Number(rate?.rate || 0) * 100);

const normalizeRate = (rate) => ({
  id: String(rate?.id || ""),
  carrier: String(rate?.carrier || ""),
  service: String(rate?.service || ""),
  amountCents: centsFromRate(rate),
  currency: String(rate?.currency || "USD").toUpperCase(),
  deliveryDays: getRateTransitDays(rate),
  deliveryDate: rate?.delivery_date || null
});

export async function getEasyPostQuotes(
  shipment,
  { transitWindow = null, serviceLevel = "fastest" } = {}
) {
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
  const quotes = [];
  const estimatedShipDate = getEstimatedShipDate({
    orderDate: shipment.created_at || new Date()
  });
  const options = {
    label_format: "PDF",
    ...(estimatedShipDate ? { label_date: estimatedShipDate.toISOString() } : {})
  };

  for (const plan of plans) {
    const quotedParcels = [];
    let planIsEligible = true;
    for (const parcel of plan.parcels) {
      const easyPostShipment = await createEasyPostShipment({
        toAddress,
        parcel: { length: parcel.length, width: parcel.width, height: parcel.height, weight: parcel.weightOz },
        options
      });
      const rates = (easyPostShipment.rates || []).map(normalizeRate)
        .filter((rate) => rate.id && rate.amountCents > 0)
        .filter((rate) => !transitWindow || isRateWithinTransitWindow(rate, transitWindow))
        .sort(compareRatesBySpeed);
      if (!rates.length) {
        planIsEligible = false;
        break;
      }
      quotedParcels.push({
        ...parcel,
        easyPostShipmentId: easyPostShipment.id,
        selectedRate: rates[0]
      });
    }

    if (!planIsEligible || quotedParcels.length !== plan.parcels.length) continue;

    const postageCents = quotedParcels.reduce(
      (sum, parcel) => sum + parcel.selectedRate.amountCents,
      0
    );
    quotes.push({
      planKey: `${plan.key}__${serviceLevel}`,
      boxCostCents: plan.boxCostCents,
      postageCents,
      totalCostCents: plan.boxCostCents + postageCents,
      parcels: quotedParcels
    });
  }

  const uniqueQuotes = new Map();
  quotes.sort(compareQuotesBySpeed).forEach((quote) => {
    const signature = quote.parcels.map((parcel) =>
      `${parcel.packageCode}:${parcel.selectedRate.carrier}:${parcel.selectedRate.service}:${parcel.selectedRate.amountCents}`
    ).join("|");
    if (!uniqueQuotes.has(signature)) uniqueQuotes.set(signature, quote);
  });
  const eligibleQuotes = [...uniqueQuotes.values()].slice(0, 5);
  if (eligibleQuotes.length === 0 && transitWindow) {
    throw new Error(
      `No EasyPost rate was available in the ${transitWindow.minimumDays}–${transitWindow.maximumDays} business day window.`
    );
  }
  return eligibleQuotes;
}
