export default function MarketPickupPolicy({ items = [] }) {
  return (
    <details className="market__policy-dropdown">
      <summary
        className="market__policy-toggle button button--ghost"
        data-analytics-id="market_pickup_policy"
        data-analytics-type="dropdown"
      >
        View Pickup Policy
      </summary>

      <div className="market__policy-dropdown-content">
        <div className="market__policy-items">
          {items.map((item) => (
            <div key={item.label} className="market__policy-item">
              <span className="market__policy-item-label">{item.label}</span>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
      </div>
    </details>
  );
}
