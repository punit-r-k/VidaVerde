const toFiniteNonNegativeNumber = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
};

export const getRateTransitDays = (rate) =>
  toFiniteNonNegativeNumber(rate?.deliveryDays ?? rate?.delivery_days) ??
  toFiniteNonNegativeNumber(rate?.estimatedDeliveryDays ?? rate?.est_delivery_days);

const compareText = (left, right) =>
  String(left || "").localeCompare(String(right || ""), "en", { sensitivity: "base" });

export const compareRatesBySpeed = (left, right) => {
  const leftDays = getRateTransitDays(left);
  const rightDays = getRateTransitDays(right);

  if (leftDays !== null || rightDays !== null) {
    if (leftDays === null) return 1;
    if (rightDays === null) return -1;
    if (leftDays !== rightDays) return leftDays - rightDays;
  }

  const amountDifference =
    Number(left?.amountCents || 0) - Number(right?.amountCents || 0);
  if (amountDifference !== 0) return amountDifference;

  return (
    compareText(left?.carrier, right?.carrier) ||
    compareText(left?.service, right?.service) ||
    compareText(left?.id, right?.id)
  );
};

export const getQuoteTransitDays = (quote) => {
  const parcels = Array.isArray(quote?.parcels) ? quote.parcels : [];
  if (parcels.length === 0) return null;

  const transitDays = parcels.map((parcel) =>
    getRateTransitDays(parcel?.selectedRate)
  );
  if (transitDays.some((days) => days === null)) return null;

  return Math.max(...transitDays);
};

export const compareQuotesBySpeed = (left, right) => {
  const leftDays = getQuoteTransitDays(left);
  const rightDays = getQuoteTransitDays(right);

  if (leftDays !== null || rightDays !== null) {
    if (leftDays === null) return 1;
    if (rightDays === null) return -1;
    if (leftDays !== rightDays) return leftDays - rightDays;
  }

  const postageDifference =
    Number(left?.postageCents || 0) - Number(right?.postageCents || 0);
  if (postageDifference !== 0) return postageDifference;

  const parcelDifference =
    Number(left?.parcels?.length || 0) - Number(right?.parcels?.length || 0);
  if (parcelDifference !== 0) return parcelDifference;

  return compareText(left?.planKey, right?.planKey);
};

export const chooseFastestQuote = (quotes) =>
  [...(Array.isArray(quotes) ? quotes : [])].sort(compareQuotesBySpeed)[0] || null;
