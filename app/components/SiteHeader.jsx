import Image from "next/image";
import SectionNavLink from "./SectionNavLink";

export default function SiteHeader({ variant = "overlay" }) {
  const navClass = variant === "solid" ? "nav nav--solid" : "nav";

  return (
    <nav className={navClass}>
      <div className="logo">
        <Image src="/logo.svg" alt="Vida Verde logo" width={502} height={474} />
        <span>Vida Verde Sauerkraut</span>
      </div>
      <div className="nav__links">
        <SectionNavLink href="/#shop" data-analytics-id="site_header_shop" data-analytics-type="nav">
          Shop
        </SectionNavLink>
        <SectionNavLink
          href="/#market"
          data-analytics-id="site_header_market"
          data-analytics-type="nav"
        >
          Fulshear Market
        </SectionNavLink>
        <SectionNavLink
          href="/#founder"
          data-analytics-id="site_header_founder"
          data-analytics-type="nav"
        >
          Founder
        </SectionNavLink>
      </div>
    </nav>
  );
}
