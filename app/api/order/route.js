import { securePublicRoute } from "@/lib/apiSecurity";
import {
  checkoutPayloadSchema,
  mapCheckoutIssuesToFieldErrors,
  SHIPPING_COUNTRY_CODE
} from "@/lib/checkoutSchema";
import { MARKET_PICKUP_POLICY_VERSION } from "@/lib/pickupDetails";
import { getProductMap } from "@/lib/products";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import {
  getShippingOptionsForCart,
  normalizeProductType
} from "@/lib/shippingPricing";
import { getShippingChargeBreakdown } from "@/lib/shippingCharge";
import { getEasyPostQuotes } from "@/lib/shippingQuotes";
import {
  chooseFastestQuote,
  getQuoteTransitDays
} from "@/lib/shippingRateRanking";
import { getInventoryMap } from "@/lib/stock";
import { stripeConfig, stripeRequest } from "@/lib/stripe";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ORDER_RATE_LIMIT = getRouteRateLimitConfig("ORDER_CREATE", {
  windowMs: 60_000,
  ipMax: 6
});

const CHECKOUT_UNAVAILABLE_MESSAGE =
  "Checkout is not available right now. Please try again later.";
const SHIPPING_QUOTE_LIFETIME_MS = 60 * 60 * 1000;

const getCheckoutValidationMessage = (issues) => {
  const message = issues?.[0]?.message || "";
  if (
    !message ||
    /invalid input|unrecognized key|expected|required/i.test(message)
  ) {
    return "Please check your checkout details and try again.";
  }

  return message;
};

const asMetadataValue = (value, maxLength = 500) =>
  String(value || "").trim().slice(0, maxLength);

const asOptionalStripeValue = (value, maxLength = 500) => {
  const text = asMetadataValue(value, maxLength);
  return text || undefined;
};

const buildOrderSummary = (lineItems) =>
  lineItems.map((item) => `${item.name} x${item.quantity}`).join(", ");

const buildSkuSummary = (lineItems) =>
  lineItems.map((item) => `${item.sku}x${item.quantity}`).join(", ");

