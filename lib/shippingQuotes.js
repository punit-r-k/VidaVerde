import {
  createAndVerifyEasyPostAddress,
  createEasyPostShipment,
  isUsdEasyPostRate
} from "./easypost.js";
import { buildShippingPlans } from "./shippingParcels.js";
import {
  getEstimatedShipDate,
  getExpectedDeliveryDateFromShipDate
} from "./shippingPricing.js";
import {
  compareQuotesBySpeed,
  compareRatesBySpeed,
  filterRatesForTransitWindow,
  getQuoteLatestDeliveryDate,
  getQuoteTransitDays,
  getRateTransitDays,
  getSameCarrierRateSets
} from "./shippingRateRanking.js";

const centsFromRate = (rate) => Math.round(Number(rate?.rate || 0) * 100);

export const EASYPOST_RATING_BUDGET_MS = 25_000;
export const EASYPOST_RATING_REQUEST_TIMEOUT_MS = 10_000;

export const createEasyPostRatingContext = ({
  deadlineAt,
  startedAt,
  createShipment = createEasyPostShipment,
  verifyAddress = createAndVerifyEasyPostAddress
} = {}) => {
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
    verifiedAddressPromise: null,
    shipmentPromises: new Map(),
    shipmentCreateCount: 0,
    shipmentCreateLimit: null,
    addressVerificationCount: 0,
    createShipment,
    verifyAddress
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

export const hasSuccessfulDeliveryVerification = (address) =>
  Boolean(
    String(address?.id || "").trim() &&
    address?.verifications?.delivery?.success === true
  );

const getVerifiedEasyPostAddressId = async (context, toAddress) => {
  if (context.verifiedAddressId) return context.verifiedAddressId;
  if (!context.verifiedAddressPromise) {
    context.addressVerificationCount += 1;
    context.verifiedAddressPromise = Promise.resolve(context.verifyAddress(toAddress, {
      timeoutMs: getRatingRequestTimeoutMs(context)
    })).then((verifiedAddress) => {
      if (!hasSuccessfulDeliveryVerification(verifiedAddress)) {
        throw new Error("The shipping address could not be verified.");
      }
      context.verifiedAddressId = String(verifiedAddress.id).trim();
      return context.verifiedAddressId;
    });
  }
  return context.verifiedAddressPromise;
};

const getRatedEasyPostShipment = async (
  context,
  { toAddress, planKey, parcelIndex, parcel, options }
) => {
  const cacheKey = getParcelRatingKey(planKey, parcelIndex, parcel, options);
  let shipmentPromise = context.shipmentPromises.get(cacheKey);
  if (shipmentPromise) return shipmentPromise;

  const verifiedAddressId = await getVerifiedEasyPostAddressId(context, toAddress);
  if (
    !Number.isInteger(context.shipmentCreateLimit) ||
    context.shipmentCreateLimit < 1 ||
    context.shipmentCreateCount >= context.shipmentCreateLimit
  ) {
    throw new Error("The shipping provider work budget was exhausted.");
  }
  context.shipmentCreateCount += 1;
  shipmentPromise = context.createShipment({
    toAddress: { id: verifiedAddressId },
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

const getShipmentDestination = (shipment) => ({
  name: shipment.customer_name,
  street1: shipment.address1,
  street2: shipment.address2 || undefined,
  city: shipment.city,
  state: shipment.state,
  zip: shipment.postal_code,
  country: shipment.country || "US",
  phone: shipment.customer_phone || undefined,
  email: shipment.customer_email
});

const rateEasyPostParcels = async ({ shipment, parcels, planKey, ratingContext }) => {
  ratingContext.shipmentCreateLimit = parcels.length;
  const options = {
    label_format: "PDF",
    ...(ratingContext.labelDate ? { label_date: ratingContext.labelDate } : {})
  };
  const toAddress = getShipmentDestination(shipment);
  const ratedParcels = [];
  for (const [parcelIndex, parcel] of parcels.entries()) {
    const easyPostShipment = await getRatedEasyPostShipment(ratingContext, {
      toAddress,
      planKey,
      parcelIndex,
      parcel,
      options
    });
    const rates = (easyPostShipment.rates || [])
      .filter(isUsdEasyPostRate)
      .map(normalizeRate)
      .filter((rate) => rate.id && rate.amountCents > 0)
      .sort(compareRatesBySpeed);
    const normalizedParcel = { ...parcel };
    delete normalizedParcel.selectedRate;
    delete normalizedParcel.easyPostShipmentId;
    ratedParcels.push({
      ...normalizedParcel,
      easyPostShipmentId: easyPostShipment.id,
      rates
    });
  }
  return ratedParcels;
};

const buildQuotesFromRatedParcels = ({
  ratedParcels,
  planKey,
  boxCostCents,
  serviceLevel,
  transitWindow,
  labelDate
}) => {
  const eligibleParcels = ratedParcels.map((parcel) => ({
    ...parcel,
    rates: filterRatesForTransitWindow(parcel.rates, transitWindow)
      .sort(compareRatesBySpeed)
  }));
  if (eligibleParcels.some((parcel) => parcel.rates.length === 0)) return [];

  const quotes = getSameCarrierRateSets(eligibleParcels.map((parcel) => parcel.rates))
    .map((selectedRates) => {
      const quotedParcels = eligibleParcels.map((parcel, index) => {
        const quotedParcel = { ...parcel };
        delete quotedParcel.rates;
        return { ...quotedParcel, selectedRate: selectedRates[index] };
      });
      const postageCents = quotedParcels.reduce(
        (sum, parcel) => sum + parcel.selectedRate.amountCents,
        0
      );
      const carrierKey = String(selectedRates[0]?.carrier || "carrier")
        .trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
      return {
        planKey: `${planKey}__${serviceLevel}__${carrierKey}`,
        boxCostCents,
        postageCents,
        totalCostCents: boxCostCents + postageCents,
        parcels: quotedParcels,
        ...getQuoteTiming(quotedParcels, labelDate)
      };
    })
    .sort(compareQuotesBySpeed);

  const uniqueQuotes = new Map();
  quotes.forEach((quote) => {
    const signature = quote.parcels.map((parcel) =>
      `${parcel.packageCode}:${parcel.selectedRate.carrier}:${parcel.selectedRate.service}:${parcel.selectedRate.amountCents}`
    ).join("|");
    if (!uniqueQuotes.has(signature)) uniqueQuotes.set(signature, quote);
  });
  return [...uniqueQuotes.values()].slice(0, 5);
};

const getCheckoutPlan = (shipment) => {
  const plan = buildShippingPlans(shipment.items_json)[0];
  if (!plan?.parcels?.length) {
    throw new Error("This shipment has no recognized products to pack.");
  }
  return plan;
};

export async function getEasyPostQuotes(
  shipment,
  {
    transitWindow = null,
    serviceLevel = "fastest",
    ratingContext = createEasyPostRatingContext()
  } = {}
) {
  const plan = getCheckoutPlan(shipment);
  const ratedParcels = await rateEasyPostParcels({
    shipment, parcels: plan.parcels, planKey: plan.key, ratingContext
  });
  const quotes = buildQuotesFromRatedParcels({
    ratedParcels,
    planKey: plan.key,
    boxCostCents: plan.boxCostCents,
    serviceLevel,
    transitWindow,
    labelDate: ratingContext.labelDate
  });
  if (quotes.length === 0 && transitWindow) {
    throw new Error(
      `No EasyPost rate was available in the ${transitWindow.minimumDays}–${transitWindow.maximumDays} business day window.`
    );
  }
  return quotes;
}

export async function getEasyPostQuotesForServiceLevels(
  shipment,
  { serviceLevels = [], ratingContext = createEasyPostRatingContext() } = {}
) {
  const plan = getCheckoutPlan(shipment);
  const ratedParcels = await rateEasyPostParcels({
    shipment, parcels: plan.parcels, planKey: plan.key, ratingContext
  });
  return Object.fromEntries(serviceLevels.map(({ serviceLevel, transitWindow }) => [
    serviceLevel,
    buildQuotesFromRatedParcels({
      ratedParcels,
      planKey: plan.key,
      boxCostCents: plan.boxCostCents,
      serviceLevel,
      transitWindow,
      labelDate: ratingContext.labelDate
    })
  ]));
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
  const ratedParcels = await rateEasyPostParcels({
    shipment,
    parcels: selectedParcels,
    planKey: `release:${planKey}`,
    ratingContext
  });
  const boxCostCents = ratedParcels.reduce(
    (sum, parcel) => sum + Number(parcel.boxCostCents || 0),
    0
  );
  const quotes = buildQuotesFromRatedParcels({
    ratedParcels,
    planKey,
    boxCostCents,
    serviceLevel,
    transitWindow,
    labelDate: ratingContext.labelDate
  });
  if (quotes.length === 0) {
    throw new Error(
      transitWindow
        ? `No EasyPost rate was available in the ${transitWindow.minimumDays}–${transitWindow.maximumDays} business day window.`
        : "No single-carrier EasyPost rate was available for every parcel."
    );
  }
  return quotes;
}
