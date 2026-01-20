import { NextResponse } from "next/server";
import { getProductMap } from "@/lib/products";
import { rateLimit } from "@/lib/rateLimit";
import crypto from "crypto";
import { squareConfig, squareRequest } from "@/lib/square";

const CHECKOUT_WINDOW_MS = 60_000;
const CHECKOUT_MAX = 6;

const getClientId = (request) => {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    return forwardedFor.split(",")[0].trim();
  }

  return request.headers.get("x-real-ip") || "unknown";
};

export const runtime = "nodejs";

export async function POST(request) {
  if (!squareConfig) {
    return NextResponse.json(
      { error: "Square is not configured." },
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

  const { customer = {}, items = [], fulfillment = "ship" } = payload || {};
  const name = String(customer.name || "").trim();
  const email = String(customer.email || "").trim();

  if (!name || !email) {
    return NextResponse.json(
      { error: "Name and email are required." },
      { status: 400 }
    );
  }

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json(
      { error: "At least one item is required." },
      { status: 400 }
    );
  }

  const normalizedItems = items
    .map((item) => {
      const sku = String(item.sku || "").trim();
      const quantity = Number.parseInt(item.quantity, 10);

      if (!sku || Number.isNaN(quantity) || quantity <= 0) return null;

      return { sku, quantity };
    })
    .filter(Boolean);

  if (normalizedItems.length === 0) {
    return NextResponse.json(
      { error: "No valid items were provided." },
      { status: 400 }
    );
  }

  const normalizedFulfillment = fulfillment === "market" ? "market" : "ship";
  const isPickup = normalizedFulfillment === "market";

  if (!isPickup) {
    const address1 = String(customer.address1 || "").trim();
    const city = String(customer.city || "").trim();
    const state = String(customer.state || "").trim();
    const postalCode = String(customer.postalCode || "").trim();

    if (!address1 || !city || !state || !postalCode) {
      return NextResponse.json(
        { error: "Shipping address is incomplete." },
        { status: 400 }
      );
    }
  }

  const skus = normalizedItems.map((item) => item.sku);
  const productMap = await getProductMap(skus);

  const lineItems = normalizedItems
    .map((item) => {
      const product = productMap.get(item.sku);
      const unitAmount = Number(product?.price_cents);
      if (!product || !Number.isFinite(unitAmount) || unitAmount < 0) return null;

      return {
        quantity: item.quantity,
        price_data: {
          currency: "usd",
          unit_amount: unitAmount,
          tax_behavior: "exclusive",
          product_data: {
            name: product.name,
            images: product.image_url ? [product.image_url] : undefined,
            metadata: {
              sku: item.sku
            }
          }
        }
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
    fulfillment: normalizedFulfillment,
    customer_name: name,
    customer_email: email,
    customer_phone: String(customer.phone || "").trim(),
    address1: String(customer.address1 || "").trim(),
    address2: String(customer.address2 || "").trim(),
    city: String(customer.city || "").trim(),
    state: String(customer.state || "").trim(),
    postal_code: String(customer.postalCode || "").trim(),
    note: String(customer.note || "").trim(),
    items: JSON.stringify(itemsPayload)
  };

  try {
    const locationId = process.env.SQUARE_LOCATION_ID;
    if (!locationId) {
      return NextResponse.json(
        { error: "Square location is not configured." },
        { status: 500 }
      );
    }

    const squareLineItems = lineItems.map((item) => ({
      name: item.price_data.product_data.name,
      quantity: String(item.quantity),
      base_price_money: {
        amount: item.price_data.unit_amount,
        currency: "USD"
      }
    }));

    const payload = {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: locationId,
        line_items: squareLineItems,
        metadata
      },
      checkout_options: {
        redirect_url: `${siteUrl}/?checkout=success`,
        ask_for_shipping_address: !isPickup,
        allow_tipping: false
      },
      pre_populated_data: {
        buyer_email: email
      }
    };

    const { ok, data, error } = await squareRequest(
      "/v2/online-checkout/payment-links",
      {
        method: "POST",
        body: payload
      }
    );

    if (!ok) {
      console.error("square payment link error:", error);
      return NextResponse.json(
        { error: "Unable to start checkout." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url: data?.payment_link?.url }, { status: 200 });
  } catch (error) {
    console.error("checkout session error:", error);
    return NextResponse.json(
      { error: "Unable to start checkout." },
      { status: 500 }
    );
  }
}
