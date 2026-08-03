const toCents = (value) => {
  const cents = Number(value);
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
};

export const SINGLE_ITEM_STANDARD_DELIVERED_TOTAL_CAP_CENTS = 1998;

export const roundUpToNearestDollarCents = (amountCents) => {
  const cents = toCents(amountCents);
  return cents > 0 ? Math.ceil(cents / 100) * 100 : 0;
};

export const getShippingChargeBreakdown = (
  quote,
  { subtotalCents = 0, itemCount = 0, serviceLevel = "" } = {}
) => {
  const postageCents = toCents(quote?.postageCents);
  const packagingCents = toCents(quote?.boxCostCents);
  const unroundedCents = postageCents + packagingCents;
  const roundedCents = roundUpToNearestDollarCents(unroundedCents);
  const normalizedServiceLevel = String(serviceLevel || "").trim().toLowerCase();
  const singleItemStandardCap =
    Number(itemCount) === 1 && normalizedServiceLevel === "normal"
      ? Math.max(
          0,
          SINGLE_ITEM_STANDARD_DELIVERED_TOTAL_CAP_CENTS - toCents(subtotalCents)
        )
      : null;
  const amountCents = singleItemStandardCap == null
    ? roundedCents
    : Math.min(roundedCents, singleItemStandardCap);

  return {
    postageCents,
    packagingCents,
    unroundedCents,
    roundingCents: roundedCents - unroundedCents,
    discountCents: roundedCents - amountCents,
    amountCents
  };
};
