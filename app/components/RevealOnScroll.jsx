"use client";

import { useEffect, useRef, useState } from "react";

const VIEWPORT_MARGIN = "0px 0px -10% 0px";
const DEFAULT_VIEWPORT_AMOUNT = 0.18;
const DEFAULT_PRESET = "rise";

const REVEAL_PRESETS = {
  rise: {
    x: "0px",
    y: "24px",
    scale: 1
  },
  driftLeft: {
    x: "28px",
    y: "0px",
    scale: 1
  },
  driftRight: {
    x: "-28px",
    y: "0px",
    scale: 1
  },
  fade: {
    x: "0px",
    y: "0px",
    scale: 1
  },
  softScale: {
    x: "0px",
    y: "18px",
    scale: 0.97
  },
  tiltLift: {
    x: "0px",
    y: "26px",
    scale: 0.985
  }
};

export default function RevealOnScroll({
  children,
  className = "",
  delay = 0,
  amount = DEFAULT_VIEWPORT_AMOUNT,
  duration = 0.48,
  preset = DEFAULT_PRESET
}) {
  const rootRef = useRef(null);
  const [isVisible, setIsVisible] = useState(false);
  const motionPreset = REVEAL_PRESETS[preset] || REVEAL_PRESETS[DEFAULT_PRESET];

  useEffect(() => {
    const node = rootRef.current;
    if (!(node instanceof HTMLElement)) return undefined;

    const prefersReducedMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion || typeof IntersectionObserver !== "function") {
      const frameId = window.requestAnimationFrame(() => {
        setIsVisible(true);
      });

      return () => {
        window.cancelAnimationFrame(frameId);
      };
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const isIntersecting = entries.some(
          (entry) => entry.isIntersecting || entry.intersectionRatio >= amount
        );

        if (!isIntersecting) return;
        setIsVisible(true);
        observer.disconnect();
      },
      {
        threshold: [0, amount],
        rootMargin: VIEWPORT_MARGIN
      }
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [amount]);

  return (
    <div
      ref={rootRef}
      className={[
        "js-reveal",
        "is-ready",
        isVisible ? "is-visible" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      style={{
        "--reveal-delay": `${delay}s`,
        "--reveal-duration": `${duration}s`,
        "--reveal-x": motionPreset.x,
        "--reveal-y": motionPreset.y,
        "--reveal-scale": motionPreset.scale
      }}
    >
      {children}
    </div>
  );
}
