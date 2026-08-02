const MAX_DATABASE_INTEGER = 2_147_483_647;
const VALID_SKU = /^[A-Z0-9_-]{1,64}$/;
const VALID_PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9_]+$/;
const VALID_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const parseInteger = (value, { allowZero = true } = {}) => {
  let parsed = null;

  if (typeof value === "number") {
    parsed = value;
  } else if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value)) {
    parsed = Number(value);
  }

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < (allowZero ? 0 : 1) ||
    parsed > MAX_DATABASE_INTEGER
  ) {
    return null;
  }

  return parsed;
};

const normalizeSku = (value) => String(value || "").trim().toUpperCase();

const normalizeItems = (items) => {
  if (!Array.isArray(items) || items.length === 0) return null;

  const normalized = [];
  const seenSkus = new Set();

  for (const item of items) {
    const sku = normalizeSku(item?.sku);
    const quantity = parseInteger(item?.quantity, { allowZero: false });
    // Product and order-item constraints intentionally allow complimentary
    // line items. The order subtotal still has to be positive, so a fully free
    // cart cannot enter the paid checkout flow.
    const priceCents = parseInteger(item?.price_cents);

    if (!VALID_SKU.test(sku) || quantity === null || priceCents === null || seenSkus.has(sku)) {
      return null;
    }

    seenSkus.add(sku);
    normalized.push({
      sku,
      quantity,
      price_cents: priceCents,
      product_type: String(item?.product_type || "").trim()
    });
  }

  return normalized;
};

export const parseStripeMetadataItems = (source) => {
  const raw = source?.metadata?.items;
  if (typeof raw !== "string" || !raw) return [];

  try {
    return normalizeItems(JSON.parse(raw)) || [];
  } catch {
    return [];
  }
};

const fail = (code) => ({ ok: false, code });

export const validateStripeOrderIntegrity = ({
  items,
  currency,
  subtotal,
  shipping,
  tax,
  total,
  amountComparisons = {},
  currencyComparisons = []
}) => {
  const normalizedCurrency =
    typeof currency === "string" ? currency.trim().toLowerCase() : "";
  if (normalizedCurrency !== "usd") return fail("unsupported_currency");

  for (const comparison of currencyComparisons) {
    if (
      typeof comparison !== "string" ||
      comparison.trim().toLowerCase() !== normalizedCurrency
    ) {
      return fail("currency_mismatch");
    }
  }

  const normalizedItems = normalizeItems(items);
  if (!normalizedItems) return fail("invalid_items");

  let itemSubtotal = 0;
  for (const item of normalizedItems) {
    const lineTotal = item.quantity * item.price_cents;
    if (!Number.isSafeInteger(lineTotal) || lineTotal > MAX_DATABASE_INTEGER) {
      return fail("invalid_item_subtotal");
    }

    itemSubtotal += lineTotal;
    if (!Number.isSafeInteger(itemSubtotal) || itemSubtotal > MAX_DATABASE_INTEGER) {
      return fail("invalid_item_subtotal");
    }
  }

  const amounts = {
    subtotal: parseInteger(subtotal, { allowZero: false }),
    shipping: parseInteger(shipping),
    tax: parseInteger(tax),
    total: parseInteger(total, { allowZero: false })
  };

  if (Object.values(amounts).some((amount) => amount === null)) {
    return fail("invalid_amount");
  }

  if (itemSubtotal !== amounts.subtotal) return fail("item_subtotal_mismatch");

  const calculatedTotal = amounts.subtotal + amounts.shipping + amounts.tax;
  if (
    !Number.isSafeInteger(calculatedTotal) ||
    calculatedTotal > MAX_DATABASE_INTEGER ||
    calculatedTotal !== amounts.total
  ) {
    return fail("order_total_mismatch");
  }

  for (const [amountName, comparisons] of Object.entries(amountComparisons)) {
    if (!Object.hasOwn(amounts, amountName) || !Array.isArray(comparisons)) {
      return fail("invalid_comparison");
    }

    for (const comparison of comparisons) {
      const parsedComparison = parseInteger(comparison, {
        allowZero: amountName !== "subtotal" && amountName !== "total"
      });
      if (parsedComparison === null || parsedComparison !== amounts[amountName]) {
        return fail(`${amountName}_mismatch`);
      }
    }
  }

  return {
    ok: true,
    currency: "USD",
    items: normalizedItems,
    ...amounts
  };
};

