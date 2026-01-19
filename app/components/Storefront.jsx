"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

const formatCurrency = (amountInCents) => {
  const n = Number(amountInCents);
  if (!Number.isFinite(n)) return "$0.00";
  return `$${(n / 100).toFixed(2)}`;
};

const INVENTORY_POLL_MS = 30000;

export default function Storefront({ products, inventory = {} }) {
  const searchParams = useSearchParams();
  const [cart, setCart] = useState({});
  const [status, setStatus] = useState("idle");
  const [notice, setNotice] = useState("");
  const [fulfillment, setFulfillment] = useState("ship");
  const [liveInventory, setLiveInventory] = useState(inventory);

  const basePriceCents = products[0]?.priceCents ?? 1199;

  const applyInventory = (nextInventory) => {
    if (nextInventory && typeof nextInventory === "object") {
      setLiveInventory(nextInventory);
    }
  };

  // Poll inventory after mount. Keep first render stable using `inventory` prop.
  useEffect(() => {
    let active = true;

    const fetchInventory = async () => {
      try {
        const response = await fetch(`/api/inventory?ts=${Date.now()}`, {
          cache: "no-store"
        });
        if (!response.ok) return;

        const data = await response.json();
        if (!active || !data) return;

        applyInventory(data);
      } catch {
        // Ignore refresh failures; keep last known snapshot.
      }
    };

    fetchInventory();
    const intervalId = setInterval(fetchInventory, INVENTORY_POLL_MS);

    const handleVisibility = () => {
      if (document.visibilityState === "visible") fetchInventory();
    };

    window.addEventListener("focus", fetchInventory);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      active = false;
      clearInterval(intervalId);
      window.removeEventListener("focus", fetchInventory);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    applyInventory(inventory);
  }, [inventory]);

  useEffect(() => {
    const checkoutStatus = searchParams?.get("checkout");

    if (!checkoutStatus) return;

    if (checkoutStatus === "success") {
      setStatus("success");
      setNotice("Payment received. We will email fulfillment details shortly.");
      setCart({});
      setFulfillment("ship");
    } else if (checkoutStatus === "cancel") {
      setStatus("error");
      setNotice("Checkout canceled. Your cart is still saved below.");
    }

    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("checkout");
      window.history.replaceState({}, "", url.toString());
    }
  }, [searchParams]);

  const cartItems = useMemo(() => {
    return products
      .filter((product) => cart[product.sku])
      .map((product) => {
        const quantity = cart[product.sku];
        const record = liveInventory[product.sku] || {
          on_hand: 0,
          preorders_remaining: 0,
          units_sold: 0
        };

        const available = Math.max(0, Number(record.on_hand || 0));
        const inStockUnits = Math.min(quantity, available);
        const preorderUnits = Math.max(0, quantity - available);

        return {
          ...product,
          quantity,
          available,
          inStockUnits,
          preorderUnits,
          preordersCount: Math.max(0, Number(record.preorders_remaining || 0)),
          salesCount: Math.max(0, Number(record.units_sold || 0)),
          lineTotal: quantity * (product.priceCents || 0)
        };
      });
  }, [cart, products, liveInventory]);

  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const hasPreorder = cartItems.some((item) => item.preorderUnits > 0);
  const requiresAddress = fulfillment === "ship";

  const handleAdd = (product) => {
    setCart((prev) => {
      const currentQty = prev[product.sku] || 0;
      return {
        ...prev,
        [product.sku]: currentQty + 1
      };
    });
  };

  const handleQuantityChange = (sku, nextQty) => {
    setCart((prev) => {
      if (nextQty <= 0) {
        const { [sku]: _, ...rest } = prev;
        return rest;
      }

      return {
        ...prev,
        [sku]: nextQty
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (status === "submitting") return;

    if (cartItems.length === 0) {
      setStatus("error");
      setNotice("Add jars to your cart before checking out.");
      return;
    }

    setStatus("submitting");
    setNotice("Redirecting to secure checkout...");

    const formData = new FormData(event.currentTarget);

    const payload = {
      fulfillment,
      customer: {
        name: String(formData.get("name") || "").trim(),
        email: String(formData.get("email") || "").trim(),
        phone: String(formData.get("phone") || "").trim(),
        address1: String(formData.get("address1") || "").trim(),
        address2: String(formData.get("address2") || "").trim(),
        city: String(formData.get("city") || "").trim(),
        state: String(formData.get("state") || "").trim(),
        postalCode: String(formData.get("postalCode") || "").trim(),
        note: String(formData.get("note") || "").trim()
      },
      // Only send sku + quantity. Server decides sold vs preorder.
      items: cartItems.map((item) => ({
        sku: item.sku,
        quantity: item.quantity
      }))
    };

    try {
      const response = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to start checkout.");
      }

      if (result?.url) {
        window.location.assign(result.url);
        return;
      }

      throw new Error("Checkout session did not return a URL.");
    } catch (error) {
      setStatus("error");
      setNotice(error?.message || "Something went wrong.");
    }
  };

  return (
    <div className="store">
      <div className="store__grid">
        {products.map((product) => {
          const record = liveInventory[product.sku] || {
            on_hand: 0,
            preorders_remaining: 0,
            units_sold: 0
          };

          const available = Math.max(0, Number(record.on_hand || 0));
          const isOut = available <= 0;

          const cartQty = cart[product.sku] || 0;
          const wouldPreorder = Math.max(0, cartQty + 1 - available) > 0;

          return (
            <article className="product-card" key={product.sku}>
              <img src={product.image} alt={product.name} loading="lazy" />
              <div className="product-card__content">
                <div>
                  <div className="product-card__header">
                    <h3>{product.name}</h3>
                    <span>{product.profile}</span>
                  </div>
                  <p>{product.description}</p>
                  <ul>
                    {product.specs.map((spec) => (
                      <li key={spec}>{spec}</li>
                    ))}
                  </ul>
                </div>

                <div className="product-card__footer">
                  <div>
                    <div className="price">{formatCurrency(product.priceCents)}</div>

                    <div className="shipping">+ shipping</div>

                    <div className="stock">
                      <span>Stock:</span>{" "}
                      <span>
                        {available} Jar{available === 1 ? "" : "s"}
                      </span>
                    </div>

                    {!isOut ? (
                      <div className="stock">
                        <span>Note:</span> <span>Extras become preorder</span>
                      </div>
                    ) : null}
                  </div>

                  <button
                    className="button button--dark"
                    type="button"
                    onClick={() => handleAdd(product)}
                    aria-label={`Add ${product.name} to cart`}
                  >
                    {isOut || wouldPreorder ? "Add (may preorder)" : "Add To Cart"}
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <aside className="store__panel">
        <div className="cart">
          <div className="cart__header">
            <h3>Your Cart</h3>
            <span>
              {itemCount} item{itemCount === 1 ? "" : "s"}
            </span>
          </div>

          {cartItems.length === 0 ? (
            <p className="cart__empty">Select any jar to begin. Stock updates live.</p>
          ) : (
            <div className="cart__list">
              {cartItems.map((item) => (
                <div className="cart__item" key={item.sku}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.inStockUnits > 0
                        ? `In stock: ${item.inStockUnits}`
                        : "In stock: 0"}
                      {" | "}
                      {item.preorderUnits > 0
                        ? `Preorder: ${item.preorderUnits}`
                        : "Preorder: 0"}
                      {" | "}
                      {item.profile}
                    </span>
                  </div>

                  <div className="cart__controls">
                    <button
                      type="button"
                      onClick={() =>
                        handleQuantityChange(item.sku, item.quantity - 1)
                      }
                      aria-label={`Decrease ${item.name} quantity`}
                    >
                      -
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleQuantityChange(item.sku, item.quantity + 1)
                      }
                      aria-label={`Increase ${item.name} quantity`}
                    >
                      +
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="cart__summary">
            <div>
              <span>Subtotal</span>
              <strong>{formatCurrency(subtotal)}</strong>
            </div>
            <div>
              <span>Tax</span>
              <strong>Calculated at checkout</strong>
            </div>
            <div>
              <span>Shipping</span>
              <strong>Calculated at checkout</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>Calculated at checkout</strong>
            </div>
          </div>
        </div>

        <form className="order-form" onSubmit={handleSubmit}>
          <h3>Complete Your Order</h3>
          <p>
            Each jar is {formatCurrency(basePriceCents)} plus shipping. Preorders
            apply when quantity exceeds available stock.
          </p>

          <div className="form__row">
            <label>
              Name
              <input type="text" name="name" placeholder="Your name" required />
            </label>
            <label>
              Email
              <input
                type="email"
                name="email"
                placeholder="you@vidaverde.com"
                required
              />
            </label>
          </div>

          <div className="form__row">
            <label>
              Phone
              <input type="tel" name="phone" placeholder="Optional" />
            </label>
            <label>
              Fulfillment
              <select
                name="fulfillment"
                value={fulfillment}
                onChange={(event) => setFulfillment(event.target.value)}
              >
                <option value="ship">Ship to me</option>
                <option value="market">Pick up at Fulshear Farmers Market</option>
              </select>
            </label>
          </div>

          {requiresAddress ? (
            <>
              <label>
                Address line 1
                <input
                  type="text"
                  name="address1"
                  placeholder="Street address"
                  required
                />
              </label>
              <label>
                Address line 2
                <input type="text" name="address2" placeholder="Apt, suite" />
              </label>
              <div className="form__row">
                <label>
                  City
                  <input type="text" name="city" required />
                </label>
                <label>
                  State
                  <input type="text" name="state" required />
                </label>
                <label>
                  Postal code
                  <input type="text" name="postalCode" required />
                </label>
              </div>
            </>
          ) : (
            <div className="market-note">
              Pickup available Saturdays at the Fulshear Farmers Market.
            </div>
          )}

          <label>
            Order note
            <textarea
              name="note"
              rows={3}
              placeholder="Dietary notes or pickup timing."
            ></textarea>
          </label>

          {notice ? (
            <div
              className={`form__status${
                status === "error" ? " form__status--error" : ""
              }`}
              role="status"
              aria-live="polite"
            >
              {notice}
            </div>
          ) : null}

          <button
            className="button button--dark"
            type="submit"
            disabled={status === "submitting"}
          >
            {status === "submitting"
              ? "Redirecting..."
              : hasPreorder
                ? "Place Preorder"
                : "Place Order"}
          </button>
        </form>
      </aside>
    </div>
  );
}
