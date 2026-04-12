import { securePublicRoute } from "@/lib/apiSecurity";
import {
  checkoutPayloadSchema,
  mapCheckoutIssuesToFieldErrors
} from "@/lib/checkoutSchema";
import { MARKET_PICKUP_POLICY_VERSION } from "@/lib/pickupDetails";
import { getProductMap } from "@/lib/products";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { stripeConfig, stripeRequest } from "@/lib/stripe";

const ORDER_RATE_LIMIT = getRouteRateLimitConfig("ORDER_CREATE", {
  windowMs: 60_000,
  ipMax: 6
});

const asMetadataValue = (value, maxLength = 500) =>
  String(value || "").trim().slice(0, maxLength);

const buildOrderSummary = (lineItems) =>
  lineItems.map((item) => `${item.name} x${item.quantity}`).join(", ");

const buildSkuSummary = (lineItems) =>
  lineItems.map((item) => `${item.sku}x${item.quantity}`).join(", ");

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
      { error: "Stripe is not configured." },
      { status: 500 }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return respond.json({ error: "Invalid payload." }, { status: 400 });
  }

  const parsedPayload = checkoutPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    const issues = parsedPayload.error.issues;
    const firstIssue = issues[0];
    const fieldErrors = mapCheckoutIssuesToFieldErrors(issues);

    return respond.json(
      {
        error: firstIssue?.message || "Checkout details are invalid.",
        fieldErrors
      },
      { status: 400 }
    );
  }

  const {
    customer,
    consents,
    items: normalizedItems,
    fulfillment: normalizedFulfillment
  } = parsedPayload.data;
  const { name, email } = customer;
  const isPickup = normalizedFulfillment === "market";

  if (isPickup && !consents?.pickupPolicyAccepted) {
    return respond.json(
      { error: "Pickup policy acceptance is required for market pickup." },
      { status: 400 }
    );
  }

  const skus = normalizedItems.map((item) => item.sku);
  const productMap = await getProductMap(skus);

  const lineItems = normalizedItems
    .map((item) => {
      const product = productMap.get(item.sku);
      const unitAmount = Number(product?.price_cents);
      if (!product || !Number.isFinite(unitAmount) || unitAmount < 0) return null;

      return {
        sku: item.sku,
        quantity: item.quantity,
        unitAmount,
        name: String(product.name || item.sku).trim()
      };
    })
    .filter(Boolean);

  if (lineItems.length === 0 || lineItems.length !== normalizedItems.length) {
    return respond.json(
      { error: "Items are unavailable." },
      { status: 400 }
    );
  }

  const siteUrl = (process.env.SITE_URL || request.headers.get("origin") || "").replace(
    /\/$/,
    ""
  );

  if (!siteUrl) {
    return respond.json(
      { error: "Site URL is not configured." },
      { status: 500 }
    );
  }

  const subtotal = lineItems.reduce(
    (sum, item) => sum + item.quantity * item.unitAmount,
    0
  );

  if (!Number.isFinite(subtotal) || subtotal <= 0) {
    return respond.json(
      { error: "Invalid order total." },
      { status: 400 }
    );
  }

  const itemsPayload = normalizedItems.map((item) => {
    const product = productMap.get(item.sku);

    return {
      sku: item.sku,
      quantity: item.quantity,
      price_cents: product?.price_cents ?? 0
    };
  });

  const orderSummary = buildOrderSummary(lineItems);
  const skuSummary = buildSkuSummary(lineItems);
  const totalUnits = lineItems.reduce((sum, item) => sum + item.quantity, 0);

  const metadata = {
    fulfillment: asMetadataValue(normalizedFulfillment, 32),
    customer_name: asMetadataValue(name, 120),
    customer_email: asMetadataValue(email, 254),
    customer_phone: asMetadataValue(customer.phone, 64),
    address1: asMetadataValue(customer.address1, 120),
    address2: asMetadataValue(customer.address2, 120),
    city: asMetadataValue(customer.city, 120),
    state: asMetadataValue(customer.state, 64),
    postal_code: asMetadataValue(customer.postalCode, 32),
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
    return respond.json(
      { error: "Cart is too large to process online. Please split into multiple orders." },
      { status: 400 }
    );
  }
  metadata.items = serializedItems;

  try {
    const stripePayload = {
      amount: subtotal,
      currency: "usd",
      automatic_payment_methods: {
        enabled: true
      },
      description: asMetadataValue(
        `Vida Verde ${isPickup ? "pickup" : "shipping"} order: ${orderSummary}`,
        500
      ),
      metadata
    };

    if (!isPickup) {
      stripePayload.shipping = {
        name: asMetadataValue(name, 120),
        phone: asMetadataValue(customer.phone, 64) || undefined,
        address: {
          line1: asMetadataValue(customer.address1, 120),
          line2: asMetadataValue(customer.address2, 120) || undefined,
          city: asMetadataValue(customer.city, 120),
          state: asMetadataValue(customer.state, 64),
          postal_code: asMetadataValue(customer.postalCode, 32),
          country: "US"
        }
      };
    }

    const { ok, data, error } = await stripeRequest("/v1/payment_intents", {
      method: "POST",
      body: stripePayload
    });

    if (!ok) {
      console.error("stripe payment_intent error:", error);
      return respond.json(
        { error: "Unable to start payment." },
        { status: 500 }
      );
    }

    if (!data?.client_secret || !data?.id) {
      return respond.json(
        { error: "Unable to start payment." },
        { status: 500 }
      );
    }

    return respond.json(
      {
        clientSecret: data.client_secret,
        paymentIntentId: data.id,
        returnUrl: `${siteUrl}/?checkout=success`
      },
      { status: 200 }
    );
  } catch (error) {
    console.error("payment_intent create error:", error);
    return respond.json(
      { error: "Unable to start payment." },
      { status: 500 }
    );
  }
}
