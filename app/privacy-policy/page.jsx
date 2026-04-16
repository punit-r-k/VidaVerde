import SiteHeader from "../components/SiteHeader";
import SiteFooter from "../components/SiteFooter";
import RevealOnScroll from "../components/RevealOnScroll";

const LAST_UPDATED = "April 12, 2026";
const CONTACT_EMAIL = "vidaverdemicrogreens@gmail.com";
const CONTACT_PHONE = "(713) 478-1878";
const CONTACT_TEXT_LINK = "7134781878";

const policyHighlights = [
  {
    label: "Orders",
    title: "We collect what is needed to process the sale.",
    body:
      "That includes the customer and fulfillment details required to take payment, hold inventory, confirm pickup, respond to support requests, and maintain order records."
  },
  {
    label: "Analytics",
    title: "We use limited site analytics to improve the experience.",
    body:
      "The site tracks items like page views, clicks, scroll depth, and section engagement so we can understand how people use the storefront without intentionally logging sensitive checkout details."
  },
  {
    label: "Control",
    title: "Privacy requests can be made directly to Vida Verde.",
    body:
      "If you need help with access, correction, deletion, or marketing opt-out requests, contact us and we will review the request in line with applicable law and business recordkeeping needs."
  }
];

const policySections = [
  {
    title: "Information We Collect",
    paragraphs: [
      "We collect information you choose to provide when you place an order, join our email list, contact us, or otherwise interact with Vida Verde through this website."
    ],
    bullets: [
      "Contact and order information, such as your name, email address, phone number, fulfillment details, order contents, and any notes you submit with an order or inquiry.",
      "If shipping or another delivery option is offered, we may also collect mailing or delivery address details needed to complete the transaction.",
      "Email signup information, including your email address and the source of your signup.",
      "Usage and device information, such as page visits, clicks, scroll depth, browser type, device category, referrer information, and similar interaction data.",
      "Security and server information, such as IP address, user-agent data, timestamps, and rate-limiting or abuse-prevention records."
    ]
  },
  {
    title: "Payment Information",
    paragraphs: [
      "Online payments on this website are processed by Stripe. Vida Verde does not store full payment card numbers, card security codes, or complete card credentials on its own website servers.",
      "We do receive limited transaction details associated with an order, such as payment status, payment identifiers, order totals, and customer information needed to complete and document the sale."
    ]
  },
  {
    title: "How We Use Information",
    bullets: [
      "Process, confirm, and fulfill orders.",
      "Communicate with you about pickups, order changes, support requests, and customer service matters.",
      "Maintain the website, improve performance, understand usage patterns, and measure engagement.",
      "Protect the site, our customers, and our business from fraud, abuse, technical failures, and unauthorized activity.",
      "Maintain business records, enforce our policies, and comply with legal, tax, accounting, or regulatory obligations.",
      "Send email updates or marketing communications if you voluntarily join our email list."
    ]
  },
  {
    title: "Cookies, Local Storage, and Analytics",
    paragraphs: [
      "This site uses limited cookies or similar browser technologies, including local storage and session storage, to support site functionality and understand how visitors use the site.",
      "Our analytics implementation is designed to measure page views, section engagement, clicks, hover intent, scroll depth, and similar site interaction events. We do not intentionally send full payment details or sensitive customer fields through analytics events."
    ]
  },
  {
    title: "When We Share Information",
    paragraphs: [
      "We may share personal information only when reasonably necessary to operate the business and the website."
    ],
    bullets: [
      "With payment, hosting, database, email, analytics, or infrastructure providers that help us run the site and process transactions.",
      "With professional advisors or service providers who assist with operations, security, compliance, or customer support.",
      "If required by law, legal process, regulatory request, or to protect rights, safety, property, or the integrity of the business.",
      "As part of a business transfer, sale, reorganization, or asset transaction, subject to applicable law."
    ],
    notes: [
      "We do not sell your personal information for money."
    ]
  },
  {
    title: "Data Retention",
    paragraphs: [
      "We retain information for as long as reasonably necessary for the purposes described in this policy, including order fulfillment, customer support, accounting, tax documentation, dispute resolution, fraud prevention, security monitoring, and legal compliance.",
      "Email list records may be retained until you unsubscribe or request deletion, subject to records we are legally or operationally required to keep."
    ]
  },
  {
    title: "Your Choices and Rights",
    paragraphs: [
      "You may request access to, correction of, or deletion of personal information we hold about you, subject to applicable law and legitimate business recordkeeping needs.",
      "You may opt out of marketing emails at any time by using the unsubscribe method in the message or by contacting us directly."
    ],
    notes: [
      "Residents of certain states or countries may have additional privacy rights under applicable law."
    ]
  },
  {
    title: "Security",
    paragraphs: [
      "We use reasonable administrative, technical, and organizational measures intended to protect the information we maintain. No method of internet transmission or electronic storage is completely secure, and we cannot guarantee absolute security."
    ]
  },
  {
    title: "Children's Privacy",
    paragraphs: [
      "This website is not directed to children under 13, and we do not knowingly collect personal information from children under 13 through the site."
    ]
  },
  {
    title: "Changes and Contact",
    paragraphs: [
      "We may update this Privacy Policy from time to time. If we make changes, we will post the revised version on this page and update the last-updated date.",
      `Questions, requests, or privacy-related concerns may be directed to ${CONTACT_EMAIL}. You may also text ${CONTACT_PHONE}.`
    ]
  }
];

