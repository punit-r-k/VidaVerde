"use client";

import { useEffect, useState } from "react";
import Image from "next/image";

const DISMISS_KEY = "vidaverde-email-popup-dismissed-v1";
const OPEN_DELAY_MS = 1200;
const DEFAULT_ERROR = "Unable to save your email right now. Please try again.";
const SUCCESS_MESSAGE = "Thank you. You are on the email list!";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailListPopup() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const wasDismissed = window.localStorage.getItem(DISMISS_KEY);
    if (wasDismissed) return;

    const timerId = window.setTimeout(() => {
      setOpen(true);
    }, OPEN_DELAY_MS);

    return () => window.clearTimeout(timerId);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const onEscape = (event) => {
      if (event.key === "Escape") {
        closePopup();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onEscape);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onEscape);
    };
  }, [open]);

  const closePopup = () => {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  };

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setErrorMessage("Email is required.");
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setErrorMessage("Enter a valid email address.");
      return;
    }

    setIsSubmitting(true);
    setErrorMessage("");
    setSubmitted(false);

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

      window.setTimeout(() => {
        setOpen(false);
      }, 1400);
    } catch (error) {
      setErrorMessage(error?.message || DEFAULT_ERROR);
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="email-popup" onClick={closePopup}>
      <div
        className="email-popup__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="email-popup-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="email-popup__close"
          aria-label="Close email signup popup"
          onClick={closePopup}
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
            onClick={closePopup}
          >
            No thanks
          </button>
        </div>

        <div className="email-popup__media" aria-hidden="true">
          <Image
            src="https://images.unsplash.com/photo-1464226184884-fa280b87c399?auto=format&fit=crop&w=1200&q=80"
            alt=""
            fill
            sizes="(max-width: 900px) 100vw, 45vw"
          />
        </div>
      </div>
    </div>
  );
}