export const validatePaymentIntentOrderIntegrity = ({ intent, charge, items }) =>
  validateStripeOrderIntegrity({
    items,
    currency: intent?.currency,
    subtotal: intent?.metadata?.amount_subtotal,
    shipping: intent?.metadata?.amount_shipping,
    tax: intent?.metadata?.amount_tax ?? 0,
    total: intent?.metadata?.amount_total,
    amountComparisons: {
      total: [intent?.amount, intent?.amount_received, charge?.amount, charge?.amount_captured]
    },
    currencyComparisons: [charge?.currency]
  });

export const isPaymentIntentCheckoutFlow = (source) =>
  source?.object === "payment_intent" &&
  source?.metadata?.checkout_flow === "payment_intent";

export const getStripePaymentIntentId = (source) => {
  const candidate =
    source?.object === "payment_intent"
      ? source.id
      : typeof source?.payment_intent === "object"
        ? source.payment_intent?.id
        : source?.payment_intent;
  const normalized = typeof candidate === "string" ? candidate.trim() : "";
  return VALID_PAYMENT_INTENT_ID.test(normalized) ? normalized : "";
};

export const isStripeChargeFullyRefunded = (charge) => {
  const amount = parseInteger(charge?.amount, { allowZero: false });
  const amountRefunded = parseInteger(charge?.amount_refunded);
  return charge?.object === "charge" &&
    charge?.refunded === true &&
    amount !== null &&
    amountRefunded === amount;
};

export const getStripeChargeFinancialState = ({ charge, disputes } = {}) => {
  const amount = parseInteger(charge?.amount, { allowZero: false });
  const amountRefunded = parseInteger(charge?.amount_refunded);

  if (
    charge?.object !== "charge" ||
    amount === null ||
    amountRefunded === null ||
    amountRefunded > amount ||
    typeof charge?.refunded !== "boolean" ||
    typeof charge?.disputed !== "boolean"
  ) {
    return fail("invalid_charge_state");
  }

  if (charge.refunded) {
    return amountRefunded === amount
      ? { ok: true, status: "refunded", retireWork: true }
      : fail("refund_state_mismatch");
  }

  if (amountRefunded === amount) {
    return fail("refund_state_mismatch");
  }

  if (!charge.disputed) {
    return { ok: true, status: "paid", retireWork: false };
  }

  if (!Array.isArray(disputes) || disputes.length === 0) {
    return fail("dispute_state_missing");
  }

  const actions = [];
  for (const dispute of disputes) {
    if (dispute?.object !== "dispute") return fail("invalid_dispute_state");
    const action = getStripeDisputeAction(dispute.status);
    if (!action) return fail("invalid_dispute_state");
    actions.push(action);
  }

  if (actions.includes("retire")) {
    return { ok: true, status: "disputed", retireWork: true };
  }
  if (actions.includes("pause")) {
    return { ok: true, status: "disputed", retireWork: false };
  }

  return { ok: true, status: "paid", retireWork: false };
};

export const getStripeDisputeAction = (status) => {
  switch (status) {
    case "won":
    case "warning_closed":
    case "prevented":
      return "restore";
    case "lost":
      return "retire";
    case "needs_response":
    case "under_review":
    case "warning_needs_response":
    case "warning_under_review":
      return "pause";
    default:
      return "";
  }
};

export const getStripeCheckoutIdempotencyKey = (checkoutAttemptId) => {
  if (typeof checkoutAttemptId !== "string") return "";

  const normalized = checkoutAttemptId.trim().toLowerCase();
  return VALID_UUID.test(normalized)
    ? `vidaverde:checkout:${normalized}`
    : "";
};

export const isCheckoutExpectationExact = ({
  expectation,
  totalCents,
  shippingCents,
  shippingOption
} = {}) => Boolean(expectation) &&
  expectation.totalCents === totalCents &&
  expectation.shippingCents === shippingCents &&
  expectation.shippingOption === String(shippingOption || "").trim().toLowerCase();

export const getStripeChargePlacedAt = (charge) => {
  const created = charge?.created;
  if (!Number.isSafeInteger(created) || created <= 0) return "";

  const date = new Date(created * 1000);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
};
