"use client";

import { useCallback, useEffect, useRef, useState } from "react";

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
  const trackRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(null);
  const [beltState, setBeltState] = useState({
    canScrollPrev: false,
    canScrollNext: false
  });
  const closeButtonRef = useRef(null);
  const touchStartXRef = useRef(null);
  const activeReview =
    activeIndex === null ? null : testimonials[activeIndex] || null;

  const updateBeltState = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;

    const maxScrollLeft = Math.max(track.scrollWidth - track.clientWidth, 0);
    const nextState = {
      canScrollPrev: track.scrollLeft > 2,
      canScrollNext: track.scrollLeft < maxScrollLeft - 2
    };

    setBeltState((currentState) =>
      currentState.canScrollPrev === nextState.canScrollPrev &&
      currentState.canScrollNext === nextState.canScrollNext
        ? currentState
        : nextState
    );
  }, []);

  const getTrackCards = useCallback(() => {
    const track = trackRef.current;
    if (!track) return [];
    return Array.from(track.querySelectorAll("[data-testimonial-card]"));
  }, []);

  const getScrollStep = useCallback(() => {
    const track = trackRef.current;
    const cards = getTrackCards();
    if (!track || !cards.length) return 0;

    if (cards.length > 1) {
      const inferredStep = cards[1].offsetLeft - cards[0].offsetLeft;
      if (inferredStep > 0) return inferredStep;
    }

    return cards[0].getBoundingClientRect().width || track.clientWidth;
  }, [getTrackCards]);

  const openReview = useCallback((index) => {
    setActiveIndex(index);
  }, []);

  const closeReview = useCallback(() => {
    setActiveIndex(null);
  }, []);

  const showPrevious = useCallback(() => {
    if (!testimonials.length) return;

    setActiveIndex((currentIndex) =>
      currentIndex === null
        ? null
        : (currentIndex - 1 + testimonials.length) % testimonials.length
    );
  }, [testimonials.length]);

  const showNext = useCallback(() => {
    if (!testimonials.length) return;

    setActiveIndex((currentIndex) =>
      currentIndex === null
        ? null
        : (currentIndex + 1) % testimonials.length
    );
  }, [testimonials.length]);

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
  }, [activeIndex, closeReview, showPrevious, showNext]);

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

  const scrollTrackByCard = useCallback((direction) => {
    const track = trackRef.current;
    if (!track) return;

    const cards = getTrackCards();
    if (!cards.length) return;

    const step = getScrollStep();
    if (step <= 0) return;

    const maxScrollLeft = Math.max(track.scrollWidth - track.clientWidth, 0);
    const maxIndex = Math.ceil(maxScrollLeft / step);
    const currentIndex = Math.round(track.scrollLeft / step);
    const nextIndex = Math.min(Math.max(currentIndex + direction, 0), maxIndex);
    const targetLeft = Math.min(nextIndex * step, maxScrollLeft);

    track.scrollTo({
      left: targetLeft,
      behavior: "smooth"
    });
  }, [getScrollStep, getTrackCards]);

  useEffect(() => {
    updateBeltState();
    window.addEventListener("resize", updateBeltState);

    return () => {
      window.removeEventListener("resize", updateBeltState);
    };
  }, [testimonials.length, updateBeltState]);

  return (
    <>
      <div className="voices__belt-shell" aria-label="Browse testimonials">
        <button
          className={`voices__belt-arrow voices__belt-arrow--side${beltState.canScrollPrev ? "" : " voices__belt-arrow--hidden"}`}
          type="button"
          onClick={() => scrollTrackByCard(-1)}
          aria-label="Scroll to previous testimonials"
          disabled={!beltState.canScrollPrev}
          aria-hidden={!beltState.canScrollPrev}
          tabIndex={beltState.canScrollPrev ? 0 : -1}
        >
          &lsaquo;
        </button>

        <div
          ref={trackRef}
          className="voices__belt"
          aria-label="Customer testimonials"
          onScroll={updateBeltState}
        >
          {testimonials.map((item, index) => {
            const review = splitReviewQuote(
              item.quote,
              item.previewSentenceCount
            );
            const isActive = activeIndex === index;

            return (
              <article
                key={item.name}
                className={`voices-card${isActive ? " voices-card--active" : ""}`}
                data-testimonial-card
              >
                <div className="voices-card__body">
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
                </div>
                <div className="voices-card__footer">
                  <p className="voices-card__meta">
                    <strong>{item.name}</strong>
                    <span>{item.meta}</span>
                  </p>
                  <button
                    className="voices-card__button"
                    type="button"
                    aria-haspopup="dialog"
                    aria-label={`Read full review from ${item.name}`}
                    onClick={() => openReview(index)}
                  >
                    Read more
                  </button>
                </div>
              </article>
            );
          })}
        </div>

        <button
          className={`voices__belt-arrow voices__belt-arrow--side${beltState.canScrollNext ? "" : " voices__belt-arrow--hidden"}`}
          type="button"
          onClick={() => scrollTrackByCard(1)}
          aria-label="Scroll to next testimonials"
          disabled={!beltState.canScrollNext}
          aria-hidden={!beltState.canScrollNext}
          tabIndex={beltState.canScrollNext ? 0 : -1}
        >
          &rsaquo;
        </button>
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
