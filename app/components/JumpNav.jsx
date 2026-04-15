"use client";

import { useEffect, useId, useRef, useState } from "react";
import SectionNavLink from "./SectionNavLink";

const navItems = [
  // Archived section:
  // { href: "#proof", label: "Proof" },
  { href: "#voices", label: "Reviews" },
  { href: "#wellness", label: "Why Ferments Matter" },
  { href: "#shop", label: "Shop" },
  { href: "#market", label: "Pickup" },
  { href: "#founder", label: "Our Story" },
  { href: "#faq", label: "FAQ" }
];

export default function JumpNav() {
  const navLinksId = useId();
  const navRef = useRef(null);
  const [isOpen, setIsOpen] = useState(false);

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

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const collapseMenu = () => {
    setIsOpen(false);
  };

  return (
    <nav
      className={`jump-nav${isOpen ? " is-open" : ""}`}
      aria-label="Page section navigation"
      ref={navRef}
    >
      <button
        type="button"
        className="jump-nav__toggle"
        aria-expanded={isOpen}
        aria-controls={navLinksId}
        onClick={() => setIsOpen((open) => !open)}
      >
        Menu
        <span className="jump-nav__toggle-icon" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </button>
      <button
        type="button"
        className="jump-nav__backdrop"
        aria-label="Close section navigation"
        onClick={collapseMenu}
      />
      <div className="jump-nav__links" id={navLinksId}>
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
