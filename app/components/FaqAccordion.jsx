"use client";

import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { useState } from "react";

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

export default function FaqAccordion({ items = [] }) {
  const [openIndex, setOpenIndex] = useState(null);
  const shouldReduceMotion = useReducedMotion();

  return (
    <div className="faq__list">
      {items.map((item, index) => {
        const isOpen = openIndex === index;

        return (
          <details
            key={item.q}
            name="homepage-faq"
            open={isOpen}
            className="faq__item"
            data-analytics-id={`faq_${index + 1}`}
            data-analytics-type="faq"
          >
            <summary
              onClick={(event) => {
                event.preventDefault();
                setOpenIndex((current) => (current === index ? null : index));
              }}
            >
              {item.q}
            </summary>
            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  className="faq__collapsible"
                  aria-hidden="false"
                  initial={shouldReduceMotion ? false : "closed"}
                  animate={shouldReduceMotion ? undefined : "open"}
                  exit={shouldReduceMotion ? undefined : "closed"}
                  variants={contentVariants}
                  style={{ overflow: "hidden" }}
                >
                  <motion.div
                    className="faq__collapsible-inner"
                    initial={shouldReduceMotion ? false : "closed"}
                    animate={shouldReduceMotion ? undefined : "open"}
                    exit={shouldReduceMotion ? undefined : "closed"}
                    variants={itemsVariants}
                  >
                    {item.a ? (
                      <motion.p variants={shouldReduceMotion ? undefined : itemVariants}>
                        {item.a}
                      </motion.p>
                    ) : null}
                    {item.intro || item.bullets || item.notes ? (
                      <motion.div
                        className="faq__answer"
                        variants={shouldReduceMotion ? undefined : itemVariants}
                      >
                        {item.intro ? <p>{item.intro}</p> : null}
                        {item.bullets?.length ? (
                          <ul>
                            {item.bullets.map((line) => (
                              <li key={line}>{line}</li>
                            ))}
                          </ul>
                        ) : null}
                        {item.notes?.map((line) => (
                          <p key={line}>{line}</p>
                        ))}
                      </motion.div>
                    ) : null}
                    {item.disclaimer ? (
                      <motion.p
                        className="faq__disclaimer"
                        variants={shouldReduceMotion ? undefined : itemVariants}
                      >
                        <span>{item.disclaimer}</span>
                      </motion.p>
                    ) : null}
                  </motion.div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </details>
        );
      })}
    </div>
  );
}
