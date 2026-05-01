export default function RevealOnScroll({ children, className = "" }) {
  return (
    <div className={["js-reveal", "is-visible", className].filter(Boolean).join(" ")}>
      {children}
    </div>
  );
}