export const metadata = {
  title: "Privacy Policy | Vida Verde",
  description:
    "Read how Vida Verde collects, uses, stores, and safeguards customer information on its website and during checkout."
};

export default function PrivacyPolicyPage() {
  return (
    <>
      <header className="hero hero--policy" data-analytics-section="privacy_hero">
        <div className="policy-hero__glow" />
        <div className="policy-hero__pattern" />
        <SiteHeader />
        <div className="hero__content policy-hero__content">
          <p className="eyebrow">Privacy Policy</p>
          <h1>Privacy written to match how the Vida Verde site actually works.</h1>
          <p className="policy-hero__summary">
            This page explains what information we collect through the website,
            email signup forms, and checkout flow, how we use it to run the
            business, and what choices you have.
          </p>
          <div className="policy-hero__meta">
            <span>Last updated {LAST_UPDATED}</span>
            <span>Payments processed by Stripe</span>
            <span>{CONTACT_EMAIL}</span>
          </div>
        </div>
      </header>

      <main id="main-content" data-analytics-section="privacy_policy">
        <section className="section section--compact policy-overview">
          <RevealOnScroll className="section__intro">
            <p className="eyebrow">Overview</p>
            <h2>Plain-language privacy terms in the same spirit as the storefront.</h2>
            <p>
              This policy explains what we collect, why we collect it, how long
              we may keep it, when we share it, and how to reach us if you want
              a privacy or email-marketing request reviewed.
            </p>
            <p className="section__disclaimer">
              <span>
                Vida Verde does not store full payment card numbers or security
                codes on its own website servers.
              </span>
            </p>
          </RevealOnScroll>

          <div className="policy-overview__grid">
            {policyHighlights.map((item, index) => (
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
            <h2>What we collect, how we use it, and when we share it.</h2>
            <p>
              The sections below are the operative policy terms. They are
              organized into cards for easier reading, but together they make up
              the full Privacy Policy.
            </p>
          </RevealOnScroll>

          <div className="policy-detail__grid">
            {policySections.map((section, index) => (
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
                {section.notes?.map((note) => (
                  <p key={note} className="policy-detail__note">
                    {note}
                  </p>
                ))}
              </RevealOnScroll>
            ))}
          </div>
        </section>

        <section className="section policy-contact">
          <RevealOnScroll className="policy-contact__shell" preset="softScale">
            <div className="policy-contact__copy">
              <p className="eyebrow">Questions</p>
              <h2>Need a privacy request reviewed?</h2>
              <p>
                Reach out by email or text if you want to ask about your data,
                request a correction, unsubscribe from marketing messages, or
                raise a privacy concern.
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
