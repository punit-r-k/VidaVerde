"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PRODUCT_PRICE } from "@/lib/products";

const formatCurrency = (amount) => `$${amount.toFixed(2)}`;
const INVENTORY_POLL_MS = 30000;
const hasSheetData = (inventory = {}) =>
  Object.values(inventory).some(
    (entry) => Number.isInteger(entry?.row) && entry.row > 0
  );

export default function Storefront({ products, inventory = {} }) {
  const [cart, setCart] = useState({});
  const [status, setStatus] = useState("idle");
  const [notice, setNotice] = useState("");
  const [fulfillment, setFulfillment] = useState("ship");
  const [liveInventory, setLiveInventory] = useState(inventory);
  const hasSheetRef = useRef(hasSheetData(inventory));

  const applyInventory = (nextInventory) => {
    const nextHasSheet = hasSheetData(nextInventory);

    if (nextHasSheet || !hasSheetRef.current) {
      hasSheetRef.current = nextHasSheet;
      setLiveInventory(nextInventory);
    }
  };

  useEffect(() => {
    let active = true;

    const fetchInventory = async () => {
      const cacheBust = Date.now();
      try {
        const response = await fetch(`/api/inventory?ts=${cacheBust}`, {
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const data = await response.json();

        if (!active || !data) {
          return;
        }

        applyInventory(data);
      } catch (error) {
        // Ignore client refresh failures; we still have the server snapshot.
      }
    };

    fetchInventory();
    const intervalId = setInterval(fetchInventory, INVENTORY_POLL_MS);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchInventory();
      }
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

  const cartItems = useMemo(() => {
    return products
      .filter((product) => cart[product.sku])
      .map((product) => {
        const quantity = cart[product.sku];
        const record = liveInventory[product.sku] || {
          stock: 0,
          preorders: 0,
          sales: 0
        };
        const displayName = liveInventory[product.sku]?.name || product.name;
        const available = record.stock;
        const preorder = available <= 0;

        return {
          ...product,
          name: displayName,
          quantity,
          available,
          preorder,
          preordersCount: record.preorders,
          salesCount: record.sales,
          lineTotal: quantity * PRODUCT_PRICE
        };
      });
  }, [cart, products, liveInventory]);

  const itemCount = cartItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = cartItems.reduce((sum, item) => sum + item.lineTotal, 0);
  const hasPreorder = cartItems.some((item) => item.preorder);
  const requiresAddress = fulfillment === "ship";

  const handleAdd = (product) => {
    const available = liveInventory[product.sku]?.stock ?? 0;

    setCart((prev) => {
      const currentQty = prev[product.sku] || 0;
      const nextQty =
        available > 0 ? Math.min(currentQty + 1, available) : currentQty + 1;

      return {
        ...prev,
        [product.sku]: nextQty
      };
    });
  };

  const handleQuantityChange = (sku, nextQty) => {
    setCart((prev) => {
      if (nextQty <= 0) {
        const { [sku]: _, ...rest } = prev;
        return rest;
      }

      const available = liveInventory[sku]?.stock ?? 0;
      const adjustedQty = available > 0 ? Math.min(nextQty, available) : nextQty;

      return {
        ...prev,
        [sku]: adjustedQty
      };
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (status === "submitting") {
      return;
    }

    if (cartItems.length === 0) {
      setStatus("error");
      setNotice("Add jars to your cart before checking out.");
      return;
    }

    setStatus("submitting");
    setNotice("");

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
      items: cartItems.map((item) => ({
        sku: item.sku,
        name: item.name,
        quantity: item.quantity,
        preorder: item.preorder
      }))
    };

    try {
      const response = await fetch("/api/order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Unable to place order.");
      }

      setStatus("success");
      setNotice(
        hasPreorder
          ? "Preorder received. We will follow up with ship timing."
          : "Order received. We will follow up with shipping details."
      );
      setCart({});
      setFulfillment("ship");
      event.currentTarget.reset();
    } catch (error) {
      setStatus("error");
      setNotice(error.message || "Something went wrong.");
    }
  };

  return (
    <div className="store">
      <div className="store__grid">
        {products.map((product) => {
          const record = liveInventory[product.sku] || {
            stock: 0,
            preorders: 0,
            sales: 0
          };
          const displayName = liveInventory[product.sku]?.name || product.name;
          const available = record.stock;
          const preorder = available <= 0;
          const atLimit = available > 0 && cart[product.sku] >= available;

          return (
            <article className="product-card" key={product.sku}>
              <img src={product.image} alt={displayName} loading="lazy" />
              <div className="product-card__content">
                <div>
                  <div className="product-card__header">
                    <h3 suppressHydrationWarning>{displayName}</h3>
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
                    <div className="price">$12</div>
                    <div className="stock" suppressHydrationWarning>
                      <span>Stock: {available}</span>
                      <span>Jar{available === 1 ? "" : "s"}</span>
                      {preorder ? <span>(Preorder)</span> : null}
                    </div>
                    <div className="shipping">+ shipping</div>
                    <div className="inventory" aria-hidden="true"></div>
                  </div>
                  <button
                    className="button button--dark"
                    type="button"
                    onClick={() => handleAdd(product)}
                    disabled={atLimit}
                  >
                    {preorder ? "Preorder Jar" : "Add To Cart"}
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
            <span>{itemCount} item{itemCount === 1 ? "" : "s"}</span>
          </div>
          {cartItems.length === 0 ? (
            <p className="cart__empty">
              Select any jar to begin. Stock updates live from our cellar sheet.
            </p>
          ) : (
            <div className="cart__list">
              {cartItems.map((item) => (
                <div className="cart__item" key={item.sku}>
                  <div>
                    <strong>{item.name}</strong>
                    <span>
                      {item.preorder ? "Preorder" : "In stock"} | {item.profile}
                    </span>
                  </div>
                  <div className="cart__controls">
                    <button
                      type="button"
                      onClick={() =>
                        handleQuantityChange(item.sku, item.quantity - 1)
                      }
                    >
                      -
                    </button>
                    <span>{item.quantity}</span>
                    <button
                      type="button"
                      onClick={() =>
                        handleQuantityChange(item.sku, item.quantity + 1)
                      }
                      disabled={item.available > 0 && item.quantity >= item.available}
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
              <span>Shipping</span>
              <strong>Calculated after request</strong>
            </div>
          </div>
        </div>

        <form className="order-form" onSubmit={handleSubmit}>
          <h3>Complete Your Order</h3>
          <p>
            Each jar is $12 plus shipping. Preorders open whenever inventory runs
            out.
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
                  required={requiresAddress}
                />
              </label>
              <label>
                Address line 2
                <input type="text" name="address2" placeholder="Apt, suite" />
              </label>
              <div className="form__row">
                <label>
                  City
                  <input type="text" name="city" required={requiresAddress} />
                </label>
                <label>
                  State
                  <input type="text" name="state" required={requiresAddress} />
                </label>
                <label>
                  Postal code
                  <input
                    type="text"
                    name="postalCode"
                    required={requiresAddress}
                  />
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
              ? "Sending..."
              : hasPreorder
                ? "Place Preorder"
                : "Place Order"}
          </button>
        </form>
      </aside>
    </div>
  );
}
