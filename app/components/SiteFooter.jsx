import Image from "next/image";
import Link from "next/link";
import {
  MARKET_ADDRESS,
  MARKET_DAY_LABEL,
  MARKET_PICKUP_WINDOW
} from "@/lib/pickupDetails";

const SUPPORT_EMAIL = "vidaverdemicrogreens@gmail.com";
const INSTAGRAM_URL = "https://www.instagram.com/vidaverdemicrogreens/";
const FACEBOOK_URL = "https://www.facebook.com/vidaverdemicrogreens";

export default function SiteFooter({ showMarketSchedule = true }) {
  return (
    <footer className="footer" data-analytics-section="footer">
      <div>
        <h3 className="footer__brand">
          <Image src="/logo.svg" alt="Vida Verde logo" width={32} height={32} />
          <span>Vida Verde Sauerkraut</span>
        </h3>
        <p>Live fermented sauerkraut and hot sauce for daily nourishment.</p>
      </div>
      <div className="footer__meta">
        <span>{MARKET_ADDRESS}</span>
        {showMarketSchedule ? (
          <span>{`${MARKET_DAY_LABEL}, ${MARKET_PICKUP_WINDOW}`}</span>
        ) : null}
        <a className="footer__link" href={`mailto:${SUPPORT_EMAIL}`}>
          {SUPPORT_EMAIL}
        </a>
        <div className="footer__socials">
          <a
            className="footer__link"
            href={INSTAGRAM_URL}
            target="_blank"
            rel="noreferrer"
          >
            Instagram
          </a>
          <a
            className="footer__link"
            href={FACEBOOK_URL}
            target="_blank"
            rel="noreferrer"
          >
            Facebook
          </a>
        </div>
        <Link className="footer__link" href="/privacy-policy">
          Privacy Policy
        </Link>
      </div>
    </footer>
  );
}
