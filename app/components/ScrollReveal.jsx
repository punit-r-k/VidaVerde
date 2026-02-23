"use client";

import { useEffect } from "react";

const ROOT_MARGIN = "0px 0px -10% 0px";

export default function ScrollReveal() {
  useEffect(() => {
    const nodes = Array.from(document.querySelectorAll(".js-reveal"));
    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      {
        threshold: 0.18,
        rootMargin: ROOT_MARGIN
      }
    );

    nodes.forEach((node, index) => {
      if (!node.style.getPropertyValue("--reveal-delay")) {
        node.style.setProperty("--reveal-delay", `${Math.min(index * 40, 220)}ms`);
      }
      observer.observe(node);
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  return null;
}
