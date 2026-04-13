"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const isModifiedEvent = (event) =>
  event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;

const getHashFromHref = (href) => {
  const normalizedHref = String(href || "").trim();
  if (normalizedHref.startsWith("/#")) {
    return normalizedHref.slice(2);
  }
  if (normalizedHref.startsWith("#")) {
    return normalizedHref.slice(1);
  }
  return "";
};

const isSamePageSectionHref = (href, pathname) => {
  const normalizedHref = String(href || "").trim();
  if (normalizedHref.startsWith("#")) {
    return true;
  }
  return normalizedHref.startsWith("/#") && pathname === "/";
};

const scrollToSection = (sectionId) => {
  const target = document.getElementById(sectionId);
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const jumpNav = document.querySelector(".jump-nav");
  const navOffset =
    jumpNav instanceof HTMLElement
      ? Math.ceil(jumpNav.getBoundingClientRect().height)
      : 0;
  const nextTop = Math.max(
    window.scrollY + target.getBoundingClientRect().top - navOffset,
    0
  );
  const behavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ? "auto"
    : "smooth";
  const nextUrl = `${window.location.pathname}${window.location.search}#${sectionId}`;

  if (window.location.hash !== `#${sectionId}`) {
    window.history.pushState(null, "", nextUrl);
  }

  window.scrollTo({
    top: nextTop,
    behavior
  });

  return true;
};

export default function SectionNavLink({
  href,
  children,
  beforeScroll,
  onClick,
  ...props
}) {
  const pathname = usePathname();

  const handleClick = (event) => {
    onClick?.(event);
    if (event.defaultPrevented || isModifiedEvent(event)) {
      return;
    }

    if (!isSamePageSectionHref(href, pathname)) {
      return;
    }

    const sectionId = getHashFromHref(href);
    if (!sectionId) {
      return;
    }

    event.preventDefault();
    beforeScroll?.();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (!scrollToSection(sectionId)) {
          window.location.hash = sectionId;
        }
      });
    });
  };

  return (
    <Link href={href} onClick={handleClick} {...props}>
      {children}
    </Link>
  );
}
