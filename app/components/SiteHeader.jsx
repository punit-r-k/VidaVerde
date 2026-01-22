export default function SiteHeader({ variant = "overlay" }) {
  const navClass = variant === "solid" ? "nav nav--solid" : "nav";

  return (
    <nav className={navClass}>
      <div className="logo">
        <img src="/logo.svg" alt="Vida Verde logo" />
        <span>Vida Verde</span>
      </div>
      <div className="nav__links">
        <a href="/#shop">Shop</a>
        <a href="/#market">Fulshear Market</a>
        <a href="/about">Founder</a>
      </div>
    </nav>
  );
}
