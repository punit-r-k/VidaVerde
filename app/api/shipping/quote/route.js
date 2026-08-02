import { securePublicRoute } from "@/lib/apiSecurity";
import {
  mapCheckoutIssuesToFieldErrors,
  shippingQuotePayloadSchema
} from "@/lib/checkoutSchema";
import { selectCheckoutShippingQuote } from "@/lib/checkoutShippingQuote";
import { getAuthoritativeProductMap } from "@/lib/products";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { readBoundedJsonBody } from "@/lib/requestBody";
import { resolveCustomerShippingSelections } from "@/lib/shippingOptionPolicy";
import {
  getShippingOptionsForCart,
  normalizeProductType
} from "@/lib/shippingPricing";
import { getInventoryMap } from "@/lib/stock";
import { createEasyPostRatingContext } from "@/lib/shippingQuotes";

const SHIPPING_QUOTE_RATE_LIMIT = getRouteRateLimitConfig("SHIPPING_QUOTE_CREATE", {
  windowMs: 60_000,
  ipMax: 12
});

const getValidationMessage = (issues) => {
  const message = issues?.[0]?.message || "";
  return message && !/invalid input|unrecognized key|expected|required/i.test(message)
    ? message
    : "Please check the shipping address and try again.";
};

const toCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const serializeShippingSelection = (selection) => ({
  id: selection.option.id,
  label: selection.option.label,
  amountCents: selection.charge.amountCents,
  transitLabel: selection.option.transitLabel,
  deliveryEstimate: selection.option.deliveryEstimate,
  expectedArrivalDate: selection.expectedArrivalDateKey,
  expectedArrivalLabel: selection.expectedArrivalLabel
});

export const runtime = "nodejs";

export async function POST(request) {
  const security = await securePublicRoute(request, {
    scope: "shipping:quote",
    rateLimit: SHIPPING_QUOTE_RATE_LIMIT,
    rateLimitExceededMessage: "Too many shipping updates. Please wait a moment and try again."
  });
  if (!security.ok) return security.response;

  const { respond } = security;
  const bodyResult = await readBoundedJsonBody(request, { maxBytes: 64 * 1024 });
  if (!bodyResult.ok) {
    return respond.json(
      {
        error: bodyResult.status === 413
          ? "Those shipping details are too large. Please refresh and try again."
          : "We couldn't read the shipping details. Please try again."
      },
      { status: bodyResult.status }
    );
  }
  const payload = bodyResult.data;

  const parsedPayload = shippingQuotePayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    return respond.json(
      {
        error: getValidationMessage(parsedPayload.error.issues),
        fieldErrors: mapCheckoutIssuesToFieldErrors(parsedPayload.error.issues)
      },
      { status: 400 }
    );
  }

  const { customer, items } = parsedPayload.data;
  const skus = items.map((item) => item.sku);
  const [productMap, inventoryMap] = await Promise.all([
    getAuthoritativeProductMap(skus),
    getInventoryMap()
  ]);

  if (!productMap) {
    return respond.json(
      { error: "Product pricing is refreshing. Shipping will update in a moment." },
      { status: 503 }
    );
  }

  if (!inventoryMap) {
    return respond.json(
      { error: "Inventory is refreshing. Shipping will update in a moment." },
      { status: 503 }
    );
  }

  const lineItems = items
    .map((item) => {
      const product = productMap.get(item.sku);
      const unitAmount = Number(product?.price_cents);
      const productType = normalizeProductType(product?.product_type, item.sku);
      if (!product || !Number.isFinite(unitAmount) || unitAmount < 0 || !productType) {
        return null;
      }

      return {
        sku: item.sku,
        quantity: item.quantity,
        unitAmount,
        productType
      };
    })
    .filter(Boolean);

  if (lineItems.length !== items.length) {
    return respond.json(
      { error: "One or more cart items are no longer available. Please refresh and try again." },
      { status: 400 }
    );
  }

  const subtotalCents = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitAmount,
    0
  );
  const shipping = getShippingOptionsForCart({
    items: lineItems,
    subtotalCents
  });
  const itemsPayload = lineItems.map((item) => ({
    sku: item.sku,
    quantity: item.quantity,
    price_cents: item.unitAmount,
    product_type: item.productType
  }));
  const hasPreorderItems = lineItems.some((item) => {
    const available = Math.max(0, Number(inventoryMap?.[item.sku]?.on_hand || 0));
    return toCount(item.quantity) > available;
  });

  const orderCreatedAt = new Date();
  const ratingContext = createEasyPostRatingContext();
  const results = await Promise.allSettled(
    shipping.options.map((option) =>
      selectCheckoutShippingQuote({
        customer,
        itemsPayload,
        requestedOption: option,
        hasPreorderItems,
        orderCreatedAt,
        ratingContext
      })
    )
  );
  const selections = new Map();
  results.forEach((result, index) => {
    const option = shipping.options[index];
    if (result.status === "fulfilled") {
      selections.set(option.id, result.value);
      return;
    }

    console.error(
      `live EasyPost ${option.id} shipping preview failed:`,
      result.reason?.message || result.reason
    );
  });
  const policy = resolveCustomerShippingSelections({
    normalSelection: selections.get(shipping.normalOption.id),
    expeditedSelection: selections.get(shipping.expeditedOption.id),
    normalOption: shipping.normalOption
  });

  if (!policy.normalSelection) {
    const noEligibleRates = results.every(
      (result) => result.status === "rejected" &&
        /No EasyPost rate was available in the/i.test(String(result.reason?.message || ""))
    );
    return respond.json(
      {
        error: noEligibleRates
          ? "We couldn't find eligible Shipping or Expedited rates for that address. Please verify it and try again."
          : "We couldn't update shipping for that address. Please verify it and try again."
      },
      { status: noEligibleRates ? 422 : 502 }
    );
  }

  const shippingOptions = [
    policy.normalSelection,
    policy.expeditedSelection
  ].filter(Boolean).map(serializeShippingSelection);

  return respond.json(
    {
      shippingOptions,
      expeditedAvailable: Boolean(policy.expeditedSelection)
    },
    {
      status: 200,
      headers: { "Cache-Control": "no-store" }
    }
  );
}
