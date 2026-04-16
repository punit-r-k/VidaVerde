import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import RevealOnScroll from "../components/RevealOnScroll";

const LAST_UPDATED = "April 15, 2026";
const CONTACT_EMAIL = "vidaverdemicrogreens@gmail.com";
const CONTACT_PHONE = "(713) 478-1878";
const CONTACT_TEXT_LINK = "7134781878";

const accessibilityHighlights = [
  {
    label: "Goal",
    title: "We are actively working to reduce barriers on the current storefront.",
    body:
      "Vida Verde wants the current public storefront to be easier to use for people who browse with keyboards, assistive technology, reduced-motion settings, and common desktop or mobile devices."
  },
  {
    label: "Standard",
    title: "Our accessibility work is informed by WCAG 2.2 Level AA.",
    body:
      "We use the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA as a practical reference point for ongoing improvements, not as a statement that the site has been formally certified."
  },
  {
    label: "Support",
    title: "Visitors can contact us directly if something does not work.",
    body:
      "If you encounter an accessibility barrier anywhere on the site, let us know and we will review the issue and work toward a reasonable fix or alternative way to help."
  }
];

const accessibilitySections = [
  {
    title: "Our Approach",
    paragraphs: [
      "We treat accessibility as part of ongoing maintenance on the current Vida Verde storefront rather than as a one-time task.",
      "Recent work on this site has focused on page structure, text contrast, keyboard access, focus states, touch target sizing, skip navigation, and dialog behavior on key public pages and shopping flows."
    ]
  },
  {
    title: "Accessibility Features On This Site",
    bullets: [
      "A skip link and main content landmarks on the public pages.",
      "Keyboard-accessible navigation, buttons, forms, cart controls, FAQ controls, and current site dialogs.",
      "Visible focus styles to help keyboard users understand where they are on the page.",
      "Accessible names and text alternatives for key controls, images, and form fields.",
      "Reduced-motion support where the site includes reveal animations or smooth scrolling.",
      "Responsive layouts intended to remain usable across common mobile and desktop viewport sizes."
    ]
  },
  {
    title: "Ongoing Improvements",
    paragraphs: [
      "Accessibility work is ongoing. As content, product pages, and checkout behavior evolve, we may identify additional issues and make updates over time.",
      "We prioritize fixes that affect core browsing, shopping, and checkout tasks, especially on the main public pages."
    ]
  },
  {
    title: "Third-Party Services",
    paragraphs: [
      "Some parts of the customer experience rely on third-party services or infrastructure, including payment processing through Stripe.",
      "Where the site uses third-party interfaces such as Stripe-hosted payment fields, accessibility can depend in part on those providers and their embedded components."
    ]
  },
  {
    title: "Browser And Device Support",
    paragraphs: [
      "We aim for the site to work in current major browsers and on common desktop and mobile devices. Older browsers or unusual device combinations may still present issues we have not yet identified."
    ]
  },
  {
    title: "How To Report An Issue",
    paragraphs: [
      "If you have trouble accessing any page, product information, checkout step, form, or other part of the site, please contact us.",
      "If possible, include the page you were using, the device and browser, any assistive technology involved, and a short description of what went wrong."
    ]
  },
  {
    title: "Statement Updates",
    paragraphs: [
      "We may revise this Accessibility Statement from time to time as the website changes or as our accessibility work progresses. When we do, we will update the last-updated date on this page."
    ]
  }
];

export const metadata = {
  title: "Accessibility Statement | Vida Verde",
  description:
    "Read how Vida Verde approaches website accessibility, ongoing improvements, and how to report an accessibility issue."
};

export default function AccessibilityStatementPage() {
  return (
    <>
      <header className="hero hero--policy" data-analytics-section="accessibility_hero">
        <div className="policy-hero__glow" />
        <div className="policy-hero__pattern" />
        <SiteHeader />
        <div className="hero__content policy-hero__content">
          <p className="eyebrow">Accessibility Statement</p>
          <h1>Accessibility is part of how we want this storefront to work.</h1>
          <p className="policy-hero__summary">
            This page explains how Vida Verde approaches website accessibility,
            the accessibility work that is currently in place on the storefront,
            and how to contact us if you run into an accessibility issue.
          </p>
          <div className="policy-hero__meta">
            <span>Last updated {LAST_UPDATED}</span>
            <span>Informed by WCAG 2.2 AA</span>
            <span>{CONTACT_EMAIL}</span>
          </div>
        </div>
      </header>

      <main id="main-content" data-analytics-section="accessibility_statement">
        <section className="section section--compact policy-overview">
          <RevealOnScroll className="section__intro">
            <p className="eyebrow">Overview</p>
            <h2>Plain-language accessibility commitments for the Vida Verde site.</h2>
            <p>
              We want people to be able to browse the site, understand product
              information, place an order, and contact us without unnecessary
              barriers.
            </p>
            <p className="section__disclaimer accessibility-statement__disclaimer">
              <span>
                This statement describes our current accessibility efforts and
                ongoing goals. It is not a guarantee that every page will be
                free from every issue at all times.
              </span>
            </p>
          </RevealOnScroll>

          <div className="policy-overview__grid">
            {accessibilityHighlights.map((item, index) => (
              <RevealOnScroll
                key={item.title}
                className="policy-overview__card"
                preset={index === 1 ? "softScale" : "rise"}
                delay={index * 0.05}
              >
                <p className="policy-overview__label">{item.label}</p>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </RevealOnScroll>
            ))}
          </div>
        </section>

        <section className="section section--tight policy-detail">
          <RevealOnScroll className="section__intro section__intro--compact">
            <p className="eyebrow">Details</p>
            <h2>How we think about accessibility, support, and ongoing fixes.</h2>
            <p>
              The sections below describe the accessibility practices reflected
              in the current storefront and the limits that still apply as the
              site continues to change.
            </p>
          </RevealOnScroll>

          <div className="policy-detail__grid">
            {accessibilitySections.map((section, index) => (
              <RevealOnScroll
                key={section.title}
                className={`policy-detail__card${index % 3 === 0 ? " policy-detail__card--tinted" : ""}`}
                preset={index % 2 === 0 ? "rise" : "softScale"}
                delay={(index % 4) * 0.04}
              >
                <p className="policy-detail__label">
                  {String(index + 1).padStart(2, "0")}
                </p>
                <h3>{section.title}</h3>
                {section.paragraphs?.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
                {section.bullets?.length ? (
                  <ul>
                    {section.bullets.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                ) : null}
              </RevealOnScroll>
            ))}
          </div>
        </section>

        <section className="section policy-contact">
          <RevealOnScroll className="policy-contact__shell" preset="softScale">
            <div className="policy-contact__copy">
              <p className="eyebrow">Contact</p>
              <h2>Need help accessing something on the site?</h2>
              <p>
                Reach out by email or text if you encounter an accessibility
                issue, need assistance completing an order, or want us to
                review a specific barrier.
              </p>
            </div>
            <div className="policy-contact__actions">
              <a className="button button--light" href={`mailto:${CONTACT_EMAIL}`}>
                Email Us
              </a>
              <a className="button button--ghost" href={`sms:${CONTACT_TEXT_LINK}`}>
                Text Us
              </a>
              <p className="policy-contact__meta">
                {CONTACT_EMAIL}
                <span>{CONTACT_PHONE}</span>
              </p>
            </div>
          </RevealOnScroll>
        </section>
      </main>

      <SiteFooter showMarketSchedule={false} />
    </>
  );
}
