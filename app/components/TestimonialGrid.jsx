"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const AUTO_SCROLL_INTERVAL_MS = 7000;
const MOBILE_BREAKPOINT_QUERY = "(max-width: 720px)";
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
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [beltState, setBeltState] = useState({
    canScrollPrev: false,
    canScrollNext: false
  });
  const closeButtonRef = useRef(null);
  const modalReviewRef = useRef(null);
  const modalTouchStateRef = useRef(null);
  const trackTouchStateRef = useRef(null);
  const activeReview =
    activeIndex === null ? null : testimonials[activeIndex] || null;

  const getTrackCards = useCallback(() => {
    const track = trackRef.current;
    if (!track) return [];
    return Array.from(track.querySelectorAll("[data-testimonial-card]"));
  }, []);

  const getNearestTrackIndex = useCallback(
    (scrollLeft) => {
      const track = trackRef.current;
      const cards = getTrackCards();
      if (!track || !cards.length) return 0;

      const targetScrollLeft =
        typeof scrollLeft === "number" ? scrollLeft : track.scrollLeft;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      cards.forEach((card, index) => {
        const distance = Math.abs(card.offsetLeft - targetScrollLeft);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      return nearestIndex;
    },
    [getTrackCards]
  );

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

    const nextTrackIndex = getNearestTrackIndex(track.scrollLeft);
    setCurrentTrackIndex((currentIndex) =>
      currentIndex === nextTrackIndex ? currentIndex : nextTrackIndex
    );
  }, [getNearestTrackIndex]);

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

    const scrollY = window.scrollY;
    const previousHtmlOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    const previousBodyPosition = document.body.style.position;
    const previousBodyTop = document.body.style.top;
    const previousBodyWidth = document.body.style.width;
    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeReview();
      } else if (event.key === "ArrowLeft") {
        showPrevious();
      } else if (event.key === "ArrowRight") {
        showNext();
      }
    };

    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = "100%";
    if (closeButtonRef.current) {
      try {
        closeButtonRef.current.focus({ preventScroll: true });
      } catch {
        closeButtonRef.current.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.documentElement.style.overflow = previousHtmlOverflow;
      document.body.style.overflow = previousBodyOverflow;
      document.body.style.position = previousBodyPosition;
      document.body.style.top = previousBodyTop;
      document.body.style.width = previousBodyWidth;
      window.removeEventListener("keydown", handleKeyDown);
      window.scrollTo(0, scrollY);
    };
  }, [activeIndex, closeReview, showPrevious, showNext]);

  useEffect(() => {
    if (activeIndex === null) return;
    if (modalReviewRef.current) {
      modalReviewRef.current.scrollTop = 0;
    }
  }, [activeIndex]);

  const handleModalTouchStart = (event) => {
    const touch = event.touches[0];
    if (!touch) return;

    modalTouchStateRef.current = {
      x: touch.clientX,
      y: touch.clientY
    };
  };

  const handleModalTouchEnd = (event) => {
    const modalTouchState = modalTouchStateRef.current;
    if (!modalTouchState) return;

    const touchEnd = event.changedTouches[0];
    const deltaX = (touchEnd?.clientX ?? modalTouchState.x) - modalTouchState.x;
    const deltaY = (touchEnd?.clientY ?? modalTouchState.y) - modalTouchState.y;
    modalTouchStateRef.current = null;

    if (
      Math.abs(deltaX) < SWIPE_THRESHOLD ||
      Math.abs(deltaX) <= Math.abs(deltaY)
    ) {
      return;
    }

    if (deltaX > 0) {
      showPrevious();
    } else {
      showNext();
    }
  };

  const clearModalTouchState = useCallback(() => {
    modalTouchStateRef.current = null;
  }, []);

  const scrollTrackToIndex = useCallback(
    (index) => {
      const track = trackRef.current;
      const cards = getTrackCards();
      if (!track || !cards.length) return;

      const safeIndex = ((index % cards.length) + cards.length) % cards.length;
      track.scrollTo({
        left: cards[safeIndex].offsetLeft,
        behavior: "smooth"
      });
    },
    [getTrackCards]
  );

  const scrollTrackByCard = useCallback(
    (direction) => {
      const track = trackRef.current;
      const cards = getTrackCards();
      if (!track || !cards.length) return;

      const currentIndex = getNearestTrackIndex(track.scrollLeft);
      const nextIndex = Math.min(
        Math.max(currentIndex + direction, 0),
        cards.length - 1
      );

      scrollTrackToIndex(nextIndex);
    },
    [getNearestTrackIndex, getTrackCards, scrollTrackToIndex]
  );

  const handleTrackTouchStart = useCallback((event) => {
    const touch = event.touches[0];
    if (!touch) return;

    trackTouchStateRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      scrollLeft: trackRef.current?.scrollLeft ?? 0
    };
  }, []);

  const handleTrackTouchMove = useCallback(
    (event) => {
      if (!isMobileViewport || !isAutoScrollEnabled) return;

      const touch = event.touches[0];
      const trackTouchState = trackTouchStateRef.current;
      if (!touch || !trackTouchState) return;

      const deltaX = Math.abs(touch.clientX - trackTouchState.x);
      const deltaY = Math.abs(touch.clientY - trackTouchState.y);
      const scrollDelta = Math.abs(
        (trackRef.current?.scrollLeft ?? 0) - trackTouchState.scrollLeft
      );

      if (deltaX > deltaY && (deltaX > 10 || scrollDelta > 10)) {
        setIsAutoScrollEnabled(false);
      }
    },
    [isAutoScrollEnabled, isMobileViewport]
  );

  const clearTrackTouchState = useCallback(() => {
    trackTouchStateRef.current = null;
  }, []);

  useEffect(() => {
    const mediaQuery = window.matchMedia(MOBILE_BREAKPOINT_QUERY);
    const updateViewport = (event) => {
      const matches = typeof event?.matches === "boolean" ? event.matches : mediaQuery.matches;
      setIsMobileViewport(matches);

      if (!matches) {
        setIsAutoScrollEnabled(true);
      }
    };

    updateViewport();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", updateViewport);
      return () => {
        mediaQuery.removeEventListener("change", updateViewport);
      };
    }

    mediaQuery.addListener(updateViewport);
    return () => {
      mediaQuery.removeListener(updateViewport);
    };
  }, []);

  useEffect(() => {
    if (
      !isMobileViewport ||
      !isAutoScrollEnabled ||
      activeIndex !== null ||
      testimonials.length < 2
    ) {
      return undefined;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      scrollTrackToIndex(currentTrackIndex + 1);
    }, AUTO_SCROLL_INTERVAL_MS);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [
    activeIndex,
    currentTrackIndex,
    isAutoScrollEnabled,
    isMobileViewport,
    scrollTrackToIndex,
    testimonials.length
  ]);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    updateBeltState();
    window.addEventListener("resize", updateBeltState);

    return () => {
      window.removeEventListener("resize", updateBeltState);
    };
  }, [testimonials.length, updateBeltState]);

  useEffect(() => {
    if (!isMobileViewport) return;
    updateBeltState();
  }, [isMobileViewport, testimonials.length, updateBeltState]);

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
          onTouchStart={handleTrackTouchStart}
          onTouchMove={handleTrackTouchMove}
          onTouchEnd={clearTrackTouchState}
          onTouchCancel={clearTrackTouchState}
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

              <div
                ref={modalReviewRef}
                className="voices-modal__review"
                onTouchStart={handleModalTouchStart}
                onTouchEnd={handleModalTouchEnd}
                onTouchCancel={clearModalTouchState}
              >
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
