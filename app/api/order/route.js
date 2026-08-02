import { securePublicRoute } from "@/lib/apiSecurity";
import {
  checkoutPayloadSchema,
  mapCheckoutIssuesToFieldErrors,
  SHIPPING_COUNTRY_CODE
} from "@/lib/checkoutSchema";
import { MARKET_PICKUP_POLICY_VERSION } from "@/lib/pickupDetails";
import { getAuthoritativeProductMap } from "@/lib/products";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { readBoundedJsonBody } from "@/lib/requestBody";
import {
  getShippingOptionsForCart,
  normalizeProductType
} from "@/lib/shippingPricing";
import { selectCheckoutShippingQuote } from "@/lib/checkoutShippingQuote";
import { createEasyPostRatingContext } from "@/lib/shippingQuotes";
import { resolveCustomerShippingSelections } from "@/lib/shippingOptionPolicy";
import { getInventoryMap } from "@/lib/stock";
import { stripeConfig, stripeRequest } from "@/lib/stripe";
import {
  getStripeCheckoutIdempotencyKey,
  isCheckoutExpectationExact
} from "@/lib/stripeOrderIntegrity";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const ORDER_RATE_LIMIT = getRouteRateLimitConfig("ORDER_CREATE", {
  windowMs: 60_000,
  ipMax: 6
});

const CHECKOUT_UNAVAILABLE_MESSAGE =
  "Checkout is not available right now. Please try again later.";
const SHIPPING_QUOTE_LIFETIME_MS = 60 * 60 * 1000;
const ORDER_BODY_MAX_BYTES = 64 * 1024;

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

const cancelCheckoutShippingQuote = async (quoteId) => {
  if (!quoteId || !supabaseAdmin) return;

  const { error } = await supabaseAdmin
    .from("checkout_shipping_quotes")
    .update({
      status: "cancelled",
      updated_at: new Date().toISOString()
    })
    .eq("id", quoteId)
    .eq("status", "quoted");

  if (error) {
    console.error("checkout shipping quote cancellation failed:", error.message);
  }
};

const getAttachedCheckoutShippingQuote = async (paymentIntentId) => {
  if (!paymentIntentId || !supabaseAdmin) return { data: null, error: null };

  return supabaseAdmin
    .from("checkout_shipping_quotes")
    .select(
      "id, status, postage_cents, packaging_cents, unrounded_cents, rounding_cents, " +
      "charged_shipping_cents, currency, service_level"
    )
    .eq("payment_session_id", paymentIntentId)
    .maybeSingle();
};

