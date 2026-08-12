import {
  createAndVerifyEasyPostAddress,
  createEasyPostShipment,
  isUsdEasyPostRate
} from "@/lib/easypost";
import { buildShippingPlans } from "@/lib/shippingParcels";
import {
  getEstimatedShipDate,
  getExpectedDeliveryDateFromShipDate
} from "@/lib/shippingPricing";
import {
  compareQuotesBySpeed,
  compareRatesBySpeed,
  getQuoteLatestDeliveryDate,
  getQuoteTransitDays,
  getRateTransitDays,
  getSameCarrierRateSets,
  isRateWithinTransitWindow
} from "@/lib/shippingRateRanking";

const centsFromRate = (rate) => Math.round(Number(rate?.rate || 0) * 100);

export const EASYPOST_RATING_BUDGET_MS = 25_000;
export const EASYPOST_RATING_REQUEST_TIMEOUT_MS = 10_000;
export const MAX_EASYPOST_SHIPMENT_CREATES_PER_RATING = 12;

export const createEasyPostRatingContext = ({ deadlineAt, startedAt } = {}) => {
  const requestedStartedAt = startedAt instanceof Date
    ? new Date(startedAt.getTime())
    : new Date(startedAt || Date.now());
  const frozenStartedAt = Number.isNaN(requestedStartedAt.getTime())
    ? new Date()
    : requestedStartedAt;
  const estimatedShipDate = getEstimatedShipDate({ orderDate: frozenStartedAt });
  const defaultDeadlineAt = Date.now() + EASYPOST_RATING_BUDGET_MS;
  const requestedDeadlineAt = Number(deadlineAt);
  return {
    startedAt: frozenStartedAt,
    deadlineAt: Number.isFinite(requestedDeadlineAt)
      ? Math.min(defaultDeadlineAt, requestedDeadlineAt)
      : defaultDeadlineAt,
    labelDate: estimatedShipDate?.toISOString() || "",
    verifiedAddressPromise: null,
    shipmentPromises: new Map(),
    shipmentCreateCount: 0
  };
};

const getRatingRequestTimeoutMs = (context) => {
  const remainingMs = Math.floor(Number(context?.deadlineAt) - Date.now());
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Error("The shipping provider time budget was exhausted.");
  }
  return Math.min(remainingMs, EASYPOST_RATING_REQUEST_TIMEOUT_MS);
};

const getVerifiedAddress = (context, address) => {
  if (!context.verifiedAddressPromise) {
    context.verifiedAddressPromise = createAndVerifyEasyPostAddress(address, {
      timeoutMs: getRatingRequestTimeoutMs(context)
    });
  }
  return context.verifiedAddressPromise;
};

const getParcelRatingKey = (planKey, parcelIndex, parcel, options) => JSON.stringify([
  planKey,
  parcelIndex,
  parcel.length,
  parcel.width,
  parcel.height,
  parcel.weightOz,
  options?.label_date || ""
]);

const getRatedEasyPostShipment = (
  context,
  { toAddress, planKey, parcelIndex, parcel, options }
) => {
  // The same logical parcel is rated once across customer service tiers. Two
  // physically identical parcels in one plan must remain separate EasyPost
  // shipments because each needs its own label and tracking number.
  const cacheKey = getParcelRatingKey(planKey, parcelIndex, parcel, options);
  let shipmentPromise = context.shipmentPromises.get(cacheKey);
  if (shipmentPromise) return shipmentPromise;

  if (context.shipmentCreateCount >= MAX_EASYPOST_SHIPMENT_CREATES_PER_RATING) {
    throw new Error("The shipping provider work budget was exhausted.");
  }
  context.shipmentCreateCount += 1;
  shipmentPromise = createEasyPostShipment({
    toAddress,
    parcel: {
      length: parcel.length,
      width: parcel.width,
      height: parcel.height,
      weight: parcel.weightOz
    },
    options,
    timeoutMs: getRatingRequestTimeoutMs(context)
  });
  context.shipmentPromises.set(cacheKey, shipmentPromise);
  return shipmentPromise;
};

