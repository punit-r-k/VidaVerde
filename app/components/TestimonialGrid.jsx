"use client";

import { useEffect, useRef, useState } from "react";

const REVIEW_PREVIEW_SENTENCE_COUNT = 2;
const SWIPE_THRESHOLD = 48;

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const splitReviewQuote = (
  quote,
  previewSentenceCount = REVIEW_PREVIEW_SENTENCE_COUNT
) => {
  const text = typeof quote === "string" ? quote.trim() : "";

  if (!text) {
    return {
      preview: "",
      full: "",
      hasOverflow: false
    };
  }

  const sentences = text.match(/[^.!?]+[.!?]+(?:["')\]]+)?|[^.!?]+$/g);
  const normalizedSentences = Array.isArray(sentences)
    ? sentences.map((sentence) => sentence.trim()).filter(Boolean)
    : [text];

  const preview = normalizedSentences
    .slice(0, previewSentenceCount)
    .join(" ");

  return {
    preview: preview || text,
    full: text,
    hasOverflow: normalizedSentences.length > previewSentenceCount
  };
};

const renderHighlightedText = (text, highlights = [], keyPrefix) => {
  const normalizedHighlights = Array.from(
    new Set(
      highlights
        .filter((highlight) => typeof highlight === "string")
        .map((highlight) => highlight.trim())
        .filter(Boolean)
    )
  ).sort((left, right) => right.length - left.length);

  if (!text || !normalizedHighlights.length) {
    return text;
  }

  const highlightSet = new Set(
    normalizedHighlights.map((highlight) => highlight.toLowerCase())
  );
  const matcher = new RegExp(
    `(${normalizedHighlights.map(escapeRegExp).join("|")})`,
    "gi"
  );

  return text.split(matcher).map((part, index) =>
    highlightSet.has(part.toLowerCase()) ? (
      <span className="voices-keyword" key={`${keyPrefix}-${index}`}>
        {part}
      </span>
    ) : (
      part
    )
  );
};

export default function TestimonialGrid({ testimonials = [] }) {
  const [activeIndex, setActiveIndex] = useState(null);
  const closeButtonRef = useRef(null);
  const touchStartXRef = useRef(null);
  const activeReview =
    activeIndex === null ? null : testimonials[activeIndex] || null;

  const openReview = (index) => setActiveIndex(index);
  const closeReview = () => setActiveIndex(null);
  const showPrevious = () => {
    if (!testimonials.length || activeIndex === null) return;
    setActiveIndex((activeIndex - 1 + testimonials.length) % testimonials.length);
  };
  const showNext = () => {
    if (!testimonials.length || activeIndex === null) return;
    setActiveIndex((activeIndex + 1) % testimonials.length);
  };

  useEffect(() => {
    if (activeIndex === null) return undefined;

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeReview();
      } else if (event.key === "ArrowLeft") {
        showPrevious();
      } else if (event.key === "ArrowRight") {
        showNext();
      }
    };

    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeIndex]);

  const handleTouchStart = (event) => {
    touchStartXRef.current = event.touches[0]?.clientX ?? null;
  };

  const handleTouchEnd = (event) => {
    if (touchStartXRef.current === null) return;

    const touchEndX = event.changedTouches[0]?.clientX ?? touchStartXRef.current;
    const deltaX = touchEndX - touchStartXRef.current;
    touchStartXRef.current = null;

    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;

    if (deltaX > 0) {
      showPrevious();
    } else {
      showNext();
    }
  };

  return (
    <>
      <div className="voices__grid" aria-label="Customer testimonials">
        {testimonials.map((item, index) => {
          const review = splitReviewQuote(item.quote);
          const isActive = activeIndex === index;

          return (
            <article
              key={item.name}
              className={`voices-card${isActive ? " voices-card--active" : ""}`}
            >
              <p className="voices-card__index">
                {String(index + 1).padStart(2, "0")}
              </p>
              <p className="voices-card__quote">
                &quot;
                {renderHighlightedText(
                  review.preview,
                  item.highlights,
                  `preview-${index}`
                )}
                {review.hasOverflow ? "..." : ""}
                &quot;
              </p>
              <div className="voices-card__footer">
                <p className="voices-card__meta">
                  <strong>{item.name}</strong>
                  <span>{item.meta}</span>
                </p>
                {review.hasOverflow ? (
                  <button
                    className="voices-card__button"
                    type="button"
                    aria-haspopup="dialog"
                    aria-expanded={isActive}
                    onClick={() => openReview(index)}
                  >
                    Read more
                  </button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {activeReview ? (
        <div
          className="voices-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby={`testimonial-title-${activeIndex}`}
          onClick={closeReview}
        >
          <div
            className="voices-modal__panel"
            onClick={(event) => event.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          >
            <div className="voices-modal__topbar">
              <p className="voices-modal__count">
                {String(activeIndex + 1).padStart(2, "0")}
                {" / "}
                {String(testimonials.length).padStart(2, "0")}
              </p>
              <div className="voices-modal__topbar-actions">
                <button
                  className="voices-modal__nav"
                  type="button"
                  onClick={showPrevious}
                  aria-label="Show previous review"
                >
                  Prev
                </button>
                <button
                  className="voices-modal__nav"
                  type="button"
                  onClick={showNext}
                  aria-label="Show next review"
                >
                  Next
                </button>
                <button
                  ref={closeButtonRef}
                  className="voices-modal__close"
                  type="button"
                  onClick={closeReview}
                  aria-label={`Close review from ${activeReview.name}`}
                >
                  Close
                </button>
              </div>
            </div>

            <div className="voices-modal__content">
              <aside className="voices-modal__identity">
                <p className="voices-modal__eyebrow">Customer voice</p>
                <h3 id={`testimonial-title-${activeIndex}`}>{activeReview.name}</h3>
                <p className="voices-modal__meta">{activeReview.meta}</p>
              </aside>

              <div className="voices-modal__review">
                <blockquote className="voices-modal__quote">
                  {renderHighlightedText(
                    activeReview.quote,
                    activeReview.highlights,
                    `full-${activeIndex}`
                  )}
                </blockquote>
                <p className="voices-modal__hint">
                  Swipe left or right to browse more reviews.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
