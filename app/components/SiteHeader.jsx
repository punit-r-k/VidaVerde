export default function SiteHeader({ variant = "overlay" }) {
  const navClass = variant === "solid" ? "nav nav--solid" : "nav";

  return (
    <nav className={navClass}>
      <div className="logo">Vida Verde</div>
      <div className="nav__links">
        <a href="/#shop">Shop</a>
        <a href="/#market">Fulshear Market</a>
        <a href="/about">Founder</a>
      </div>
    </nav>
  );
}
