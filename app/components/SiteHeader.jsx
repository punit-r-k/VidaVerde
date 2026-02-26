import Image from "next/image";

export default function SiteHeader({ variant = "overlay" }) {
  const navClass = variant === "solid" ? "nav nav--solid" : "nav";

  return (
    <nav className={navClass}>
      <div className="logo">
        <Image src="/logo.svg" alt="Vida Verde logo" width={44} height={44} />
        <span>Vida Verde Microgreens</span>
      </div>
      <div className="nav__links">
        <a href="/#shop">Shop</a>
        <a href="/#market">Fulshear Market</a>
        <a href="/#founder">Founder</a>
      </div>
    </nav>
  );
}
