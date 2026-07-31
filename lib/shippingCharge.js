const toCents = (value) => {
  const cents = Number(value);
  return Number.isFinite(cents) && cents > 0 ? Math.round(cents) : 0;
};

export const roundUpToNearestDollarCents = (amountCents) => {
  const cents = toCents(amountCents);
  return cents > 0 ? Math.ceil(cents / 100) * 100 : 0;
};

export const getShippingChargeBreakdown = (quote) => {
  const postageCents = toCents(quote?.postageCents);
  const packagingCents = toCents(quote?.boxCostCents);
  const unroundedCents = postageCents + packagingCents;
  const amountCents = roundUpToNearestDollarCents(unroundedCents);

  return {
    postageCents,
    packagingCents,
    unroundedCents,
    roundingCents: amountCents - unroundedCents,
    amountCents
  };
};
