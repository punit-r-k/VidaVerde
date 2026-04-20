import Image from "next/image";
import Link from "next/link";
import { getGoogleReviewSummary } from "@/lib/googleReviews";
import {
  MARKET_ADDRESS,
  MARKET_DAY_LABEL,
  MARKET_PICKUP_WINDOW
} from "@/lib/pickupDetails";
import {
  FACEBOOK_URL,
  GOOGLE_REVIEW_URL,
  INSTAGRAM_URL,
  SUPPORT_EMAIL
} from "@/lib/siteMetadata";

const MAX_REVIEW_STARS = 5;

function InstagramIcon(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.2" cy="6.8" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

function FacebookIcon(props) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M14.2 20V12.9h2.6l.4-2.9h-3V8.2c0-.9.3-1.5 1.6-1.5H17V4.1c-.4-.1-1.2-.1-2-.1-2.1 0-3.5 1.3-3.5 3.6V10H9v2.9h2.5V20Z" />
    </svg>
  );
}

function StarIcon({ filled = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className={`footer__review-star${filled ? " footer__review-star--filled" : ""}`}
    >
      <path d="m12 2.4 2.96 6 6.62.96-4.79 4.67 1.13 6.59L12 17.5l-5.92 3.12 1.13-6.59L2.42 9.36l6.62-.96Z" />
    </svg>
  );
}

export default async function SiteFooter({ showMarketSchedule = true }) {
  const googleReviewSummary = await getGoogleReviewSummary();
  const starFillCount = Math.max(
    0,
    Math.min(MAX_REVIEW_STARS, Math.round(googleReviewSummary.rating))
  );

  return (
    <footer className="footer" data-analytics-section="footer">
      <div>
        <div className="footer__brand">
          <Image src="/logo.svg" alt="Vida Verde logo" width={32} height={32} />
          <span>Vida Verde Sauerkraut</span>
        </div>
        <p>Live fermented sauerkraut and hot sauce for daily nourishment.</p>
        <div className="footer__review-row">
          <a
            className="button button--light footer__review-link"
            href={GOOGLE_REVIEW_URL}
            target="_blank"
            rel="noreferrer"
            data-analytics-id="footer_google_review"
          >
            Leave A Google Review
          </a>
          <span
            className="footer__review-rating"
            aria-label={`${googleReviewSummary.rating.toFixed(1)} star Google rating`}
          >
            <span className="footer__review-stars" aria-hidden="true">
              {Array.from({ length: MAX_REVIEW_STARS }, (_, index) => (
                <StarIcon key={`footer-review-star-${index}`} filled={index < starFillCount} />
              ))}
            </span>
            <span className="footer__review-score">{googleReviewSummary.rating.toFixed(1)}</span>
          </span>
        </div>
        <div className="footer__socials" aria-label="Social links">
          <a
            className="footer__social-link"
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Visit Vida Verde on Instagram"
          >
            <InstagramIcon className="footer__social-icon" />
          </a>
          <a
            className="footer__social-link"
            href={FACEBOOK_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Visit Vida Verde on Facebook"
          >
            <FacebookIcon className="footer__social-icon" />
          </a>
        </div>
      </div>
      <div className="footer__meta">
        <span>{MARKET_ADDRESS}</span>
        {showMarketSchedule ? (
          <span>{`${MARKET_DAY_LABEL}, ${MARKET_PICKUP_WINDOW}`}</span>
        ) : null}
        <a className="footer__link" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        <Link className="footer__link" href="/privacy-policy">
          Privacy Policy
        </Link>
        <Link className="footer__link" href="/accessibility-statement">
          Accessibility Statement
        </Link>
      </div>
    </footer>
  );
}
