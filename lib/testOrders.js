export const isFinancialTestSource = (source) => source?.livemode === false;

export const isFinancialTestCharge = (charge) =>
  isFinancialTestSource(charge);

export const isFinancialTestOrder = ({ charge, source } = {}) =>
  isFinancialTestSource(charge) || isFinancialTestSource(source);
