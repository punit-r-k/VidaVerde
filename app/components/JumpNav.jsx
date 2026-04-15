"use client";

import { useEffect, useRef } from "react";
import SectionNavLink from "./SectionNavLink";

const navItems = [
  // Archived section:
  // { href: "#proof", label: "Proof" },
  { href: "#voices", label: "Reviews" },
  { href: "#founder", label: "Our Story" },
  { href: "#wellness", label: "Why Live Fermented Foods Matter" },
  { href: "#shop", label: "Shop" },
  { href: "#faq", label: "FAQ" }
];

export default function JumpNav() {
  const navToggleId = "jump-nav-toggle";
  const navRef = useRef(null);
  const navCheckboxRef = useRef(null);

  useEffect(() => {
    const nav = navRef.current;
    if (!(nav instanceof HTMLElement)) {
      return undefined;
    }

    const root = document.documentElement;
    const syncOffset = () => {
      root.style.setProperty(
        "--section-nav-offset",
        `${Math.ceil(nav.getBoundingClientRect().height)}px`
      );
    };

    syncOffset();
    window.addEventListener("resize", syncOffset);

    if (typeof ResizeObserver !== "function") {
      return () => {
        window.removeEventListener("resize", syncOffset);
        root.style.removeProperty("--section-nav-offset");
      };
    }

    const resizeObserver = new ResizeObserver(() => {
      syncOffset();
    });
    resizeObserver.observe(nav);

    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", syncOffset);
      root.style.removeProperty("--section-nav-offset");
    };
  }, []);

  const collapseMenu = () => {
    if (navCheckboxRef.current) {
      navCheckboxRef.current.checked = false;
    }
  };

  return (
    <nav className="jump-nav" aria-label="Page section navigation" ref={navRef}>
      <input
        type="checkbox"
        id={navToggleId}
        className="jump-nav__checkbox"
        ref={navCheckboxRef}
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
      <label
        htmlFor={navToggleId}
        className="jump-nav__backdrop"
        aria-hidden="true"
      />
      <div className="jump-nav__links">
        {navItems.map((item) => (
          <SectionNavLink
            key={item.href}
            href={item.href}
            beforeScroll={collapseMenu}
            data-analytics-id={`jump_nav_${item.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`}
            data-analytics-type="nav"
          >
            {item.label}
          </SectionNavLink>
        ))}
      </div>
    </nav>
  );
}