const toCount = (value) => {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

const getCurrentAllocation = (quantity, inventoryRecord) => {
  const available = Math.max(0, Number(inventoryRecord?.on_hand || 0));
  const safeQuantity = toCount(quantity);

  return {
    available,
    inStockUnits: Math.min(safeQuantity, available),
    preorderUnits: Math.max(0, safeQuantity - available)
  };
};

const serializeExpectedPreorderMap = (items, inventoryMap) =>
  (Array.isArray(items) ? items : [])
    .map((item) => {
      const sku = String(item?.sku || "").trim().toUpperCase();
      const preorderUnits = getCurrentAllocation(item?.quantity, inventoryMap?.[sku]).preorderUnits;
      return `${sku}:${preorderUnits}`;
    })
    .filter(Boolean)
    .join(",");

const getInventoryConflicts = ({ items, inventorySnapshot, inventoryMap, productMap }) => {
  const snapshotItems = Array.isArray(inventorySnapshot?.items) ? inventorySnapshot.items : [];
  if (snapshotItems.length === 0) {
    return [];
  }

  const snapshotBySku = new Map(
    snapshotItems.map((item) => [
      String(item?.sku || "").trim().toUpperCase(),
      {
        quantity: toCount(item?.quantity),
        inStockUnits: toCount(item?.inStockUnits),
        preorderUnits: toCount(item?.preorderUnits)
      }
    ])
  );

  return (Array.isArray(items) ? items : [])
    .map((item) => {
      const sku = String(item?.sku || "").trim().toUpperCase();
      const snapshot = snapshotBySku.get(sku);
      if (!snapshot) {
        return {
          sku,
          name: String(productMap.get(sku)?.name || sku).trim(),
          missingSnapshot: true,
          previousInStockUnits: 0,
          previousPreorderUnits: 0,
          currentInStockUnits: 0,
          currentPreorderUnits: 0
        };
      }

      const current = getCurrentAllocation(item?.quantity, inventoryMap?.[sku]);
      const isConflict =
        snapshot.quantity !== toCount(item?.quantity) ||
        snapshot.inStockUnits !== current.inStockUnits ||
        snapshot.preorderUnits !== current.preorderUnits;

      if (!isConflict) {
        return null;
      }

      return {
        sku,
        name: String(productMap.get(sku)?.name || sku).trim(),
        missingSnapshot: false,
        previousInStockUnits: snapshot.inStockUnits,
        previousPreorderUnits: snapshot.preorderUnits,
        currentInStockUnits: current.inStockUnits,
        currentPreorderUnits: current.preorderUnits
      };
    })
    .filter(Boolean);
};

const buildInventoryConflictMessage = (conflicts) => {
  const normalizedConflicts = Array.isArray(conflicts) ? conflicts : [];
  if (normalizedConflicts.length === 0) {
    return "Inventory changed while you were checking out. Review the updated cart before continuing to payment.";
  }

  if (normalizedConflicts.some((conflict) => conflict?.missingSnapshot)) {
    return "We refreshed your cart to match the latest stock. Review the updated cart before continuing to payment.";
  }

  const reducedPreorders = normalizedConflicts.some(
    (conflict) => (conflict?.currentPreorderUnits || 0) < (conflict?.previousPreorderUnits || 0)
  );
  const increasedPreorders = normalizedConflicts.some(
    (conflict) => (conflict?.currentPreorderUnits || 0) > (conflict?.previousPreorderUnits || 0)
  );

  if (reducedPreorders && !increasedPreorders) {
    return "Inventory was refreshed while you were checking out. Some items that looked like preorder are now in stock. Review the updated cart before continuing to payment.";
  }

  return "Inventory changed while you were checking out. Review the updated in-stock and preorder quantities before continuing to payment.";
};

const buildStripeShippingDetails = (customer) => ({
  name: asMetadataValue(customer?.name, 120),
  phone: asOptionalStripeValue(customer?.phone, 64),
  address: {
    line1: asMetadataValue(customer?.address1, 120),
    line2: asOptionalStripeValue(customer?.address2, 120),
    city: asMetadataValue(customer?.city, 120),
    state: asMetadataValue(customer?.state, 64),
    postal_code: asMetadataValue(customer?.postalCode, 32),
    country: SHIPPING_COUNTRY_CODE
  }
});

const formatTransitDays = (days) => {
  if (!Number.isFinite(days)) return "Live carrier estimate after carrier receipt";
  return `${days} business ${days === 1 ? "day" : "days"} after carrier receipt`;
};

const getQuoteCarrierSummary = (quote, key) =>
  [...new Set(
    (Array.isArray(quote?.parcels) ? quote.parcels : [])
      .map((parcel) => String(parcel?.selectedRate?.[key] || "").trim())
      .filter(Boolean)
  )].join(", ");

const cancelCheckoutShippingQuote = async (quoteId) => {
  if (!quoteId || !supabaseAdmin) return;

  const { error } = await supabaseAdmin
    .from("checkout_shipping_quotes")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString()
    })
    .eq("id", quoteId);

  if (error) {
    console.error("checkout shipping quote cancellation failed:", error.message);
  }
};

export const runtime = "nodejs";

