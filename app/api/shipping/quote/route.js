import { securePublicRoute } from "@/lib/apiSecurity";
import {
  mapCheckoutIssuesToFieldErrors,
  shippingQuotePayloadSchema
} from "@/lib/checkoutSchema";
import { selectCheckoutShippingQuote } from "@/lib/checkoutShippingQuote";
import { getProductMap } from "@/lib/products";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import {
  getShippingOptionsForCart,
  normalizeProductType
} from "@/lib/shippingPricing";
import { getInventoryMap } from "@/lib/stock";

const SHIPPING_QUOTE_RATE_LIMIT = getRouteRateLimitConfig("SHIPPING_QUOTE_CREATE", {
  windowMs: 60_000,
  ipMax: 24
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

export const runtime = "nodejs";

export async function POST(request) {
  const security = await securePublicRoute(request, {
    scope: "shipping:quote",
    rateLimit: SHIPPING_QUOTE_RATE_LIMIT,
    rateLimitExceededMessage: "Too many shipping updates. Please wait a moment and try again."
  });
  if (!security.ok) return security.response;

  const { respond } = security;
  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json(
      { error: "We couldn't read the shipping details. Please try again." },
      { status: 400 }
    );
  }

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

  const { customer, items, shippingOption: requestedShippingOptionId } = parsedPayload.data;
  const skus = items.map((item) => item.sku);
  const [productMap, inventoryMap] = await Promise.all([
    getProductMap(skus),
    getInventoryMap()
  ]);

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
  const requestedOption = shipping.options.find(
    (option) => option.id === requestedShippingOptionId
  ) || shipping.normalOption;
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

  try {
    const selection = await selectCheckoutShippingQuote({
      customer,
      itemsPayload,
      requestedOption,
      hasPreorderItems,
      orderCreatedAt: new Date()
    });

    return respond.json(
      {
        shipping: {
          id: selection.option.id,
          label: selection.option.label,
          amountCents: selection.charge.amountCents,
          carrier: selection.option.carrier,
          service: selection.option.service,
          transitLabel: selection.option.transitLabel,
          carrierTransitLabel: selection.option.carrierTransitLabel,
          deliveryEstimate: selection.option.deliveryEstimate,
          expectedArrivalDate: selection.expectedArrivalDateKey,
          expectedArrivalLabel: selection.expectedArrivalLabel
        }
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" }
      }
    );
  } catch (error) {
    console.error("live EasyPost shipping preview failed:", error?.message || error);
    const noEligibleRate = /No EasyPost rate was available in the/i.test(
      String(error?.message || "")
    );
    return respond.json(
      {
        error: noEligibleRate
          ? `We couldn't find an eligible ${requestedOption.label} rate for that address. Try the other shipping method or verify the address.`
          : "We couldn't update shipping for that address. Please verify it and try again."
      },
      { status: noEligibleRate ? 422 : 502 }
    );
  }
}