const isCompatibleAttachedQuote = ({ quote, shippingAmount, shippingOption }) =>
  quote?.status === "quoted" &&
  Number(quote?.charged_shipping_cents) === shippingAmount &&
  String(quote?.currency || "").trim().toUpperCase() === "USD" &&
  String(quote?.service_level || "").trim() === String(shippingOption || "").trim();

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

  const bodyResult = await readBoundedJsonBody(request, {
    maxBytes: ORDER_BODY_MAX_BYTES
  });
  if (!bodyResult.ok) {
    return respond.json(
      {
        error:
          bodyResult.status === 413
            ? "Your checkout details are too large. Please reduce the cart and try again."
            : "We couldn't read your checkout details. Please try again."
      },
      { status: bodyResult.status }
    );
  }

  let payload = bodyResult.data;
  let checkoutIdempotencyKey = "";
  let checkoutExpectation = null;
  if (
    payload &&
    typeof payload === "object" &&
    !Array.isArray(payload)
  ) {
    const checkoutPayload = { ...payload };
    checkoutIdempotencyKey = getStripeCheckoutIdempotencyKey(
      checkoutPayload.checkoutAttemptId
    );
    if (!checkoutIdempotencyKey) {
      return respond.json(
        { error: "That checkout attempt looks invalid. Please refresh and try again." },
        { status: 400 }
      );
    }
    delete checkoutPayload.checkoutAttemptId;

    const expectationFields = [
      "expectedTotalCents",
      "expectedShippingCents",
      "expectedShippingOption"
    ];
    const suppliedExpectationFields = expectationFields.filter((field) =>
      Object.hasOwn(checkoutPayload, field)
    );
    if (suppliedExpectationFields.length === expectationFields.length) {
      const expectedTotalCents = checkoutPayload.expectedTotalCents;
      const expectedShippingCents = checkoutPayload.expectedShippingCents;
      const expectedShippingOption = checkoutPayload.expectedShippingOption;
      const hasValidExpectation =
        suppliedExpectationFields.length === expectationFields.length &&
        Number.isSafeInteger(expectedTotalCents) &&
        expectedTotalCents > 0 &&
        Number.isSafeInteger(expectedShippingCents) &&
        expectedShippingCents >= 0 &&
        typeof expectedShippingOption === "string" &&
        expectedShippingOption.length <= 64;
      if (!hasValidExpectation) {
        return respond.json(
          { error: "Your checkout preview looks invalid. Please refresh and try again." },
          { status: 400 }
        );
      }

      checkoutExpectation = {
        totalCents: expectedTotalCents,
        shippingCents: expectedShippingCents,
        shippingOption: expectedShippingOption.trim().toLowerCase()
      };
    } else {
      return respond.json(
        { error: "Your checkout preview looks invalid. Please refresh and try again." },
        { status: 400 }
      );
    }

    expectationFields.forEach((field) => delete checkoutPayload[field]);
    payload = checkoutPayload;
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
    shippingOption: requestedShippingOption,
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
    getAuthoritativeProductMap(skus),
    getInventoryMap()
  ]);

  if (!productMap) {
    return respond.json(
      { error: "Checkout pricing is refreshing. Please try again in a moment." },
      { status: 503 }
    );
  }

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
  const requestedOption = shipping.options.find(
    (option) => option.id === requestedShippingOption
  ) || shipping.normalOption;
  let selectedShippingOption = isPickup ? null : requestedOption;
  let checkoutShippingQuote = null;
  let expectedArrivalDateKey = "";
  let expectedArrivalLabel = "";
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
      const orderCreatedAt = new Date();
      const hasPreorderItems = normalizedItems.some((item) =>
        getCurrentAllocation(item.quantity, inventoryMap?.[item.sku]).preorderUnits > 0
      );
      const ratingContext = createEasyPostRatingContext();
      const quoteResults = await Promise.allSettled(
        shipping.options.map((option) =>
          selectCheckoutShippingQuote({
            customer: {
              ...customer,
              country: SHIPPING_COUNTRY_CODE
            },
            itemsPayload,
            requestedOption: option,
            hasPreorderItems,
            orderCreatedAt,
            ratingContext
          })
        )
      );
      const selections = new Map();
      quoteResults.forEach((result, index) => {
        const option = shipping.options[index];
        if (result.status === "fulfilled") {
          selections.set(option.id, result.value);
          return;
        }
        console.error(
          `live EasyPost ${option.id} checkout quote failed:`,
          result.reason?.message || result.reason
        );
      });
      const policy = resolveCustomerShippingSelections({
        normalSelection: selections.get(shipping.normalOption.id),
        expeditedSelection: selections.get(shipping.expeditedOption.id),
        normalOption: shipping.normalOption
      });
      const selection = requestedOption.id === shipping.expeditedOption.id &&
        policy.expeditedSelection
        ? policy.expeditedSelection
        : policy.normalSelection;
      if (!selection) {
        const firstFailure = quoteResults.find((result) => result.status === "rejected");
        throw firstFailure?.reason || new Error("EasyPost returned no shipping rates.");
      }
      const fastestQuote = selection.quote;
      shippingCharge = selection.charge;
      selectedShippingOption = selection.option;
      const deliveryDays = selection.deliveryDays;
      expectedArrivalDateKey = selection.expectedArrivalDateKey;
      expectedArrivalLabel = selection.expectedArrivalLabel;

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
          service_level: selectedShippingOption.id,
          expected_arrival_date: expectedArrivalDateKey || null,
          expires_at: expiresAt
        })
        .select("id")
        .single();
      if (saveQuoteError || !savedQuote) {
        throw saveQuoteError || new Error("The live shipping quote could not be saved.");
      }
      checkoutShippingQuote = savedQuote;
    } catch (shippingError) {
      console.error("live EasyPost checkout quote failed:", shippingError?.message || shippingError);
      const noEligibleRate = /No EasyPost rate was available in the/i.test(
        String(shippingError?.message || "")
      );
      return respond.json(
        {
          error: noEligibleRate
            ? `We couldn't find an eligible ${requestedOption.label} rate for that address. Try the other shipping method or verify the address.`
            : "We couldn't calculate live shipping for that address. Please verify the address and try again.",
          fieldErrors: {
            [noEligibleRate ? "shippingOption" : "address1"]: noEligibleRate
              ? `No ${requestedOption.label} rate is currently available for this address.`
              : "Live shipping could not be calculated for this address."
          }
        },
        { status: noEligibleRate ? 422 : 502 }
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

  const authoritativeShippingOption = isPickup
    ? ""
    : String(selectedShippingOption?.id || "").trim().toLowerCase();
  if (!isCheckoutExpectationExact({
    expectation: checkoutExpectation,
    totalCents: estimatedTotal,
    shippingCents: defaultShippingAmount,
    shippingOption: authoritativeShippingOption
  })) {
    await cancelCheckoutShippingQuote(checkoutShippingQuote?.id);
    return respond.json(
      {
        code: "checkout_changed",
        error: "Your checkout total changed. Review the updated total and try again.",
        checkout: {
          subtotalCents: subtotal,
          shippingCents: defaultShippingAmount,
          totalCents: estimatedTotal,
          shippingOption: authoritativeShippingOption
        }
      },
      { status: 409 }
    );
  }

  const metadata = {
    checkout_flow: "payment_intent",
    fulfillment: asMetadataValue(normalizedFulfillment, 32),
    shipping_tier: asMetadataValue(isPickup ? "" : selectedShippingOption?.id, 64),
    shipping_option: asMetadataValue(isPickup ? "" : selectedShippingOption?.id, 64),
    shipping_option_label: asMetadataValue(
      isPickup ? "" : selectedShippingOption?.label,
      120
    ),
    shipping_estimate: asMetadataValue(
      isPickup
        ? ""
        : selectedShippingOption?.transitLabel,
      180
    ),
    sauerkraut_count: asMetadataValue(shipping.sauerkrautCount, 32),
    hot_sauce_count: asMetadataValue(shipping.hotSauceCount, 32),
    amount_subtotal: asMetadataValue(subtotal, 32),
    amount_shipping: asMetadataValue(defaultShippingAmount, 32),
    amount_tax: "0",
    amount_total: asMetadataValue(estimatedTotal, 32),
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
      metadata
    };

    if (!isPickup) {
      stripePayload.shipping = buildStripeShippingDetails(customer);
    }

    const { ok, data, error } = await stripeRequest("/v1/payment_intents", {
      method: "POST",
      body: stripePayload,
      idempotencyKey: checkoutIdempotencyKey || undefined
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
      const existingResult = await getAttachedCheckoutShippingQuote(data.id);
      if (existingResult.error) {
        console.error(
          "attached checkout shipping quote lookup failed:",
          existingResult.error.message
        );
        await cancelCheckoutShippingQuote(checkoutShippingQuote.id);
        return respond.json(
          { error: "We couldn't finish preparing shipping. Please try again." },
          { status: 500 }
        );
      }

      const existingQuote = existingResult.data;
      if (existingQuote) {
        await cancelCheckoutShippingQuote(checkoutShippingQuote.id);
        if (!isCompatibleAttachedQuote({
          quote: existingQuote,
          shippingAmount: defaultShippingAmount,
          shippingOption: selectedShippingOption?.id
        })) {
          return respond.json(
            {
              code: "checkout_already_processed",
              error: "That checkout attempt was already used. Please refresh and try again."
            },
            { status: 409 }
          );
        }

        checkoutShippingQuote = existingQuote;
        shippingCharge = {
          postageCents: Number(existingQuote.postage_cents),
          packagingCents: Number(existingQuote.packaging_cents),
          unroundedCents: Number(existingQuote.unrounded_cents),
          roundingCents: Number(existingQuote.rounding_cents),
          amountCents: Number(existingQuote.charged_shipping_cents)
        };
      } else {
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
          const recoveryResult = await getAttachedCheckoutShippingQuote(data.id);
          if (
            !recoveryResult.error &&
            isCompatibleAttachedQuote({
              quote: recoveryResult.data,
              shippingAmount: defaultShippingAmount,
              shippingOption: selectedShippingOption?.id
            })
          ) {
            await cancelCheckoutShippingQuote(checkoutShippingQuote.id);
            checkoutShippingQuote = recoveryResult.data;
            shippingCharge = {
              postageCents: Number(recoveryResult.data.postage_cents),
              packagingCents: Number(recoveryResult.data.packaging_cents),
              unroundedCents: Number(recoveryResult.data.unrounded_cents),
              roundingCents: Number(recoveryResult.data.rounding_cents),
              amountCents: Number(recoveryResult.data.charged_shipping_cents)
            };
          } else {
            console.error(
              "checkout shipping quote attachment failed:",
              attachQuoteError?.message || "The saved quote was no longer available."
            );
            if (!checkoutIdempotencyKey) {
              await stripeRequest(`/v1/payment_intents/${encodeURIComponent(data.id)}/cancel`, {
                method: "POST"
              });
            }
            await cancelCheckoutShippingQuote(checkoutShippingQuote.id);
            return respond.json(
              { error: "We couldn't finish preparing shipping. Please try again." },
              { status: 500 }
            );
          }
        }
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
              transitLabel: selectedShippingOption?.transitLabel,
              expectedArrivalLabel
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
