"use client";

import { useEffect, useId, useState } from "react";
import { trackAnalyticsEvent } from "@/lib/analytics";

const DEFAULT_ERROR = "We couldn't save your email right now. Please try again.";
const SUCCESS_MESSAGE = "Thank you for joining our email list!";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailSignupForm({
  source = "website_email_cta",
  initialEmail = "",
  hideSubmitButton = false,
  submitLabel = "Join The List",
  className = ""
}) {
  const inputId = useId();
  const normalizedInitialEmail = String(initialEmail || "").trim().toLowerCase();
  const [email, setEmail] = useState(() => normalizedInitialEmail);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    setEmail(normalizedInitialEmail);
  }, [normalizedInitialEmail]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting || isSuccess) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setStatusMessage("Please enter your email.");
      setHasError(true);
      setIsSuccess(false);
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setStatusMessage("Please enter a valid email address.");
      setHasError(true);
      setIsSuccess(false);
      return;
    }

    setIsSubmitting(true);
    setStatusMessage("");
    setHasError(false);
    setIsSuccess(false);
    trackAnalyticsEvent({
      name: "email_signup_submit",
      sectionId: "join_email",
      elementId: `email_signup_submit_${source}`,
      metadata: {
        source
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
          source
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || DEFAULT_ERROR);
      }

      setEmail("");
      setStatusMessage(SUCCESS_MESSAGE);
      setHasError(false);
      setIsSuccess(true);
      trackAnalyticsEvent({
        name: "email_signup_result",
        sectionId: "join_email",
        elementId: `email_signup_submit_${source}`,
        metadata: {
          source,
          result: "success"
        }
      });
    } catch (error) {
      setStatusMessage(error?.message || DEFAULT_ERROR);
      setHasError(true);
      setIsSuccess(false);
      trackAnalyticsEvent({
        name: "email_signup_result",
        sectionId: "join_email",
        elementId: `email_signup_submit_${source}`,
        metadata: {
          source,
          result: "error",
          errorCode: "submission_failed"
        }
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form
      className={[
        "email-signup-form",
        hideSubmitButton ? "email-signup-form--input-only" : "",
        className
      ]
        .filter(Boolean)
        .join(" ")}
      onSubmit={handleSubmit}
      noValidate
    >
      <label className="email-signup-form__label" htmlFor={inputId}>
        Email address
      </label>
      <div className="email-signup-form__controls">
        <input
          id={inputId}
          type="email"
          value={email}
          onFocus={() => {
            trackAnalyticsEvent({
              name: "email_signup_focus",
              sectionId: "join_email",
              elementId: `email_signup_input_${source}`,
              metadata: {
                source
              }
            });
          }}
          onChange={(event) => {
            setEmail(event.target.value);
            if (hasError) {
              setStatusMessage("");
              setHasError(false);
            }
          }}
          placeholder="you@vidaverde.com"
          autoComplete="email"
          aria-invalid={hasError}
          aria-describedby={statusMessage ? `${inputId}-status` : undefined}
          required
          disabled={isSubmitting || isSuccess}
        />
        {hideSubmitButton ? null : (
          <button
            type="submit"
            className={`button button--dark email-signup-form__submit${isSuccess ? " email-signup-form__submit--success" : ""}`}
          disabled={isSubmitting || isSuccess}
          data-analytics-id={`email_signup_submit_${source}`}
          data-analytics-hover="true"
        >
            {isSuccess ? "Thanks!" : isSubmitting ? "Joining..." : submitLabel}
          </button>
        )}
      </div>
      {statusMessage ? (
        <p
          id={`${inputId}-status`}
          className={`email-signup-form__status email-signup-form__status--animated${hasError ? " email-signup-form__status--error" : ""}${isSuccess ? " email-signup-form__status--success" : ""}`}
          role="status"
          aria-live="polite"
        >
          {statusMessage}
        </p>
      ) : null}
    </form>
  );
}
