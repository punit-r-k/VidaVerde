const navItems = [
  // Archived section:
  // { href: "#proof", label: "Proof" },
  { href: "#voices", label: "Reviews" },
  { href: "#founder", label: "Our Story" },
  { href: "#wellness", label: "Why Live Fermented Foods Matter" },
  { href: "#shop", label: "Shop" },
  { href: "#faq", label: "FAQ" }
];

export default function JumpNav() {
  const navToggleId = "jump-nav-toggle";

  return (
    <nav className="jump-nav" aria-label="Page section navigation">
      <input
        type="checkbox"
        id={navToggleId}
        className="jump-nav__checkbox"
      />
      <label
        htmlFor={navToggleId}
        className="jump-nav__toggle"
      >
        Menu
        <span className="jump-nav__toggle-icon" aria-hidden="true">
          <span></span>
          <span></span>
          <span></span>
        </span>
      </label>
      <div className="jump-nav__links">
        {navItems.map((item) => (
          <a key={item.href} href={item.href}>
            {item.label}
          </a>
        ))}
      </div>
    </nav>
  );
}
