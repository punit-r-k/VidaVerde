"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { trackAnalyticsEvent } from "@/lib/analytics";

const AUTO_SCROLL_INTERVAL_MS = 7000;
const MOBILE_BREAKPOINT_QUERY = "(max-width: 900px)";
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
  const seenCardsRef = useRef(new Set());
  const [activeIndex, setActiveIndex] = useState(null);
  const [currentTrackIndex, setCurrentTrackIndex] = useState(0);
  const [paginationStops, setPaginationStops] = useState([0]);
  const [currentPaginationIndex, setCurrentPaginationIndex] = useState(0);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState(true);
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const [beltState, setBeltState] = useState({
    canScrollPrev: false,
    canScrollNext: false
  });
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

  const getPaginationScrollStops = useCallback(() => {
    const track = trackRef.current;
    const cards = getTrackCards();
    if (!track || !cards.length) return [0];

    const maxScrollLeft = Math.max(track.scrollWidth - track.clientWidth, 0);
    const stops = cards.map((card) => Math.min(card.offsetLeft, maxScrollLeft));
    const uniqueStops = [];

    stops.forEach((stop) => {
      const previousStop = uniqueStops[uniqueStops.length - 1];
      if (previousStop === undefined || Math.abs(previousStop - stop) > 2) {
        uniqueStops.push(stop);
      }
    });

    return uniqueStops.length ? uniqueStops : [0];
  }, [getTrackCards]);

  const getNearestPaginationIndex = useCallback(
    (scrollLeft) => {
      const track = trackRef.current;
      const stops = getPaginationScrollStops();
      if (!track || !stops.length) return 0;

      const targetScrollLeft =
        typeof scrollLeft === "number" ? scrollLeft : track.scrollLeft;
      let nearestIndex = 0;
      let nearestDistance = Number.POSITIVE_INFINITY;

      stops.forEach((stop, index) => {
        const distance = Math.abs(stop - targetScrollLeft);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearestIndex = index;
        }
      });

      return nearestIndex;
    },
    [getPaginationScrollStops]
  );

  const syncPaginationState = useCallback(
    (scrollLeft) => {
      const nextStops = getPaginationScrollStops();

      setPaginationStops((currentStops) => {
        if (
          currentStops.length === nextStops.length &&
          currentStops.every((stop, index) => Math.abs(stop - nextStops[index]) <= 2)
        ) {
          return currentStops;
        }

        return nextStops;
      });

      const nextPaginationIndex = getNearestPaginationIndex(scrollLeft);
      setCurrentPaginationIndex((currentIndex) =>
        currentIndex === nextPaginationIndex ? currentIndex : nextPaginationIndex
      );
    },
    [getNearestPaginationIndex, getPaginationScrollStops]
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

    syncPaginationState(track.scrollLeft);
  }, [getNearestTrackIndex, syncPaginationState]);

  const openReview = useCallback((index) => {
    setActiveIndex(index);
    trackAnalyticsEvent({
      name: "testimonial_open",
      sectionId: "voices",
      elementId: `testimonial_open_${index + 1}`,
      metadata: {
        currentIndex: index + 1
      }
    });
  }, []);

  const closeReview = useCallback(() => {
    setActiveIndex(null);
  }, []);

  const showPrevious = useCallback(() => {
    if (!testimonials.length) return;

    setActiveIndex((currentIndex) => {
      if (currentIndex === null) return null;

      const nextIndex = (currentIndex - 1 + testimonials.length) % testimonials.length;
      trackAnalyticsEvent({
        name: "testimonial_nav",
        sectionId: "voices",
        elementId: "testimonial_nav_prev",
        metadata: {
          direction: "prev",
          currentIndex: currentIndex + 1,
          targetIndex: nextIndex + 1
        }
      });
      return nextIndex;
    });
  }, [testimonials.length]);

  const showNext = useCallback(() => {
    if (!testimonials.length) return;

    setActiveIndex((currentIndex) => {
      if (currentIndex === null) return null;

      const nextIndex = (currentIndex + 1) % testimonials.length;
      trackAnalyticsEvent({
        name: "testimonial_nav",
        sectionId: "voices",
        elementId: "testimonial_nav_next",
        metadata: {
          direction: "next",
          currentIndex: currentIndex + 1,
          targetIndex: nextIndex + 1
        }
      });
      return nextIndex;
    });
  }, [testimonials.length]);

  useEffect(() => {
    if (activeIndex === null) return undefined;

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        closeReview();
      } else if (event.key === "ArrowLeft") {
        showPrevious();
      } else if (event.key === "ArrowRight") {
        showNext();
      }
    };

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
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
    (index, reason = "manual") => {
      const track = trackRef.current;
      const cards = getTrackCards();
      if (!track || !cards.length) return;

      const safeIndex = ((index % cards.length) + cards.length) % cards.length;
      const currentIndex = getNearestTrackIndex(track.scrollLeft);

      if (reason !== "auto" && safeIndex !== currentIndex) {
        trackAnalyticsEvent({
          name: "testimonial_carousel_scroll",
          sectionId: "voices",
          elementId: `testimonial_scroll_${reason}`,
          metadata: {
            source: reason,
            currentIndex: currentIndex + 1,
            targetIndex: safeIndex + 1,
            wasAutoScroll: false
          }
        });
      }

      track.scrollTo({
        left: cards[safeIndex].offsetLeft,
        behavior: "smooth"
      });
    },
    [getNearestTrackIndex, getTrackCards]
  );

  const scrollTrackToPaginationIndex = useCallback(
    (index, reason = "pagination") => {
      const track = trackRef.current;
      const stops = getPaginationScrollStops();
      if (!track || !stops.length) return;

      const safeIndex = ((index % stops.length) + stops.length) % stops.length;
      const currentIndex = getNearestPaginationIndex(track.scrollLeft);

      if (reason !== "auto" && safeIndex !== currentIndex) {
        trackAnalyticsEvent({
          name: "testimonial_carousel_scroll",
          sectionId: "voices",
          elementId: `testimonial_scroll_${reason}`,
          metadata: {
            source: reason,
            currentIndex: currentIndex + 1,
            targetIndex: safeIndex + 1,
            wasAutoScroll: false
          }
        });
      }

      track.scrollTo({
        left: stops[safeIndex],
        behavior: "smooth"
      });
    },
    [getNearestPaginationIndex, getPaginationScrollStops]
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

      scrollTrackToIndex(nextIndex, direction > 0 ? "arrow_next" : "arrow_prev");
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
      scrollTrackToIndex(currentTrackIndex + 1, "auto");
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

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.intersectionRatio < 0.55) return;

          const testimonialIndex = Number.parseInt(
            entry.target.getAttribute("data-analytics-testimonial-index") || "",
            10
          );

          if (!Number.isFinite(testimonialIndex) || seenCardsRef.current.has(testimonialIndex)) {
            return;
          }

          seenCardsRef.current.add(testimonialIndex);
          trackAnalyticsEvent({
            name: "testimonial_card_view",
            sectionId: "voices",
            elementId: `testimonial_card_${testimonialIndex + 1}`,
            metadata: {
              impressionIndex: testimonialIndex + 1
            }
          });
        });
      },
      {
        root: track,
        threshold: [0.55]
      }
    );

    const cards = Array.from(track.querySelectorAll("[data-testimonial-card]"));
    cards.forEach((card) => observer.observe(card));

    return () => {
      observer.disconnect();
    };
  }, [testimonials.length]);

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
                data-analytics-id={`testimonial_card_${index + 1}`}
                data-analytics-hover="true"
                data-analytics-testimonial-index={index}
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
                    data-analytics-id={`testimonial_open_${index + 1}`}
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
      {paginationStops.length > 1 ? (
        <div
          className="voices__pagination"
          aria-label="Review position"
          role="group"
        >
          {paginationStops.map((stop, index) => {
            const isCurrent = currentPaginationIndex === index;

            return (
              <button
                key={`dot-${stop}-${index}`}
                className={`voices__pagination-dot${isCurrent ? " voices__pagination-dot--active" : ""}`}
                type="button"
                onClick={() => scrollTrackToPaginationIndex(index, "pagination")}
                aria-label={`Show testimonial position ${index + 1} of ${paginationStops.length}`}
                aria-pressed={isCurrent}
                data-analytics-id={`testimonial_dot_${index + 1}`}
              />
            );
          })}
        </div>
      ) : null}
      {activeReview ? (
        <div
          className="voices-modal"
          role="dialog"
          aria-labelledby={`testimonial-title-${activeIndex}`}
        >
          <div className="voices-modal__panel">
            <div className="voices-modal__topbar">
              <div className="voices-modal__topbar-actions">
                <button
                  className="voices-modal__nav"
                  type="button"
                  onClick={showPrevious}
                  aria-label="Show previous review"
                  data-analytics-id="testimonial_nav_prev"
                >
                  Prev
                </button>
                <button
                  className="voices-modal__nav"
                  type="button"
                  onClick={showNext}
                  aria-label="Show next review"
                  data-analytics-id="testimonial_nav_next"
                >
                  Next
                </button>
                <button
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