const normalizeRate = (rate) => ({
  id: String(rate?.id || ""),
  carrier: String(rate?.carrier || ""),
  service: String(rate?.service || ""),
  amountCents: centsFromRate(rate),
  currency: String(rate?.currency || "").trim().toUpperCase(),
  deliveryDays: getRateTransitDays(rate),
  deliveryDate: rate?.delivery_date || null
});

const getQuoteTiming = (parcels, labelDate) => {
  const quote = { parcels };
  const transitDays = getQuoteTransitDays(quote);
  const exactArrival = getQuoteLatestDeliveryDate(quote);
  const fallbackArrival = exactArrival || (
    Number.isFinite(transitDays) && labelDate
      ? getExpectedDeliveryDateFromShipDate({
          shipDate: new Date(labelDate),
          shippingOption: {
            deliveryEstimate: {
              maximum: { unit: "business_day", value: transitDays }
            }
          }
        })
      : null
  );

  return {
    estimatedShipDate: String(labelDate || "").slice(0, 10) || null,
    expectedArrivalDate: fallbackArrival?.toISOString().slice(0, 10) || null
  };
};

export async function getEasyPostQuotes(
  shipment,
  {
    transitWindow = null,
    serviceLevel = "fastest",
    ratingContext = createEasyPostRatingContext()
  } = {}
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
  const verifiedToAddress = await getVerifiedAddress(ratingContext, toAddress);
  const quotes = [];
  const options = {
    label_format: "PDF",
    // The shared context freezes this at the start of rating so concurrent
    // service tiers cannot straddle the weekly shipping cutoff.
    ...(ratingContext.labelDate ? { label_date: ratingContext.labelDate } : {})
  };

  for (const plan of plans) {
    const ratedParcels = [];
    let planIsEligible = true;
    for (const [parcelIndex, parcel] of plan.parcels.entries()) {
      const easyPostShipment = await getRatedEasyPostShipment(ratingContext, {
        toAddress: { id: verifiedToAddress.id },
        planKey: plan.key,
        parcelIndex,
        parcel,
        options
      });
      const rates = (easyPostShipment.rates || [])
        .filter(isUsdEasyPostRate)
        .map(normalizeRate)
        .filter((rate) => rate.id && rate.amountCents > 0)
        .filter((rate) => !transitWindow || isRateWithinTransitWindow(rate, transitWindow))
        .sort(compareRatesBySpeed);
      if (!rates.length) {
        planIsEligible = false;
        break;
      }
      ratedParcels.push({
        ...parcel,
        easyPostShipmentId: easyPostShipment.id,
        rates
      });
    }

    if (!planIsEligible || ratedParcels.length !== plan.parcels.length) continue;

    const sameCarrierRateSets = getSameCarrierRateSets(
      ratedParcels.map((parcel) => parcel.rates)
    );
    sameCarrierRateSets.forEach((selectedRates) => {
      const quotedParcels = ratedParcels.map((parcel, index) => {
        const quotedParcel = { ...parcel };
        delete quotedParcel.rates;
        return {
          ...quotedParcel,
          selectedRate: selectedRates[index]
        };
      });
      const postageCents = quotedParcels.reduce(
        (sum, parcel) => sum + parcel.selectedRate.amountCents,
        0
      );
      const carrierKey = String(selectedRates[0]?.carrier || "carrier")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");
      quotes.push({
        planKey: `${plan.key}__${serviceLevel}__${carrierKey}`,
        boxCostCents: plan.boxCostCents,
        postageCents,
        totalCostCents: plan.boxCostCents + postageCents,
        parcels: quotedParcels,
        ...getQuoteTiming(quotedParcels, ratingContext.labelDate)
      });
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
