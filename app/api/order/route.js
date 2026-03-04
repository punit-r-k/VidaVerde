import { NextResponse } from "next/server";
import { getProductMap } from "@/lib/products";
import { rateLimit } from "@/lib/rateLimit";
import {
  checkoutPayloadSchema,
  mapCheckoutIssuesToFieldErrors
} from "@/lib/checkoutSchema";
import { stripeConfig, stripeRequest } from "@/lib/stripe";

const CHECKOUT_WINDOW_MS = 60_000;
const CHECKOUT_MAX = 6;

const asMetadataValue = (value, maxLength = 500) =>
  String(value || "").trim().slice(0, maxLength);

const getClientId = (request) => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip") || "unknown";
};

export const runtime = "nodejs";

export async function POST(request) {
  if (!stripeConfig) {
    return NextResponse.json(
      { error: "Stripe is not configured." },
      { status: 500 }
    );
  }

  const clientId = getClientId(request);
  const limit = rateLimit(clientId, {
    windowMs: CHECKOUT_WINDOW_MS,
    max: CHECKOUT_MAX
  });

  if (!limit.ok) {
    const retryAfter = Math.max(1, Math.ceil((limit.resetAt - Date.now()) / 1000));
    return NextResponse.json(
      { error: "Too many checkout attempts. Please wait and try again." },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfter)
        }
      }
    );
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const parsedPayload = checkoutPayloadSchema.safeParse(payload);
  if (!parsedPayload.success) {
    const issues = parsedPayload.error.issues;
    const firstIssue = issues[0];
    const fieldErrors = mapCheckoutIssuesToFieldErrors(issues);

    return NextResponse.json(
      {
        error: firstIssue?.message || "Checkout details are invalid.",
        fieldErrors
      },
      { status: 400 }
    );
  }

  const {
    customer,
    items: normalizedItems,
    fulfillment: normalizedFulfillment
  } = parsedPayload.data;
  const { name, email } = customer;
  const isPickup = normalizedFulfillment === "market";

  const skus = normalizedItems.map((item) => item.sku);
  const productMap = await getProductMap(skus);

  const lineItems = normalizedItems
    .map((item) => {
      const product = productMap.get(item.sku);
      const unitAmount = Number(product?.price_cents);
      if (!product || !Number.isFinite(unitAmount) || unitAmount < 0) return null;

      return {
        sku: item.sku,
        name: product.name,
        image: product.image_url || "",
        quantity: item.quantity,
        unitAmount
      };
    })
    .filter(Boolean);

  if (lineItems.length === 0 || lineItems.length !== normalizedItems.length) {
    return NextResponse.json(
      { error: "Items are unavailable." },
      { status: 400 }
    );
  }

  const siteUrl = (process.env.SITE_URL || request.headers.get("origin") || "").replace(
    /\/$/,
    ""
  );

  if (!siteUrl) {
    return NextResponse.json(
      { error: "Site URL is not configured." },
      { status: 500 }
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
    note: asMetadataValue(customer.note, 500)
  };
  const serializedItems = JSON.stringify(itemsPayload);
  if (serializedItems.length <= 500) {
    metadata.items = serializedItems;
  }

  try {
    const stripeLineItems = lineItems.map((item) => ({
      quantity: item.quantity,
      price_data: {
        currency: "usd",
        unit_amount: item.unitAmount,
        product_data: {
          name: item.name,
          images: item.image ? [item.image] : undefined,
          metadata: { sku: item.sku }
        }
      }
    }));

    const stripePayload = {
      mode: "payment",
      success_url: `${siteUrl}/?checkout=success`,
      cancel_url: `${siteUrl}/?checkout=cancel`,
      customer_email: email,
      line_items: stripeLineItems,
      metadata
    };

    if (!isPickup) {
      stripePayload.shipping_address_collection = {
        allowed_countries: ["US"]
      };
    }

    const { ok, data, error } = await stripeRequest("/v1/checkout/sessions", {
      method: "POST",
      body: stripePayload
    });

    if (!ok) {
      console.error("stripe checkout session error:", error);
      return NextResponse.json(
        { error: "Unable to start checkout." },
        { status: 500 }
      );
    }

    if (!data?.url) {
      return NextResponse.json(
        { error: "Unable to start checkout." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: data.url }, { status: 200 });
  } catch (error) {
    console.error("checkout session error:", error);
    return NextResponse.json(
      { error: "Unable to start checkout." },
      { status: 500 }
    );
  }
}