export async function POST(request) {
  const security = await securePublicRoute(request, {
    scope: "order:create",
    rateLimit: ORDER_RATE_LIMIT,
    rateLimitExceededMessage: "Too many checkout attempts. Please wait and try again."
  });
  if (!security.ok) {
    return security.response;
  }

  const { respond } = security;

  if (!stripeConfig) {
    return respond.json(
      { error: CHECKOUT_UNAVAILABLE_MESSAGE },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json(
      { error: "We couldn't read your checkout details. Please try again." },
      { status: 400 }
    );
  }

  const parsedPayload = checkoutPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    const issues = parsedPayload.error.issues;
    const fieldErrors = mapCheckoutIssuesToFieldErrors(issues);

    return respond.json(
      {
        error: getCheckoutValidationMessage(issues),
        fieldErrors
      },
      { status: 400 }
    );
  }

  const {
    customer,
    consents,
    items: normalizedItems,
    fulfillment: normalizedFulfillment,
    inventorySnapshot
  } = parsedPayload.data;
  const { name, email } = customer;
  const isPickup = normalizedFulfillment === "market";

  if (isPickup && !consents?.pickupPolicyAccepted) {
    return respond.json(
      { error: "Please check the pickup policy box before continuing." },
      { status: 400 }
    );
  }

  const skus = normalizedItems.map((item) => item.sku);
  const [productMap, inventoryMap] = await Promise.all([
    getProductMap(skus),
    getInventoryMap()
  ]);

  if (!inventoryMap) {
    return respond.json(
      { error: "Inventory is refreshing. Please try again in a moment." },
      { status: 503 }
    );
  }

  const lineItems = normalizedItems
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
        name: String(product.name || item.sku).trim(),
        productType
      };
    })
    .filter(Boolean);

  if (lineItems.length === 0 || lineItems.length !== normalizedItems.length) {
    return respond.json(
      { error: "One or more items in your cart are no longer available. Please refresh and try again." },
      { status: 400 }
    );
  }

  const inventoryConflicts = getInventoryConflicts({
    items: normalizedItems,
    inventorySnapshot,
    inventoryMap,
    productMap
  });

  if (inventoryConflicts.length > 0) {
    return respond.json(
      {
        code: "inventory_changed",
        error: buildInventoryConflictMessage(inventoryConflicts),
        inventory: inventoryMap,
        inventoryConflicts
      },
      { status: 409 }
    );
  }

  const siteUrl = (process.env.SITE_URL || request.headers.get("origin") || "").replace(
    /\/$/,
    ""
  );

  if (!siteUrl) {
    return respond.json(
      { error: CHECKOUT_UNAVAILABLE_MESSAGE },
      { status: 500 }
    );
  }

  const subtotal = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitAmount,
    0
  );

  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return respond.json(
      { error: "Your order total looks off. Please refresh your cart and try again." },
      { status: 400 }
    );
  }

  const itemsPayload = normalizedItems.map((item) => {
    const product = productMap.get(item.sku);

    return {
      sku: item.sku,
      quantity: item.quantity,
      price_cents: product?.price_cents ?? 0,
      product_type: normalizeProductType(product?.product_type, item.sku)
    };
  });

  const orderSummary = buildOrderSummary(lineItems);
  const skuSummary = buildSkuSummary(lineItems);
  const totalUnits = lineItems.reduce((sum, item) => sum + item.quantity, 0);
  const shipping = getShippingOptionsForCart({
    items: lineItems,
    subtotalCents: subtotal
  });
  let selectedShippingOption = isPickup ? null : shipping.fastestOption;
  let checkoutShippingQuote = null;
  let shippingCharge = {
    postageCents: 0,
    packagingCents: 0,
    unroundedCents: 0,
    roundingCents: 0,
    amountCents: 0
  };

  if (!isPickup) {
    if (!supabaseAdmin) {
      return respond.json({ error: CHECKOUT_UNAVAILABLE_MESSAGE }, { status: 500 });
    }

    try {
      const quotes = await getEasyPostQuotes({
        customer_name: customer.name,
        customer_email: customer.email,
        customer_phone: customer.phone,
        address1: customer.address1,
        address2: customer.address2,
        city: customer.city,
        state: customer.state,
        postal_code: customer.postalCode,
        country: SHIPPING_COUNTRY_CODE,
        items_json: itemsPayload,
        created_at: new Date().toISOString()
      });
      const fastestQuote = chooseFastestQuote(quotes);
      if (!fastestQuote) throw new Error("EasyPost returned no shipping rates.");

      shippingCharge = getShippingChargeBreakdown(fastestQuote);
      if (shippingCharge.amountCents <= 0) {
        throw new Error("EasyPost returned an invalid shipping total.");
      }

      const deliveryDays = getQuoteTransitDays(fastestQuote);
      const carrier = getQuoteCarrierSummary(fastestQuote, "carrier");
      const service = getQuoteCarrierSummary(fastestQuote, "service");
      const carrierTransitLabel = formatTransitDays(deliveryDays);
      selectedShippingOption = {
        ...shipping.fastestOption,
        amountCents: shippingCharge.amountCents,
        carrier,
        service,
        carrierTransitLabel,
        transitLabel: `Handed to the carrier on Wednesday via ${[carrier, service].filter(Boolean).join(" ") || "the fastest available service"}; estimated ${carrierTransitLabel.toLowerCase()}.`,
        deliveryEstimate: Number.isFinite(deliveryDays)
          ? {
              minimum: { unit: "business_day", value: deliveryDays },
              maximum: { unit: "business_day", value: deliveryDays }
            }
          : shipping.fastestOption.deliveryEstimate
      };

      const expiresAt = new Date(Date.now() + SHIPPING_QUOTE_LIFETIME_MS).toISOString();
      const { data: savedQuote, error: saveQuoteError } = await supabaseAdmin
        .from("checkout_shipping_quotes")
        .insert({
          status: "quoted",
          provider: "easypost",
          quote_json: fastestQuote,
          postage_cents: shippingCharge.postageCents,
          packaging_cents: shippingCharge.packagingCents,
          unrounded_cents: shippingCharge.unroundedCents,
          rounding_cents: shippingCharge.roundingCents,
          charged_shipping_cents: shippingCharge.amountCents,
          currency: "USD",
          delivery_days: Number.isFinite(deliveryDays) ? deliveryDays : null,
          expires_at: expiresAt
        })
        .select("id, expires_at")
        .single();
      if (saveQuoteError || !savedQuote) {
        throw saveQuoteError || new Error("The live shipping quote could not be saved.");
      }
      checkoutShippingQuote = savedQuote;
    } catch (shippingError) {
      console.error("live EasyPost checkout quote failed:", shippingError?.message || shippingError);
      return respond.json(
        {
          error: "We couldn't calculate live shipping for that address. Please verify the address and try again.",
          fieldErrors: {
            address1: "Live shipping could not be calculated for this address."
          }
        },
        { status: 502 }
      );
    }
  }

  const defaultShippingAmount = shippingCharge.amountCents;
  const estimatedTotal = subtotal + defaultShippingAmount;

  if (!Number.isFinite(estimatedTotal) || estimatedTotal <= 0) {
    return respond.json(
      { error: "Your order total looks off. Please refresh your cart and try again." },
      { status: 400 }
    );
  }

  const metadata = {
    checkout_flow: "payment_intent",
    fulfillment: asMetadataValue(normalizedFulfillment, 32),
    shipping_tier: asMetadataValue(isPickup ? "" : shipping.tier, 64),
    shipping_option: asMetadataValue(isPickup ? "" : selectedShippingOption?.id, 64),
    shipping_option_label: asMetadataValue(
      isPickup ? "" : selectedShippingOption?.label,
      120
    ),
    shipping_estimate: asMetadataValue(
      isPickup ? "" : selectedShippingOption?.transitLabel,
      180
    ),
    sauerkraut_count: asMetadataValue(shipping.sauerkrautCount, 32),
    hot_sauce_count: asMetadataValue(shipping.hotSauceCount, 32),
    amount_subtotal: asMetadataValue(subtotal, 32),
    amount_shipping: asMetadataValue(defaultShippingAmount, 32),
    amount_total: asMetadataValue(estimatedTotal, 32),
    shipping_quote_id: asMetadataValue(checkoutShippingQuote?.id, 64),
    shipping_postage_cents: asMetadataValue(shippingCharge.postageCents, 32),
    shipping_packaging_cents: asMetadataValue(shippingCharge.packagingCents, 32),
    shipping_unrounded_cents: asMetadataValue(shippingCharge.unroundedCents, 32),
    shipping_rounding_cents: asMetadataValue(shippingCharge.roundingCents, 32),
    shipping_carrier: asMetadataValue(selectedShippingOption?.carrier, 120),
    shipping_service: asMetadataValue(selectedShippingOption?.service, 120),
    customer_name: asMetadataValue(name, 120),
    customer_email: asMetadataValue(email, 254),
    customer_phone: asMetadataValue(customer.phone, 64),
    address1: asMetadataValue(customer.address1, 120),
    address2: asMetadataValue(customer.address2, 120),
    city: asMetadataValue(customer.city, 120),
    state: asMetadataValue(customer.state, 64),
    postal_code: asMetadataValue(customer.postalCode, 32),
    country: asMetadataValue(isPickup ? "" : SHIPPING_COUNTRY_CODE, 2),
    note: asMetadataValue(customer.note, 500),
    order_summary: asMetadataValue(orderSummary, 500),
    order_skus: asMetadataValue(skuSummary, 500),
    order_item_count: asMetadataValue(totalUnits, 32)
  };

  if (isPickup) {
    metadata.pickup_policy_accepted = "true";
    metadata.pickup_policy_version = asMetadataValue(MARKET_PICKUP_POLICY_VERSION, 32);
    metadata.pickup_policy_accepted_at = asMetadataValue(new Date().toISOString(), 64);
  }

  const serializedItems = JSON.stringify(itemsPayload);
  if (serializedItems.length > 500) {
    await cancelCheckoutShippingQuote(checkoutShippingQuote?.id);
    return respond.json(
      { error: "Cart is too large to process online. Please split into multiple orders." },
      { status: 400 }
    );
  }
  metadata.items = serializedItems;

  const serializedExpectedPreorders = serializeExpectedPreorderMap(
    normalizedItems,
    inventoryMap
  );
  if (serializedExpectedPreorders) {
    metadata.expected_preorder = asMetadataValue(serializedExpectedPreorders, 500);
  }

  try {
    const stripePayload = {
      amount: estimatedTotal,
      currency: "usd",
      automatic_payment_methods: {
        enabled: true,
        allow_redirects: "never"
      },
      description: asMetadataValue(
        `Vida Verde ${isPickup ? "pickup" : "shipping"} order: ${orderSummary}`,
        500
      ),
      metadata,
      receipt_email: asMetadataValue(email, 254)
    };

    if (!isPickup) {
      stripePayload.shipping = buildStripeShippingDetails(customer);
    }

    const { ok, data, error } = await stripeRequest("/v1/payment_intents", {
      method: "POST",
      body: stripePayload
    });

    if (!ok) {
      console.error("stripe payment_intent error:", error);
      await cancelCheckoutShippingQuote(checkoutShippingQuote?.id);
      return respond.json(
        { error: "We couldn't start payment. Please try again." },
        { status: 500 }
      );
    }

    if (!data?.client_secret || !data?.id) {
      await cancelCheckoutShippingQuote(checkoutShippingQuote?.id);
      return respond.json(
        { error: "We couldn't start payment. Please try again." },
        { status: 500 }
      );
    }

    if (checkoutShippingQuote?.id) {
      const { data: attachedQuote, error: attachQuoteError } = await supabaseAdmin
        .from("checkout_shipping_quotes")
        .update({
          payment_session_id: data.id,
          updated_at: new Date().toISOString()
        })
        .eq("id", checkoutShippingQuote.id)
        .eq("status", "quoted")
        .select("id")
        .maybeSingle();

      if (attachQuoteError || !attachedQuote) {
        console.error(
          "checkout shipping quote attachment failed:",
          attachQuoteError?.message || "The saved quote was no longer available."
        );
        await stripeRequest(`/v1/payment_intents/${encodeURIComponent(data.id)}/cancel`, {
          method: "POST"
        });
        await cancelCheckoutShippingQuote(checkoutShippingQuote.id);
        return respond.json(
          { error: "We couldn't finish preparing shipping. Please try again." },
          { status: 500 }
        );
      }
    }

    return respond.json(
      {
        clientSecret: data.client_secret,
        paymentIntentId: data.id,
        returnUrl: `${siteUrl}/?checkout=success`,
        subtotalCents: subtotal,
        totalCents: estimatedTotal,
        shipping: isPickup
          ? null
          : {
              id: selectedShippingOption?.id,
              label: selectedShippingOption?.label,
              amountCents: shippingCharge.amountCents,
              postageCents: shippingCharge.postageCents,
              packagingCents: shippingCharge.packagingCents,
              unroundedCents: shippingCharge.unroundedCents,
              roundingCents: shippingCharge.roundingCents,
              carrier: selectedShippingOption?.carrier,
              service: selectedShippingOption?.service,
              transitLabel: selectedShippingOption?.transitLabel,
              carrierTransitLabel: selectedShippingOption?.carrierTransitLabel,
              deliveryEstimate: selectedShippingOption?.deliveryEstimate,
              quoteExpiresAt: checkoutShippingQuote?.expires_at
            }
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("payment_intent create error:", error);
    await cancelCheckoutShippingQuote(checkoutShippingQuote?.id);
    return respond.json(
      { error: "We couldn't start payment. Please try again." },
      { status: 500 }
    );
  }
}
