"use client";

import { useId, useState } from "react";

const DEFAULT_ERROR = "Unable to save your email right now. Please try again.";
const SUCCESS_MESSAGE = "Thank you for joining our email list!";
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EmailSignupForm({ source = "website_email_cta" }) {
  const inputId = useId();
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [hasError, setHasError] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    if (isSubmitting || isSuccess) return;

    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setStatusMessage("Email is required.");
      setHasError(true);
      setIsSuccess(false);
      return;
    }
    if (!EMAIL_REGEX.test(normalizedEmail)) {
      setStatusMessage("Enter a valid email address.");
      setHasError(true);
      setIsSuccess(false);
      return;
    }

    setIsSubmitting(true);
    setStatusMessage("");
    setHasError(false);
    setIsSuccess(false);

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
    } catch (error) {
      setStatusMessage(error?.message || DEFAULT_ERROR);
      setHasError(true);
      setIsSuccess(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="email-signup-form" onSubmit={handleSubmit} noValidate>
      <label className="email-signup-form__label" htmlFor={inputId}>
        Email address
      </label>
      <div className="email-signup-form__controls">
        <input
          id={inputId}
          type="email"
          value={email}
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
        <button
          type="submit"
          className={`button button--dark email-signup-form__submit${isSuccess ? " email-signup-form__submit--success" : ""}`}
          disabled={isSubmitting || isSuccess}
        >
          {isSuccess ? "Thanks!" : isSubmitting ? "Joining..." : "Join The List"}
        </button>
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
