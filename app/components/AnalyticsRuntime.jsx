"use client";

import { useCallback, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ANALYTICS_BATCH_FLUSH_MS,
  ANALYTICS_CLIENT_EVENT,
  ANALYTICS_HOVER_INTENT_MS,
  ANALYTICS_IDLE_WINDOW_MS,
  ANALYTICS_MAX_BATCH_SIZE,
  ANALYTICS_MAX_PAYLOAD_BYTES,
  ANALYTICS_SCROLL_MILESTONES,
  ANALYTICS_SKIP_THRESHOLD_MS,
  sanitizeAnalyticsEvent,
  sanitizeAnalyticsIdentifier,
  sanitizeAnalyticsSearch
} from "@/lib/analytics";

const VISITOR_STORAGE_KEY = "vidaverde_analytics_visitor_v1";
const SESSION_STORAGE_KEY = "vidaverde_analytics_session_v1";
const SECTION_VIEW_THRESHOLD = 0.2;
const PRODUCT_VIEW_THRESHOLD = 0.45;

const createAnalyticsId = (prefix) =>
  `${prefix}_${window.crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

const getViewportBucket = () => {
  const width = window.innerWidth || 0;
  if (width < 640) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
};

const getPageType = (pagePath) => {
  if (pagePath === "/about") return "about";
  if (pagePath === "/") return "home";
  return "other";
};

const getScrollPercent = () => {
  const documentElement = document.documentElement;
  const scrollHeight = Math.max(
    documentElement.scrollHeight - window.innerHeight,
    0
  );

  if (scrollHeight <= 0) return 100;

  const progress = (window.scrollY / scrollHeight) * 100;
  return Math.max(0, Math.min(100, Math.round(progress)));
};

const getExternalReferrerDescriptor = () => {
  const referrer = document.referrer;
  if (!referrer) return "";

  try {
    const url = new URL(referrer);
    if (url.origin === window.location.origin) {
      return url.pathname.slice(0, 240);
    }

    return `external:${url.hostname}`.slice(0, 240);
  } catch {
    return "";
  }
};

const prefersFinePointer = () =>
  typeof window.matchMedia === "function" &&
  window.matchMedia("(hover: hover) and (pointer: fine)").matches;

const getOrCreateStorageId = (storage, key, prefix) => {
  const existing = sanitizeAnalyticsIdentifier(storage.getItem(key), 80);
  if (existing) return existing;

  const created = createAnalyticsId(prefix);
  storage.setItem(key, created);
  return created;
};

const roundRatio = (value) => Number(value.toFixed(3));

export default function AnalyticsRuntime() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageStateRef = useRef(null);
  const queueRef = useRef([]);
  const flushTimerRef = useRef(null);
  const scrollFrameRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const hoverSeenRef = useRef(new Set());
  const productSeenRef = useRef(new Set());
  const sectionObserverRef = useRef(null);
  const productObserverRef = useRef(null);
  const pageSignatureRef = useRef("");
  const searchString = searchParams?.toString() || "";

  const clearFlushTimer = useCallback(() => {
    if (!flushTimerRef.current) return;
    window.clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
  }, []);

  const postPayload = useCallback((payloadText, preferBeacon = false) => {
    if (preferBeacon && navigator.sendBeacon) {
      const sent = navigator.sendBeacon(
        "/api/analytics",
        new Blob([payloadText], { type: "application/json" })
      );
      if (sent) return;
    }

    try {
      void fetch("/api/analytics", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: "same-origin",
        keepalive: preferBeacon,
        body: payloadText
      });
    } catch {
      // Analytics should never interrupt the storefront.
    }
  }, []);

  const flushNow = useCallback(
    (preferBeacon = false) => {
      clearFlushTimer();

      while (queueRef.current.length > 0) {
        const batch = queueRef.current.splice(0, ANALYTICS_MAX_BATCH_SIZE);
        const payloadText = JSON.stringify({ events: batch });

        if (payloadText.length > ANALYTICS_MAX_PAYLOAD_BYTES) {
          const half = Math.max(1, Math.floor(batch.length / 2));
          queueRef.current.unshift(...batch.slice(half));
          const safeBatch = batch.slice(0, half);
          if (safeBatch.length === 0) break;
          postPayload(JSON.stringify({ events: safeBatch }), preferBeacon);
          continue;
        }

        postPayload(payloadText, preferBeacon);
      }
    },
    [clearFlushTimer, postPayload]
  );

  const scheduleFlush = useCallback(() => {
    if (flushTimerRef.current) return;

    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = null;
      flushNow(false);
    }, ANALYTICS_BATCH_FLUSH_MS);
  }, [flushNow]);

  const ensurePageState = useCallback(() => {
    if (pageStateRef.current) return pageStateRef.current;

    const visitorId = getOrCreateStorageId(
      window.localStorage,
      VISITOR_STORAGE_KEY,
      "v"
    );
    const sessionId = getOrCreateStorageId(
      window.sessionStorage,
      SESSION_STORAGE_KEY,
      "s"
    );

    pageStateRef.current = {
      visitorId,
      sessionId,
      pageViewId: "",
      pagePath: "",
      pageSearch: "",
      referrerPath: "",
      pageStartedAt: Date.now(),
      lastActivityAt: Date.now(),
      idleMs: 0,
      maxScrollPct: 0,
      lastClickedAt: 0,
      lastClickedElementId: "",
      lastClickedSectionId: "",
      deepestSectionId: "",
      viewedSectionCount: 0,
      sectionMetrics: new Map(),
      scrollMilestones: new Set(),
      finalized: false
    };

    return pageStateRef.current;
  }, []);

  const enqueueEvent = useCallback(
    (draft) => {
      const state = ensurePageState();
      if (!state.pageViewId || state.finalized) return false;

      const sanitizedEvent = sanitizeAnalyticsEvent({
        visitorId: state.visitorId,
        sessionId: state.sessionId,
        pageViewId: state.pageViewId,
        pagePath: state.pagePath,
        pageSearch: state.pageSearch,
        referrerPath: state.referrerPath,
        occurredAt: new Date().toISOString(),
        ...draft
      });

      if (!sanitizedEvent) return false;

      queueRef.current.push(sanitizedEvent);

      if (queueRef.current.length >= ANALYTICS_MAX_BATCH_SIZE) {
        flushNow(false);
        return true;
      }

      scheduleFlush();
      return true;
    },
    [ensurePageState, flushNow, scheduleFlush]
  );

  const markActivity = useCallback(() => {
    const state = ensurePageState();
    const now = Date.now();

    if (now - state.lastActivityAt > ANALYTICS_IDLE_WINDOW_MS) {
      state.idleMs += now - state.lastActivityAt - ANALYTICS_IDLE_WINDOW_MS;
    }

    state.lastActivityAt = now;
  }, [ensurePageState]);

  const disconnectObservers = useCallback(() => {
    if (sectionObserverRef.current) {
      sectionObserverRef.current.disconnect();
      sectionObserverRef.current = null;
    }

    if (productObserverRef.current) {
      productObserverRef.current.disconnect();
      productObserverRef.current = null;
    }
  }, []);

  const finalizeCurrentPage = useCallback(
    (preferBeacon = true) => {
      const state = ensurePageState();
      if (!state.pageViewId || state.finalized) {
        flushNow(preferBeacon);
        return;
      }
      const now = Date.now();

      if (now - state.lastActivityAt > ANALYTICS_IDLE_WINDOW_MS) {
        state.idleMs += now - state.lastActivityAt - ANALYTICS_IDLE_WINDOW_MS;
      }

      state.sectionMetrics.forEach((metric, sectionId) => {
        if (metric.visibleSince) {
          metric.totalVisibleMs += now - metric.visibleSince;
          metric.visibleSince = 0;
        }

        if (!metric.viewed) return;

        const eventName =
          metric.clickCount === 0 &&
          metric.totalVisibleMs < ANALYTICS_SKIP_THRESHOLD_MS
            ? "section_skip"
            : "section_engagement";

        enqueueEvent({
          name: eventName,
          sectionId,
          metadata: {
            viewport: getViewportBucket(),
            dwellMs: Math.round(metric.totalVisibleMs),
            maxVisibilityRatio: roundRatio(metric.maxVisibilityRatio),
            clickCount: metric.clickCount
          }
        });
      });

      const totalMs = Math.max(now - state.pageStartedAt, 0);
      const idleMs = Math.min(Math.max(Math.round(state.idleMs), 0), totalMs);
      const engagedMs = Math.max(totalMs - idleMs, 0);

      enqueueEvent({
        name: "page_engagement",
        metadata: {
          engagedMs,
          idleMs,
          maxScrollPct: state.maxScrollPct,
          deepestSectionId: state.deepestSectionId || undefined,
          lastClickedSectionId: state.lastClickedSectionId || undefined,
          lastClickedElementId: state.lastClickedElementId || undefined,
          timeSinceLastClickMs: state.lastClickedAt
            ? Math.max(now - state.lastClickedAt, 0)
            : totalMs,
          viewedSectionCount: state.viewedSectionCount,
          viewport: getViewportBucket(),
          pageType: getPageType(state.pagePath)
        }
      });

      state.finalized = true;
      flushNow(preferBeacon);
    },
    [ensurePageState, enqueueEvent, flushNow]
  );

  const setupObservers = useCallback(() => {
    disconnectObservers();

    const state = ensurePageState();
    state.sectionMetrics = new Map();
    state.deepestSectionId = "";
    state.viewedSectionCount = 0;
    productSeenRef.current = new Set();

    const sectionNodes = Array.from(
      document.querySelectorAll("[data-analytics-section]")
    );

    sectionNodes.forEach((node, index) => {
      const sectionId = sanitizeAnalyticsIdentifier(
        node.getAttribute("data-analytics-section"),
        80
      );
      if (!sectionId) return;

      state.sectionMetrics.set(sectionId, {
        orderIndex: index,
        viewed: false,
        visibleSince: 0,
        totalVisibleMs: 0,
        maxVisibilityRatio: 0,
        clickCount: 0
      });
    });

    sectionObserverRef.current = new IntersectionObserver(
      (entries) => {
        const now = Date.now();

        entries.forEach((entry) => {
          const sectionId = sanitizeAnalyticsIdentifier(
            entry.target.getAttribute("data-analytics-section"),
            80
          );
          const metric = state.sectionMetrics.get(sectionId);
          if (!metric) return;

          metric.maxVisibilityRatio = Math.max(
            metric.maxVisibilityRatio,
            entry.intersectionRatio
          );

          if (entry.intersectionRatio >= SECTION_VIEW_THRESHOLD) {
            if (!metric.viewed) {
              metric.viewed = true;
              state.viewedSectionCount += 1;

              if (
                !state.deepestSectionId ||
                metric.orderIndex >
                  (state.sectionMetrics.get(state.deepestSectionId)?.orderIndex ?? -1)
              ) {
                state.deepestSectionId = sectionId;
              }

              enqueueEvent({
                name: "section_view",
                sectionId,
                metadata: {
                  viewport: getViewportBucket(),
                  maxVisibilityRatio: roundRatio(entry.intersectionRatio)
                }
              });
            }

            if (!metric.visibleSince) {
              metric.visibleSince = now;
            }
          } else if (metric.visibleSince) {
            metric.totalVisibleMs += now - metric.visibleSince;
            metric.visibleSince = 0;
          }
        });
      },
      {
        threshold: [0, SECTION_VIEW_THRESHOLD, 0.5, 0.8]
      }
    );

    sectionNodes.forEach((node) => {
      sectionObserverRef.current?.observe(node);
    });

    const productNodes = Array.from(
      document.querySelectorAll("[data-analytics-product-sku]")
    );

    productObserverRef.current = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.intersectionRatio < PRODUCT_VIEW_THRESHOLD) return;

          const productSku = sanitizeAnalyticsIdentifier(
            entry.target.getAttribute("data-analytics-product-sku"),
            32
          ).toUpperCase();
          if (!productSku || productSeenRef.current.has(productSku)) return;

          productSeenRef.current.add(productSku);

          enqueueEvent({
            name: "product_card_view",
            productSku,
            sectionId: "shop",
            elementId: sanitizeAnalyticsIdentifier(
              entry.target.getAttribute("data-analytics-id"),
              80
            ),
            metadata: {
              viewport: getViewportBucket()
            }
          });
        });
      },
      {
        threshold: [0, PRODUCT_VIEW_THRESHOLD, 0.85]
      }
    );

    productNodes.forEach((node) => {
      productObserverRef.current?.observe(node);
    });
  }, [disconnectObservers, enqueueEvent, ensurePageState]);

  useEffect(() => {
    ensurePageState();

    const handleTrackedEvent = (browserEvent) => {
      const detail = browserEvent?.detail;
      if (!detail || typeof detail !== "object") return;
      enqueueEvent(detail);
    };

    const handleClick = (browserEvent) => {
      markActivity();
      const target = browserEvent.target;
      if (!(target instanceof Element)) return;

      const analyticsNode = target.closest("[data-analytics-id]");
      if (!analyticsNode) return;

      const sectionNode = target.closest("[data-analytics-section]");
      const sectionId = sanitizeAnalyticsIdentifier(
        sectionNode?.getAttribute("data-analytics-section"),
        80
      );
      const elementId = sanitizeAnalyticsIdentifier(
        analyticsNode.getAttribute("data-analytics-id"),
        80
      );
      const analyticsType = analyticsNode.getAttribute("data-analytics-type");
      const state = ensurePageState();

      state.lastClickedAt = Date.now();
      state.lastClickedElementId = elementId;
      state.lastClickedSectionId = sectionId;

      if (sectionId && state.sectionMetrics.has(sectionId)) {
        state.sectionMetrics.get(sectionId).clickCount += 1;
      }

      if (analyticsType === "cta" || analyticsType === "nav") {
        enqueueEvent({
          name: analyticsType === "cta" ? "cta_click" : "nav_click",
          sectionId,
          elementId,
          productSku: analyticsNode.getAttribute("data-analytics-product-sku"),
          metadata: {
            viewport: getViewportBucket()
          }
        });
      }
    };

    const handleToggle = (browserEvent) => {
      const target = browserEvent.target;
      if (!(target instanceof HTMLDetailsElement)) return;

      const elementId = sanitizeAnalyticsIdentifier(
        target.getAttribute("data-analytics-id"),
        80
      );
      if (!elementId) return;

      const analyticsType = target.getAttribute("data-analytics-type");
      const sectionId = sanitizeAnalyticsIdentifier(
        target.closest("[data-analytics-section]")?.getAttribute("data-analytics-section"),
        80
      );

      if (analyticsType === "faq") {
        enqueueEvent({
          name: "faq_toggle",
          sectionId,
          elementId,
          metadata: {
            open: target.open
          }
        });
      }

      if (analyticsType === "checkout-review") {
        enqueueEvent({
          name: "checkout_review_toggle",
          sectionId: sectionId || "shop",
          elementId,
          metadata: {
            open: target.open
          }
        });
      }
    };

    const handlePointerOver = (browserEvent) => {
      if (!prefersFinePointer()) return;
      const target = browserEvent.target;
      if (!(target instanceof Element)) return;

      const hoverNode = target.closest(
        '[data-analytics-hover="true"][data-analytics-id]'
      );
      if (!hoverNode) return;

      const elementId = sanitizeAnalyticsIdentifier(
        hoverNode.getAttribute("data-analytics-id"),
        80
      );
      if (!elementId || hoverSeenRef.current.has(elementId)) return;

      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = window.setTimeout(() => {
        hoverSeenRef.current.add(elementId);
        enqueueEvent({
          name: "hover_intent",
          sectionId: sanitizeAnalyticsIdentifier(
            hoverNode.closest("[data-analytics-section]")?.getAttribute(
              "data-analytics-section"
            ),
            80
          ),
          elementId,
          productSku:
            hoverNode.getAttribute("data-analytics-product-sku") ||
            hoverNode.closest("[data-analytics-product-sku]")?.getAttribute(
              "data-analytics-product-sku"
            ),
          metadata: {
            hoverMs: ANALYTICS_HOVER_INTENT_MS,
            viewport: getViewportBucket()
          }
        });
      }, ANALYTICS_HOVER_INTENT_MS);
    };

    const clearHoverTimer = () => {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    };

    const handleScroll = () => {
      markActivity();
      if (scrollFrameRef.current) return;

      scrollFrameRef.current = window.requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        const state = ensurePageState();
        const currentScrollPct = getScrollPercent();
        state.maxScrollPct = Math.max(state.maxScrollPct, currentScrollPct);

        ANALYTICS_SCROLL_MILESTONES.forEach((milestone) => {
          if (currentScrollPct < milestone) return;
          if (state.scrollMilestones?.has(milestone)) return;

          if (!state.scrollMilestones) {
            state.scrollMilestones = new Set();
          }

          state.scrollMilestones.add(milestone);
          enqueueEvent({
            name: "scroll_depth_reached",
            metadata: {
              scrollPct: milestone,
              viewport: getViewportBucket()
            }
          });
        });
      });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        finalizeCurrentPage(true);
        return;
      }

      markActivity();
    };

    const handlePageHide = () => {
      finalizeCurrentPage(true);
    };

    const handleInputActivity = () => {
      markActivity();
    };

    window.addEventListener(ANALYTICS_CLIENT_EVENT, handleTrackedEvent);
    document.addEventListener("click", handleClick, true);
    document.addEventListener("toggle", handleToggle, true);
    document.addEventListener("pointerover", handlePointerOver, true);
    document.addEventListener("pointerout", clearHoverTimer, true);
    document.addEventListener("pointerdown", clearHoverTimer, true);
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pointerdown", handleInputActivity, true);
    window.addEventListener("keydown", handleInputActivity, true);
    window.addEventListener("touchstart", handleInputActivity, {
      passive: true
    });
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener(ANALYTICS_CLIENT_EVENT, handleTrackedEvent);
      document.removeEventListener("click", handleClick, true);
      document.removeEventListener("toggle", handleToggle, true);
      document.removeEventListener("pointerover", handlePointerOver, true);
      document.removeEventListener("pointerout", clearHoverTimer, true);
      document.removeEventListener("pointerdown", clearHoverTimer, true);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pointerdown", handleInputActivity, true);
      window.removeEventListener("keydown", handleInputActivity, true);
      window.removeEventListener("touchstart", handleInputActivity);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("pagehide", handlePageHide);
      disconnectObservers();
      clearHoverTimer();

      if (scrollFrameRef.current) {
        window.cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }

      finalizeCurrentPage(true);
    };
  }, [
    disconnectObservers,
    enqueueEvent,
    ensurePageState,
    finalizeCurrentPage,
    markActivity
  ]);

  useEffect(() => {
    const nextPath = pathname || window.location.pathname || "/";
    const nextSearch = sanitizeAnalyticsSearch(searchString ? `?${searchString}` : "");
    const nextSignature = `${nextPath}${nextSearch}`;

    if (pageSignatureRef.current === nextSignature) return;

    const state = ensurePageState();
    const previousPath = state.pagePath;
    const previousSearch = state.pageSearch;

    if (state.pageViewId) {
      finalizeCurrentPage(true);
    }

    pageSignatureRef.current = nextSignature;
    hoverSeenRef.current = new Set();
    state.pageViewId = createAnalyticsId("pv");
    state.pagePath = nextPath;
    state.pageSearch = nextSearch;
    state.referrerPath =
      previousPath
        ? `${previousPath}${previousSearch || ""}`.slice(0, 240)
        : getExternalReferrerDescriptor();
    state.pageStartedAt = Date.now();
    state.lastActivityAt = state.pageStartedAt;
    state.idleMs = 0;
    state.maxScrollPct = getScrollPercent();
    state.lastClickedAt = 0;
    state.lastClickedElementId = "";
    state.lastClickedSectionId = "";
    state.deepestSectionId = "";
    state.viewedSectionCount = 0;
    state.sectionMetrics = new Map();
    state.scrollMilestones = new Set();
    state.finalized = false;

    enqueueEvent({
      name: "page_view",
      metadata: {
        viewport: getViewportBucket(),
        pageType: getPageType(nextPath)
      }
    });

    const frameId = window.requestAnimationFrame(() => {
      setupObservers();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [
    enqueueEvent,
    ensurePageState,
    finalizeCurrentPage,
    pathname,
    searchString,
    setupObservers
  ]);

  return null;
}
