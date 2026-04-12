"use client";

import { motion, useInView, useReducedMotion } from "framer-motion";
import { useRef } from "react";

const VIEWPORT_MARGIN = "0px 0px -10% 0px";
const DEFAULT_VIEWPORT_AMOUNT = 0.18;
const DEFAULT_PRESET = "rise";

const REVEAL_PRESETS = {
  rise: {
    hidden: {
      opacity: 0,
      y: 24
    },
    visible: {
      opacity: 1,
      y: 0
    }
  },
  driftLeft: {
    hidden: {
      opacity: 0,
      x: 28
    },
    visible: {
      opacity: 1,
      x: 0
    }
  },
  driftRight: {
    hidden: {
      opacity: 0,
      x: -28
    },
    visible: {
      opacity: 1,
      x: 0
    }
  },
  fade: {
    hidden: {
      opacity: 0
    },
    visible: {
      opacity: 1
    }
  },
  softScale: {
    hidden: {
      opacity: 0,
      y: 18,
      scale: 0.97
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1
    }
  },
  tiltLift: {
    hidden: {
      opacity: 0,
      y: 26,
      scale: 0.985
    },
    visible: {
      opacity: 1,
      y: 0,
      scale: 1
    }
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
  const shouldReduceMotion = useReducedMotion();
  const motionPreset = REVEAL_PRESETS[preset] || REVEAL_PRESETS[DEFAULT_PRESET];
  const isInView = useInView(rootRef, {
    once: true,
    amount,
    margin: VIEWPORT_MARGIN
  });

  return (
    <motion.div
      ref={rootRef}
      className={["js-reveal", isInView || shouldReduceMotion ? "is-visible" : "", className]
        .filter(Boolean)
        .join(" ")}
      initial={shouldReduceMotion ? false : motionPreset.hidden}
      whileInView={shouldReduceMotion ? undefined : motionPreset.visible}
      viewport={{
        once: true,
        amount,
        margin: VIEWPORT_MARGIN
      }}
      transition={
        shouldReduceMotion
          ? undefined
          : {
              duration,
              delay,
              ease: [0.22, 1, 0.36, 1]
            }
      }
    >
      {children}
    </motion.div>
  );
}
