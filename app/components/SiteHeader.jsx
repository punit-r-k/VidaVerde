import Image from "next/image";
import Link from "next/link";

export default function SiteHeader({ variant = "overlay" }) {
  const navClass = variant === "solid" ? "nav nav--solid" : "nav";

  return (
    <nav className={navClass}>
      <div className="logo">
        <Image src="/logo.svg" alt="Vida Verde logo" width={44} height={44} />
        <span>Vida Verde Sauerkraut</span>
      </div>
      <div className="nav__links">
        <Link href="/#shop" data-analytics-id="site_header_shop" data-analytics-type="nav">
          Shop
        </Link>
        <Link
          href="/#market"
          data-analytics-id="site_header_market"
          data-analytics-type="nav"
        >
          Fulshear Market
        </Link>
        <Link
          href="/#founder"
          data-analytics-id="site_header_founder"
          data-analytics-type="nav"
        >
          Founder
        </Link>
      </div>
    </nav>
  );
}
