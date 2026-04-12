"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useId, useState } from "react";

const EASE_OUT = [0.22, 1, 0.36, 1];

const contentVariants = {
  closed: {
    height: 0,
    opacity: 0,
    y: -8,
    transition: {
      height: {
        duration: 0.18,
        ease: EASE_OUT
      },
      opacity: {
        duration: 0.12
      },
      y: {
        duration: 0.14,
        ease: EASE_OUT
      }
    }
  },
  open: {
    height: "auto",
    opacity: 1,
    y: 0,
    transition: {
      height: {
        duration: 0.24,
        ease: EASE_OUT
      },
      opacity: {
        duration: 0.18,
        delay: 0.02
      },
      y: {
        duration: 0.2,
        ease: EASE_OUT
      }
    }
  }
};

const itemsVariants = {
  closed: {
    transition: {
      staggerChildren: 0.02,
      staggerDirection: -1
    }
  },
  open: {
    transition: {
      delayChildren: 0.03,
      staggerChildren: 0.04
    }
  }
};

const itemVariants = {
  closed: {
    opacity: 0,
    y: -6,
    transition: {
      duration: 0.12
    }
  },
  open: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.18,
      ease: EASE_OUT
    }
  }
};

export default function MarketPickupPolicy({ items = [] }) {
  const [isOpen, setIsOpen] = useState(false);
  const shouldReduceMotion = useReducedMotion();
  const contentId = useId();

  return (
    <div className="market__policy-dropdown">
      <button
        type="button"
        className={`market__policy-toggle button button--ghost${isOpen ? " is-open" : ""}`}
        aria-expanded={isOpen}
        aria-controls={contentId}
        data-analytics-id="market_pickup_policy"
        data-analytics-type="dropdown"
        onClick={() => setIsOpen((open) => !open)}
      >
        View Pickup Policy
      </button>

      <AnimatePresence initial={false}>
        {isOpen ? (
          <motion.div
            id={contentId}
            key="market-pickup-policy"
            className="market__policy-dropdown-content"
            initial={shouldReduceMotion ? false : "closed"}
            animate={shouldReduceMotion ? undefined : "open"}
            exit={shouldReduceMotion ? undefined : "closed"}
            variants={contentVariants}
            style={{ overflow: "hidden" }}
          >
            <motion.div
              className="market__policy-items"
              initial={shouldReduceMotion ? false : "closed"}
              animate={shouldReduceMotion ? undefined : "open"}
              exit={shouldReduceMotion ? undefined : "closed"}
              variants={itemsVariants}
            >
              {items.map((item) => (
                <motion.div
                  key={item.label}
                  className="market__policy-item"
                  variants={shouldReduceMotion ? undefined : itemVariants}
                >
                  <span className="market__policy-item-label">{item.label}</span>
                  <p>{item.body}</p>
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
