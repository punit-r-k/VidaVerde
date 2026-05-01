export default function FaqAccordion({ items = [] }) {
  return (
    <div className="faq__list">
      {items.map((item, index) => (
        <details
          key={item.q}
          name="homepage-faq"
          className="faq__item"
          data-analytics-id={`faq_${index + 1}`}
          data-analytics-type="faq"
        >
          <summary>{item.q}</summary>
          <div className="faq__collapsible">
            <div className="faq__collapsible-inner">
              {item.a ? <p>{item.a}</p> : null}
              {item.intro || item.bullets || item.notes ? (
                <div className="faq__answer">
                  {item.intro ? <p>{item.intro}</p> : null}
                  {item.bullets?.length ? (
                    <ul>
                      {item.bullets.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : null}
                  {item.notes?.map((line) => (
                    <p key={line}>{line}</p>
                  ))}
                </div>
              ) : null}
              {item.disclaimer ? (
                <p className="faq__disclaimer">
                  <span>{item.disclaimer}</span>
                </p>
              ) : null}
            </div>
          </div>
        </details>
      ))}
    </div>
  );
}
