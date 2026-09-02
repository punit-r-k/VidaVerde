import { securePublicRoute } from "@/lib/apiSecurity";
import { mapCheckoutIssuesToFieldErrors, shippingQuotePayloadSchema } from "@/lib/checkoutSchema";
import { selectCheckoutShippingOptions } from "@/lib/checkoutShippingQuote";
import { getAuthoritativeProductMap } from "@/lib/products";
import { getClientId, getRouteRateLimitConfig } from "@/lib/rateLimit";
import { readBoundedJsonBody } from "@/lib/requestBody";
import {
  createSafeIdentifierFingerprint,
  createShippingQuoteFingerprint,
  finalizeReservedShippingQuote,
  isLiveQuoteFeatureEnabled,
  markReservedShippingQuoteFailed,
  reserveShippingQuoteUsage,
  serializeCachedShippingSelections,
  serializeStoredShippingSelection
} from "@/lib/shippingQuoteCache";
import { buildShippingPlan } from "@/lib/shippingParcels";
import { createEasyPostRatingContext } from "@/lib/shippingQuotes";
import { getEstimatedShipDate, getShippingOptionsForCart, normalizeProductType } from "@/lib/shippingPricing";
import { getInventoryMap } from "@/lib/stock";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const SHIPPING_QUOTE_RATE_LIMIT = getRouteRateLimitConfig("SHIPPING_QUOTE_CREATE", {
  windowMs: 10 * 60_000,
  ipMax: 6
});
const SAFE_UNAVAILABLE_MESSAGE =
  "Shipping is temporarily unavailable. Please wait and explicitly calculate it again.";

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
const getCachedQuote = async (quoteId) => {
  if (!quoteId || !supabaseAdmin) return null;
  const { data, error } = await supabaseAdmin.from("checkout_shipping_quotes")
    .select("*").eq("id", quoteId).eq("status", "quoted")
    .gt("expires_at", new Date().toISOString()).maybeSingle();
  if (error) throw error;
  return data || null;
};

export const runtime = "nodejs";

