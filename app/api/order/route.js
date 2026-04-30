import { securePublicRoute } from "@/lib/apiSecurity";
import {
  checkoutPayloadSchema,
  mapCheckoutIssuesToFieldErrors
} from "@/lib/checkoutSchema";
import { MARKET_PICKUP_POLICY_VERSION } from "@/lib/pickupDetails";
import { getProductMap } from "@/lib/products";
import { getRouteRateLimitConfig } from "@/lib/rateLimit";
import { getInventoryMap } from "@/lib/stock";
import { stripeConfig, stripeRequest } from "@/lib/stripe";

const ORDER_RATE_LIMIT = getRouteRateLimitConfig("ORDER_CREATE", {
  windowMs: 60_000,
  ipMax: 6
});

const CHECKOUT_UNAVAILABLE_MESSAGE =
  "Checkout is not available right now. Please try again later.";

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

  const serializedExpectedPreorders = serializeExpectedPreorderMap(
    normalizedItems,
    inventoryMap
  );
  if (serializedExpectedPreorders) {
    metadata.expected_preorder = asMetadataValue(serializedExpectedPreorders, 500);
  }

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
        { error: "We couldn't start payment. Please try again." },
        { status: 500 }
      );
    }

    if (!data?.client_secret || !data?.id) {
      return respond.json(
        { error: "We couldn't start payment. Please try again." },
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
      { error: "We couldn't start payment. Please try again." },
      { status: 500 }
    );
  }
}
