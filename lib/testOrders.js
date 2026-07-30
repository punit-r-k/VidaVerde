export const FINANCIAL_TEST_CARD_LAST4 = "4242";
export const FINANCIAL_TEST_CUSTOMER_EMAIL = "punit1012@tamu.edu";
export const FINANCIAL_TEST_EMAILS = Object.freeze([
  "punit@peridotkonda",
  "punit@peridotkonda.com",
  "vidaverdemicrogreens@gmail.com"
]);

export const getChargeCardLast4 = (charge) =>
  String(charge?.payment_method_details?.card?.last4 || "").trim().slice(0, 4);

export const isFinancialTestCharge = (charge) =>
  getChargeCardLast4(charge) === FINANCIAL_TEST_CARD_LAST4;

const normalizeCustomerNameTokens = (value) =>
  String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

export const isFinancialTestCustomer = ({ name, email } = {}) => {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const nameTokens = new Set(normalizeCustomerNameTokens(name));

  return (
    FINANCIAL_TEST_EMAILS.includes(normalizedEmail) ||
    (normalizedEmail === FINANCIAL_TEST_CUSTOMER_EMAIL &&
      nameTokens.has("punit") &&
      nameTokens.has("kothakonda"))
  );
};

export const isFinancialTestOrder = ({ charge, customer } = {}) =>
  isFinancialTestCharge(charge) || isFinancialTestCustomer(customer);
