"use client";

import { useState } from "react";

export default function FaqAccordion({ items = [] }) {
  const [openIndex, setOpenIndex] = useState(null);

  return (
    <div className="faq__list">
      {items.map((item, index) => {
        const isOpen = openIndex === index;

        return (
          <details
            key={item.q}
            name="homepage-faq"
            open={isOpen}
            className="faq__item"
            data-analytics-id={`faq_${index + 1}`}
            data-analytics-type="faq"
          >
            <summary
              onClick={(event) => {
                event.preventDefault();
                setOpenIndex((current) => (current === index ? null : index));
              }}
            >
              {item.q}
            </summary>
            {isOpen ? (
              <div className="faq__collapsible" aria-hidden="false">
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
            ) : null}
          </details>
        );
      })}
    </div>
  );
}
