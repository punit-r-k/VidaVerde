"use client";

import { useEffect, useRef, useState } from "react";

const navItems = [
  // Archived section:
  // { href: "#proof", label: "Proof" },
  { href: "#voices", label: "Reviews" },
  { href: "#founder", label: "Story" },
  { href: "#wellness", label: "Why Live Fermented Foods Matter" },
  { href: "#shop", label: "Shop" },
  { href: "#faq", label: "FAQ" }
];

export default function JumpNav() {
  const navToggleId = "jump-nav-toggle";
  const navRef = useRef(null);
  const sentinelRef = useRef(null);
  const [isPinned, setIsPinned] = useState(false);
  const [navHeight, setNavHeight] = useState(0);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return undefined;

    const updateHeight = () => {
      setNavHeight(nav.offsetHeight);
    };

    updateHeight();

    if (typeof ResizeObserver === "function") {
      const observer = new ResizeObserver(() => {
        updateHeight();
      });
      observer.observe(nav);

      return () => {
        observer.disconnect();
      };
    }

    window.addEventListener("resize", updateHeight);
    return () => {
      window.removeEventListener("resize", updateHeight);
    };
  }, []);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return undefined;

    const mediaQuery = window.matchMedia("(max-width: 640px)");
    let observer;

    const syncObserver = () => {
      observer?.disconnect();

      if (!mediaQuery.matches) {
        setIsPinned(false);
        return;
      }

      observer = new IntersectionObserver(
        ([entry]) => {
          setIsPinned(!entry.isIntersecting);
        },
        {
          threshold: 0
        }
      );

      observer.observe(sentinel);
    };

    syncObserver();

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", syncObserver);
    } else {
      mediaQuery.addListener(syncObserver);
    }

    return () => {
      observer?.disconnect();

      if (typeof mediaQuery.removeEventListener === "function") {
        mediaQuery.removeEventListener("change", syncObserver);
      } else {
        mediaQuery.removeListener(syncObserver);
      }
    };
  }, []);

  return (
    <div
      className="jump-nav-shell"
      style={navHeight ? { minHeight: `${navHeight}px` } : undefined}
    >
      <div ref={sentinelRef} className="jump-nav__sentinel" aria-hidden="true" />
      <nav
        ref={navRef}
        className={`jump-nav jump-nav--mobile-managed${isPinned ? " jump-nav--pinned" : ""}`}
        aria-label="Page section navigation"
      >
        <input
          type="checkbox"
          id={navToggleId}
          className="jump-nav__checkbox"
        />
        <label
          htmlFor={navToggleId}
          className="jump-nav__toggle"
        >
          Menu
          <span className="jump-nav__toggle-icon" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </span>
        </label>
        <div className="jump-nav__links">
          {navItems.map((item) => (
            <a key={item.href} href={item.href}>
              {item.label}
            </a>
          ))}
        </div>
      </nav>
    </div>
  );
}
