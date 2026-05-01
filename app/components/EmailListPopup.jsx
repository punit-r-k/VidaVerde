"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { createPortal } from "react-dom";
import { trackAnalyticsEvent } from "@/lib/analytics";
import { lockPageScroll, unlockPageScroll } from "@/lib/scrollLock";

const DISMISS_KEY = "vidaverde-email-popup-dismissed-v1";
const OPEN_DELAY_MS = 9000;
const DEFAULT_ERROR = "We couldn't save your email right now. Please try again.";
const SUCCESS_MESSAGE = "Thank you. You are on the email list!";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailListPopup() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const dialogRef = useRef(null);
  const emailInputRef = useRef(null);
  const lastFocusedElementRef = useRef(null);

  useEffect(() => {
    const wasDismissed = window.localStorage.getItem(DISMISS_KEY);
    if (wasDismissed) return;

    const timerId = window.setTimeout(() => {
      setOpen(true);
    }, OPEN_DELAY_MS);

    return () => window.clearTimeout(timerId);
  }, []);

  const closePopup = useCallback((reason = "dismiss") => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    const lastFocusedElement = lastFocusedElementRef.current;
    if (reason !== "success") {
      trackAnalyticsEvent({
        name: "email_popup_dismiss",
        sectionId: "hero",
        elementId: "email_popup_dialog",
        metadata: {
          source: "email_popup",
          reason
        }
      });
    }
    setOpen(false);
    window.requestAnimationFrame(() => {
      if (lastFocusedElement instanceof HTMLElement && lastFocusedElement.isConnected) {
        lastFocusedElement.focus();
      }
    });
  }, []);

  useEffect(() => {
    if (!open) return undefined;

    trackAnalyticsEvent({
      name: "email_popup_open",
      sectionId: "hero",
      elementId: "email_popup_dialog",
      metadata: {
        source: "email_popup"
      }
    });

    lastFocusedElementRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const dialog = dialogRef.current;

    const getFocusableElements = () => {
      if (!(dialog instanceof HTMLElement)) {
        return [];
      }

      return Array.from(
        dialog.querySelectorAll(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter(
        (element) =>
          element instanceof HTMLElement &&
          !element.hasAttribute("hidden") &&
          element.getAttribute("aria-hidden") !== "true" &&
          element.getClientRects().length > 0
      );
    };

    const onEscape = (event) => {
      if (event.key === "Escape") {
        closePopup("escape");
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusableElements = getFocusableElements();
      if (!focusableElements.length) {
        event.preventDefault();
        if (dialog instanceof HTMLElement) {
          dialog.focus();
        }
        return;
      }

      const firstFocusable = focusableElements[0];
      const lastFocusable = focusableElements[focusableElements.length - 1];

      if (event.shiftKey && document.activeElement === firstFocusable) {
        event.preventDefault();
        lastFocusable.focus();
      } else if (!event.shiftKey && document.activeElement === lastFocusable) {
        event.preventDefault();
        firstFocusable.focus();
      }
    };

    lockPageScroll();
    window.addEventListener("keydown", onEscape);
    window.requestAnimationFrame(() => {
      if (emailInputRef.current instanceof HTMLElement) {
        emailInputRef.current.focus();
      }
    });

    return () => {
      unlockPageScroll();
      window.removeEventListener("keydown", onEscape);
    };
  }, [closePopup, open]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage("Please enter your email.");
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setErrorMessage("Please enter a valid email address.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSubmitted(false);
    trackAnalyticsEvent({
      name: "email_popup_submit",
      sectionId: "hero",
      elementId: "email_popup_submit",
      metadata: {
        source: "email_popup"
      }
    });

    try {
      const response = await fetch("/api/email-signups", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          email: normalizedEmail,
          source: "email_popup"
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || DEFAULT_ERROR);
      }

      window.localStorage.setItem(DISMISS_KEY, "1");
      setSubmitted(true);
      setEmail("");
      trackAnalyticsEvent({
        name: "email_popup_result",
        sectionId: "hero",
        elementId: "email_popup_submit",
        metadata: {
          source: "email_popup",
          result: "success"
        }
      });

      window.setTimeout(() => {
        closePopup("success");
      }, 1400);
    } catch (error) {
      setErrorMessage(error?.message || DEFAULT_ERROR);
      trackAnalyticsEvent({
        name: "email_popup_result",
        sectionId: "hero",
        elementId: "email_popup_submit",
        metadata: {
          source: "email_popup",
          result: "error",
          errorCode: "submission_failed"
        }
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="email-popup" onClick={() => closePopup("overlay")}>
      <div
        className="email-popup__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-popup-title"
        ref={dialogRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        data-analytics-id="email_popup_dialog"
        data-analytics-hover="true"
      >
        <button
          type="button"
          className="email-popup__close"
          aria-label="Close email signup popup"
          onClick={() => closePopup("close_button")}
          data-analytics-id="email_popup_close"
        >
          x
        </button>

        <div className="email-popup__copy">
          <p className="email-popup__eyebrow">Fresh drops, market updates</p>
          <h2 id="email-popup-title">
            Want to join our email list for new ferments and weekly updates?
          </h2>
          <p className="email-popup__body">
            Get first access to new flavors, seasonal releases, and Saturday
            pickup reminders from Vida Verde.
          </p>

          <form className="email-popup__form" onSubmit={handleSubmit}>
            <label htmlFor="popup-email">Email</label>
            <input
              id="popup-email"
              type="email"
              ref={emailInputRef}
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                if (errorMessage) {
                  setErrorMessage("");
                }
              }}
              placeholder="you@vidaverde.com"
              autoComplete="email"
              aria-invalid={Boolean(errorMessage)}
              aria-describedby={errorMessage ? "popup-email-error" : undefined}
              required
            />
            <button
              type="submit"
              className={`email-popup__button${submitted ? " email-popup__button--success" : ""}`}
              disabled={isSubmitting || submitted}
              data-analytics-id="email_popup_submit"
              data-analytics-hover="true"
            >
              {submitted ? "You are in!" : isSubmitting ? "Joining..." : "I am in"}
            </button>
            {submitted ? (
              <p className="email-popup__success" role="status" aria-live="polite">
                {SUCCESS_MESSAGE}
              </p>
            ) : null}
            {errorMessage ? (
              <p id="popup-email-error" className="email-popup__error" role="status" aria-live="polite">
                {errorMessage}
              </p>
            ) : null}
          </form>

          <button
            type="button"
            className="email-popup__skip"
            onClick={() => closePopup("no_thanks")}
            data-analytics-id="email_popup_skip"
          >
            No thanks
          </button>
        </div>

        <div className="email-popup__media" aria-hidden="true">
          <Image
            src="/hero-product-cluster.webp"
            alt=""
            fill
            sizes="(max-width: 900px) 100vw, 45vw"
          />
        </div>
      </div>
    </div>,
    document.body
  );
}
