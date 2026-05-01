"use client";

import { useId, useState } from "react";

export default function MarketPickupPolicy({ items = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const contentId = useId();

  return (
    <div className="market__policy-dropdown">
      <button
        type="button"
        className={`market__policy-toggle button button--ghost${isOpen ? " is-open" : ""}`}
        aria-expanded={isOpen}
        aria-controls={contentId}
        data-analytics-id="market_pickup_policy"
        data-analytics-type="dropdown"
        onClick={() => setIsOpen((open) => !open)}
      >
        View Pickup Policy
      </button>

      {isOpen ? (
        <div id={contentId} className="market__policy-dropdown-content">
          <div className="market__policy-items">
            {items.map((item) => (
              <div key={item.label} className="market__policy-item">
                <span className="market__policy-item-label">{item.label}</span>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
