export const FINANCIAL_TEST_CARD_LAST4 = "4242";

export const getChargeCardLast4 = (charge) =>
  String(charge?.payment_method_details?.card?.last4 || "").trim().slice(0, 4);

export const isFinancialTestCharge = (charge) =>
  getChargeCardLast4(charge) === FINANCIAL_TEST_CARD_LAST4;
