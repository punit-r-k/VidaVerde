import {
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
    verifiedAddressId: "",
    shipmentPromises: new Map(),
    shipmentCreateCount: 0,
    shipmentCreateLimit: null,
    addressVerificationCount: 0
  };
};

const getRatingRequestTimeoutMs = (context) => {
  const remainingMs = Math.floor(Number(context?.deadlineAt) - Date.now());
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) {
    throw new Error("The shipping provider time budget was exhausted.");
  }
  return Math.min(remainingMs, EASYPOST_RATING_REQUEST_TIMEOUT_MS);
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

  if (
    !Number.isInteger(context.shipmentCreateLimit) ||
    context.shipmentCreateLimit < 1 ||
    context.shipmentCreateCount >= context.shipmentCreateLimit
  ) {
    throw new Error("The shipping provider work budget was exhausted.");
  }
  context.shipmentCreateCount += 1;
  const inlineToAddress = context.verifiedAddressId
    ? { id: context.verifiedAddressId }
    : { ...toAddress, verify: ["delivery"] };
  if (!context.verifiedAddressId) context.addressVerificationCount += 1;
  shipmentPromise = createEasyPostShipment({
    toAddress: inlineToAddress,
    parcel: {
      length: parcel.length,
      width: parcel.width,
      height: parcel.height,
      weight: parcel.weightOz
    },
    options,
    timeoutMs: getRatingRequestTimeoutMs(context)
  });
  shipmentPromise = shipmentPromise.then((shipment) => {
    const verifiedAddressId = String(shipment?.to_address?.id || "").trim();
    if (!context.verifiedAddressId && !verifiedAddressId) {
      throw new Error("The shipping address could not be verified.");
    }
    if (verifiedAddressId) context.verifiedAddressId = verifiedAddressId;
    return shipment;
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
  const plan = buildShippingPlans(shipment.items_json)[0];
  if (!plan?.parcels?.length) {
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
  ratingContext.shipmentCreateLimit = plan.parcels.length;
  const quotes = [];
  const options = {
    label_format: "PDF",
    // The shared context freezes this at the start of rating so concurrent
    // service tiers cannot straddle the weekly shipping cutoff.
    ...(ratingContext.labelDate ? { label_date: ratingContext.labelDate } : {})
  };

  for (const selectedPlan of [plan]) {
    const ratedParcels = [];
    let planIsEligible = true;
    for (const [parcelIndex, parcel] of selectedPlan.parcels.entries()) {
      const easyPostShipment = await getRatedEasyPostShipment(ratingContext, {
        toAddress,
        planKey: selectedPlan.key,
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

    if (!planIsEligible || ratedParcels.length !== selectedPlan.parcels.length) continue;

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
        planKey: `${selectedPlan.key}__${serviceLevel}__${carrierKey}`,
        boxCostCents: selectedPlan.boxCostCents,
        postageCents,
        totalCostCents: selectedPlan.boxCostCents + postageCents,
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

export async function getEasyPostQuotesForParcels(
  shipment,
  {
    parcels,
    planKey = "release",
    transitWindow = null,
    serviceLevel = "fastest",
    ratingContext = createEasyPostRatingContext()
  } = {}
) {
  const selectedParcels = Array.isArray(parcels) ? parcels : [];
  if (selectedParcels.length === 0) {
    throw new Error("This shipment has no parcel plan to release.");
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
  ratingContext.shipmentCreateLimit = selectedParcels.length;
  const options = {
    label_format: "PDF",
    ...(ratingContext.labelDate ? { label_date: ratingContext.labelDate } : {})
  };
  const ratedParcels = [];

  for (const [parcelIndex, parcel] of selectedParcels.entries()) {
    const easyPostShipment = await getRatedEasyPostShipment(ratingContext, {
      toAddress,
      planKey: `release:${planKey}`,
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
    if (rates.length === 0) {
      throw new Error(
        transitWindow
          ? `No EasyPost rate was available in the ${transitWindow.minimumDays}–${transitWindow.maximumDays} business day window.`
          : "EasyPost returned no shipping rates for the release parcel plan."
      );
    }
    const normalizedParcel = { ...parcel };
    delete normalizedParcel.selectedRate;
    delete normalizedParcel.easyPostShipmentId;
    ratedParcels.push({
      ...normalizedParcel,
      easyPostShipmentId: easyPostShipment.id,
      rates
    });
  }

  const quotes = getSameCarrierRateSets(ratedParcels.map((parcel) => parcel.rates))
    .map((selectedRates) => {
      const quotedParcels = ratedParcels.map((parcel, index) => {
        const quotedParcel = { ...parcel };
        delete quotedParcel.rates;
        return { ...quotedParcel, selectedRate: selectedRates[index] };
      });
      const postageCents = quotedParcels.reduce(
        (sum, parcel) => sum + parcel.selectedRate.amountCents,
        0
      );
      const carrierKey = String(selectedRates[0]?.carrier || "carrier")
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_");
      return {
        planKey: `${planKey}__${serviceLevel}__${carrierKey}`,
        boxCostCents: quotedParcels.reduce(
          (sum, parcel) => sum + Number(parcel.boxCostCents || 0),
          0
        ),
        postageCents,
        totalCostCents:
          postageCents + quotedParcels.reduce(
            (sum, parcel) => sum + Number(parcel.boxCostCents || 0),
            0
          ),
        parcels: quotedParcels,
        ...getQuoteTiming(quotedParcels, ratingContext.labelDate)
      };
    })
    .sort(compareQuotesBySpeed);

  if (quotes.length === 0) {
    throw new Error("No single-carrier EasyPost rate was available for every parcel.");
  }
  return quotes.slice(0, 5);
}