export async function POST(request) {
  const security = await securePublicRoute(request, {
    scope: "shipping:quote",
    rateLimit: SHIPPING_QUOTE_RATE_LIMIT,
    rateLimitExceededMessage: "Too many shipping calculations. Please wait ten minutes and try again."
  });
  if (!security.ok) return security.response;
  const { respond } = security;
  if (!isLiveQuoteFeatureEnabled() || !supabaseAdmin) {
    return respond.json({ error: SAFE_UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  const bodyResult = await readBoundedJsonBody(request, { maxBytes: 64 * 1024 });
  if (!bodyResult.ok) {
    return respond.json({ error: "We couldn't read the shipping details." }, { status: bodyResult.status });
  }
  const parsedPayload = shippingQuotePayloadSchema.safeParse(bodyResult.data);
  if (!parsedPayload.success) {
    return respond.json({
      error: getValidationMessage(parsedPayload.error.issues),
      fieldErrors: mapCheckoutIssuesToFieldErrors(parsedPayload.error.issues)
    }, { status: 400 });
  }

  const { customer, items, checkoutSessionToken } = parsedPayload.data;
  const [productMap, inventoryMap] = await Promise.all([
    getAuthoritativeProductMap(items.map((item) => item.sku)),
    getInventoryMap()
  ]);
  if (!productMap || !inventoryMap) {
    return respond.json({ error: SAFE_UNAVAILABLE_MESSAGE }, { status: 503 });
  }
  const lineItems = items.map((item) => {
    const product = productMap.get(item.sku);
    const unitAmount = Number(product?.price_cents);
    const productType = normalizeProductType(product?.product_type, item.sku);
    return product && Number.isFinite(unitAmount) && unitAmount >= 0 && productType
      ? { sku: item.sku, quantity: item.quantity, unitAmount, productType }
      : null;
  }).filter(Boolean);
  if (lineItems.length !== items.length) {
    return respond.json({ error: "One or more cart items are no longer available." }, { status: 400 });
  }

  const itemsPayload = lineItems.map((item) => ({
    sku: item.sku,
    quantity: item.quantity,
    price_cents: item.unitAmount,
    product_type: item.productType
  }));
  const parcelPlan = buildShippingPlan(itemsPayload);
  if (!parcelPlan?.parcels?.length) {
    return respond.json({ error: SAFE_UNAVAILABLE_MESSAGE }, { status: 422 });
  }
  const hasPreorderItems = lineItems.some((item) =>
    toCount(item.quantity) > Math.max(0, Number(inventoryMap?.[item.sku]?.on_hand || 0))
  );
  const orderCreatedAt = new Date();
  const plannedShipDate = getEstimatedShipDate({ orderDate: orderCreatedAt, hasPreorderItems });
  const plannedShipDateKey = plannedShipDate?.toISOString().slice(0, 10) || "";
  const fingerprint = createShippingQuoteFingerprint({
    customer, items: itemsPayload, parcelPlan,
    plannedShipDate: plannedShipDateKey, serviceLevel: "all"
  });
  const sessionFingerprint = createSafeIdentifierFingerprint("checkout-session", checkoutSessionToken);
  const ipFingerprint = createSafeIdentifierFingerprint("ip", getClientId(request));

  let reservation;
  try {
    reservation = await reserveShippingQuoteUsage({
      fingerprint, sessionFingerprint, ipFingerprint, serviceLevel: "normal",
      parcelPlan, plannedShipDate: plannedShipDateKey,
      parcelCount: parcelPlan.parcels.length, now: orderCreatedAt
    });
  } catch (error) {
    console.error("shipping quote budget reservation failed:", error?.message || error);
    return respond.json({ error: SAFE_UNAVAILABLE_MESSAGE }, { status: 503 });
  }

  const subtotalCents = lineItems.reduce((sum, item) => sum + item.quantity * item.unitAmount, 0);
  const shipping = getShippingOptionsForCart({ items: lineItems, subtotalCents });
  if (reservation.state === "cache_hit") {
    try {
      const cached = await getCachedQuote(reservation.quote_id);
      if (!cached) throw new Error("The cached quote is unavailable.");
      return respond.json({
        shippingOptions: serializeCachedShippingSelections(cached, shipping.options),
        cacheHit: true
      }, { status: 200, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      console.error("shipping quote cache read failed:", error?.message || error);
      return respond.json({ error: SAFE_UNAVAILABLE_MESSAGE }, { status: 503 });
    }
  }
  if (reservation.state === "in_progress") {
    return respond.json({ error: "Shipping is already being calculated. Please wait, then click Update shipping." }, { status: 409 });
  }
  if (reservation.state !== "reserved") {
    return respond.json({ error: SAFE_UNAVAILABLE_MESSAGE }, { status: 429 });
  }

  try {
    const ratingContext = createEasyPostRatingContext({ startedAt: orderCreatedAt });
    const selections = await selectCheckoutShippingOptions({
      customer,
      itemsPayload,
      normalOption: shipping.normalOption,
      expeditedOption: shipping.expeditedOption,
      hasPreorderItems,
      orderCreatedAt,
      ratingContext
    });
    selections.forEach((selection) => {
      selection.verifiedAddressId = ratingContext.verifiedAddressId;
    });
    const saved = await finalizeReservedShippingQuote({
      quoteId: reservation.quote_id, selections, fingerprint
    });
    return respond.json({
      shippingOptions: selections.map((selection) =>
        serializeStoredShippingSelection(selection, saved.id, saved.expires_at)
      ),
      cacheHit: false
    }, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    await markReservedShippingQuoteFailed(reservation.quote_id);
    console.error("live EasyPost shipping quote failed:", error?.message || error);
    return respond.json({
      error: "We couldn't calculate shipping. Verify the address, then click Calculate shipping again."
    }, { status: 502 });
  }
}
