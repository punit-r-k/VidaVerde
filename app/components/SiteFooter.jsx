import Image from "next/image";
import Link from "next/link";
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

export default function SiteFooter({ showMarketSchedule = true }) {
  return (
    <footer className="footer" data-analytics-section="footer">
      <div>
        <div className="footer__brand">
          <Image src="/logo.svg" alt="Vida Verde logo" width={502} height={474} />
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
