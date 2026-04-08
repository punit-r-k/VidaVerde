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
        <Link href="/#shop">Shop</Link>
        <Link href="/#market">Fulshear Market</Link>
        <Link href="/#founder">Founder</Link>
      </div>
    </nav>
  );
}
