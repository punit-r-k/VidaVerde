import Storefront from "./components/Storefront";
import EmailListPopup from "./components/EmailListPopup";
import EmailSignupForm from "./components/EmailSignupForm";
import HeroVideo from "./components/HeroVideo";
import MarketPickupPolicy from "./components/MarketPickupPolicy";
import RevealOnScroll from "./components/RevealOnScroll";
import JumpNav from "./components/JumpNav";
import SectionNavLink from "./components/SectionNavLink";
import TestimonialGrid from "./components/TestimonialGrid";
import FaqAccordion from "./components/FaqAccordion";
import SiteFooter from "./components/SiteFooter";
import Image from "next/image";
import { getProducts } from "@/lib/products";
import {
  MARKET_ADDRESS,
  MARKET_DAY_LABEL,
  MARKET_NAME,
  MARKET_PICKUP_POLICY_ITEMS,
  MARKET_PICKUP_SUMMARY,
  MARKET_PICKUP_WINDOW,
  getPickupDetails
} from "@/lib/pickupDetails";
import { getInventoryMap } from "@/lib/stock";
import {
  GOOGLE_REVIEW_URL,
  SITE_ALTERNATE_NAMES,
  SITE_NAME,
  SOCIAL_LINKS,
  SUPPORT_EMAIL,
  SUPPORT_PHONE_E164,
  TARGET_SEARCH_PHRASES,
  createPageMetadata,
  getServiceAreaJsonLd,
  getCanonicalUrl
} from "@/lib/siteMetadata";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

const HOME_DESCRIPTION =
  "Shop live fermented sauerkraut and hot sauces from Vida Verde Sauerkraut at vvsauerkraut.com, also associated with Vida Verde Microgreens. Reserve online for Saturday pickup at Fulshear Farmers Market in Richmond, serving Fulshear, Katy, Richmond, and nearby west Houston communities.";

export const metadata = createPageMetadata({
  title: "Live Fermented Sauerkraut and Hot Sauce",
  description: HOME_DESCRIPTION,
  path: "/",
  keywords: [
    ...TARGET_SEARCH_PHRASES,
    "Vida Verde Microgreens",
    "VidaVerde Sauerkraut",
    "live fermented sauerkraut",
    "raw sauerkraut",
    "fermented hot sauce",
    "farmers market pickup",
    "Katy TX sauerkraut",
    "Katy TX fermented foods",
    "Richmond TX sauerkraut",
    "Fulshear Farmers Market",
    "Fulshear TX fermented foods"
  ]
});

const buildFaqAnswerText = (faq) =>
  [faq.a, faq.intro, ...(faq.bullets || []), ...(faq.notes || [])]
    .filter(Boolean)
    .join(" ");

const getProductAvailabilityUrl = (product, inventory) => {
  const entry = inventory?.[product.sku];

  if ((entry?.on_hand || 0) > 0) {
    return "https://schema.org/InStock";
  }

  if ((entry?.preorders_remaining || 0) > 0) {
    return "https://schema.org/PreOrder";
  }

  return "https://schema.org/OutOfStock";
};

export default async function Home() {
  const medicalDisclaimer =
    "Not intended as medical advice, consult your healthcare provider before dietary changes.";

  const [products, inventory] = await Promise.all([
    getProducts(),
    getInventoryMap()
  ]);
  const pickupDetails = getPickupDetails();
  const showProofSection = false;

  const partnerLogos = [
    "Fulshear Farmers Market",
    "Houston Wellness Co-op",
    "Richmond Natural Grocers",
    "Harvest House Cafe"
  ];

  const sauerkrautDifferenceChecklist = [
    "Fermented in natural vegetable juices",
    "Never pasteurized",
    "No preservatives or shortcuts",
    "Rich in live, active cultures"
  ];

  const whyItWorks = [
    {
      step: "01",
      title: "Signs You May Need Gut Support",
      body:
        "Bloating, irregular digestion, fatigue, brain fog, skin issues, frequent colds, and sugar cravings can all point to an imbalanced gut. If these patterns show up often, adding fermented foods consistently can be a simple first step to support better balance over time."
    },
    {
      step: "02",
      title: "Live Cultures In A Real Food Matrix",
      body:
        "Unlike supplements, probiotics are delivered through naturally fermented vegetables. Fermented in natural vegetable juices and never pasteurized, each batch keeps live active cultures to support digestion, nutrient absorption, immune health, energy, mood, and mental clarity."
    },
    {
      step: "03",
      title: "Easy Daily Routine",
      body:
        "Start with about 2 tablespoons daily. Enjoy it straight or add it to salads, sandwiches, eggs, grain bowls, and vegetables. Keep it uncooked and make it part of your regular meals so the habit is easy to sustain."
    }
  ];

  const proofStats = [
    {
      value: "8 years",
      label: "Fermentation craft"
    },
    {
      value: "5 years",
      label: "Farmers market service"
    },
    {
      value: "Thousands",
      label: "Jars enjoyed"
    }
  ];

  const testimonials = [
    {
      quote:
        "VidaVerde has the best microgreens and gut healthy products I've found. I've been visiting Edison at the Fulshear Farmers market since 2021, and now I won't go anywhere else. In that time, I've received an education on his process (it's all clean, green, intentional y'all), he's passionate about what he does, I've gotten to know him as a person (he's a beautiful human being as well as a comedian), and I've had the privilege to sample lots of products. The soup is very tasty and has been my lunch most of the winter. I bravely tried various sauerkrauts and they are nothing like what I'd ever had before. My fave - Red Coral. He also has probiotic hot sauces chock full of vitamins and on occasion wellness shots. The microgreens are in containers that make it extremely easy to keep fresh, and the containers can be returned for less waste. They are all my favorite, though the flavors of the basil and wasabi really come through. Best of all is the smile that comes with the service.",
      highlights: [
        "microgreens",
        "gut healthy",
        "probiotic hot sauces",
        "wellness shots",
        "sauerkrauts",
        "basil and wasabi",
        "very tasty"
      ],
      previewSentenceCount: 1,
      name: "Jennifer Hopkins",
      meta: "Fulshear Farmers Market"
    },
    {
      quote:
        "Absolutely wonderful and delicious. This sauerkraut with cumin is truly a standout. The tangy brightness of the sauerkraut pairs beautifully with the warm, earthy flavor of cumin, creating a perfect balance of zest and depth. The cumin adds just the right touch of spice without overpowering the natural crispness and freshness of the cabbage. Every bite is flavorful, aromatic, and satisfying. It's wonderfully seasoned, delicious on its own, and even better as a complement to a hearty meal. If you enjoy bold yet balanced flavors, this combination is simply perfect.",
      highlights: [
        "sauerkraut with cumin",
        "cumin",
        "cabbage",
        "tangy brightness",
        "warm, earthy flavor",
        "perfect balance of zest and depth",
        "flavorful, aromatic, and satisfying"
      ],
      name: "Veronica Bradshaw",
      meta: "Fulshear Farmers Market"
    },
    {
      quote:
        "Vida Verda Micro-greens makes awesome and inventive sauerkraut. Before I started using their product I was not a fan of sauerkraut, but I find Vida Verda to be delicious and nutritious to the point our whole family looks to incorporate into our diet on a weekly basis.",
      highlights: [
        "sauerkraut",
        "delicious and nutritious",
        "incorporate into our diet on a weekly basis"
      ],
      previewSentenceCount: 1,
      name: "David & Claire",
      meta: "Fulshear Farmers Market"
    },
    {
      quote:
        "Edison's \'Caribbean Heat\' raw sauerkraut has completely changed the way I think about fermented foods in the best possible way. The flavor is tangy and refreshingly crisp. Unlike some shelf-stable versions that can taste dull or sour, his sauerkraut has a lively taste that feels vibrant with every bite. A huge bonus is its natural fermentation. It retains beneficial probiotics that support gut health. Also, love the texture. It stays crunchy, which makes a great topping for salads, sandwiches, grain bowls, or straight from the jar (my fav!). It adds an instant flavor boost and zing to otherwise simple dishes.",
      highlights: [
        "natural fermentation",
        "probiotics",
        "gut health",
        "sauerkraut",
        "tangy and refreshingly crisp",
        "lively taste",
        "flavor boost",
        "zing"
      ],
      previewSentenceCount: 1,
      name: "Jason Smarg",
      meta: "Fulshear Farmers Market"
    }
  ];

  const faqs = [
    {
      q: "Which jar should I start with if I am new to sauerkraut?",
      intro: "If you want the easiest entry point, start with one of the milder krauts first:",
      bullets: [
        "Endless Summer for a clean, classic kraut profile with light carrot sweetness",
        "Red Coral for a brighter, slightly fuller finish from beets and carrots",
        "Sunset if you want a warmer savory note from turmeric and cumin",
        "Caribbean Heat if you already know you want some jalapeno kick"
      ],
      notes: [
        "Most first-time customers do best by choosing a flavor that already fits the meals they like to eat."
      ]
    },
    {
      q: "Do I need to refrigerate it right away?",
      a: "No. Our sealed sauerkraut jars are shelf stable before opening. Store them in a cool spot out of direct heat and sunlight, then refrigerate after opening."
    },
    {
      q: "What should I expect when I open a live ferment jar?",
      a: "A tangy aroma, some fizz, pressure release, or a little brine movement can be normal in a live ferment. Open the jar slowly, and if gas builds up during storage, loosen the lid briefly to burp the jar, then reseal it."
    },
    {
      q: "How spicy are the hot options?",
      intro: "The heat level varies quite a bit across the lineup:",
      bullets: [
        "Caribbean Heat has a steady jalapeno kick but stays approachable",
        "Green Kick Hot Sauce is mild and herbal",
        "Hell Yeah! Hot Sauce is the hottest option and should be used a little at a time"
      ],
      notes: [
        "If you are heat-sensitive, start with the krauts or Green Kick before moving up."
      ]
    },
    {
      q: "How do I keep the jar tasting its best after opening?",
      a: "After opening, keep it refrigerated, use a clean fork or spoon, and keep the vegetables tucked under the brine when possible. If pressure builds in the refrigerator, burp the jar briefly and close it again so the flavor and texture stay at their best."
    },
    {
      q: "Do you offer shipping?",
      a: "Not yet. We currently offer pickup only. Shipping is coming soon."
    }
  ];

  const allergenBadges = [
    {
      label: "Gluten-free",
      icon: "gluten-free.svg",
      iconWidth: 265,
      iconHeight: 265
    },
    {
      label: "Dairy-free",
      icon: "dairy-free.svg",
      iconWidth: 249,
      iconHeight: 249
    },
    {
      label: "Nut-free",
      icon: "nut-free.svg",
      iconWidth: 239,
      iconHeight: 239
    },
    {
      label: "Soy-free",
      icon: "soy-free.svg",
      iconWidth: 239,
      iconHeight: 239
    },
    {
      label: "Egg-free",
      icon: "egg-free.svg",
      iconWidth: 239,
      iconHeight: 239
    }
  ];

  const marketPolicyItems = MARKET_PICKUP_POLICY_ITEMS;
  const homePageJsonLd = {
    "@context": "https://schema.org",
    "@type": "OnlineStore",
    "@id": `${getCanonicalUrl("/")}#store`,
    name: SITE_NAME,
    alternateName: SITE_ALTERNATE_NAMES,
    url: getCanonicalUrl("/"),
    description: HOME_DESCRIPTION,
    disambiguatingDescription:
      "Official online storefront for Vida Verde Sauerkraut, also searched as vvsauerkraut and Vida Verde Microgreens.",
    image: [
      getCanonicalUrl("/email/order-confirmation-banner.png"),
      getCanonicalUrl("/founder-photo.avif")
    ],
    logo: getCanonicalUrl("/logo.svg"),
    email: SUPPORT_EMAIL,
    telephone: SUPPORT_PHONE_E164,
    identifier: TARGET_SEARCH_PHRASES.map((phrase) => ({
      "@type": "PropertyValue",
      propertyID: "search phrase",
      value: phrase
    })),
    sameAs: SOCIAL_LINKS,
    knowsAbout: [
      "live fermented sauerkraut",
      "raw sauerkraut",
      "fermented hot sauce",
      "microgreens",
      "Fulshear Farmers Market pickup"
    ],
    address: {
      "@type": "PostalAddress",
      streetAddress: MARKET_ADDRESS,
      addressLocality: "Richmond",
      addressRegion: "TX",
      postalCode: "77406",
      addressCountry: "US"
    },
    areaServed: getServiceAreaJsonLd(),
    availableLanguage: "en-US",
    paymentAccepted: "Credit Card",
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Vida Verde fermented foods",
      itemListElement: products.map((product) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Product",
          name: product.name,
          sku: product.sku
        }
      }))
    }
  };
  const productCollectionJsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "Vida Verde product collection",
    itemListElement: products.map((product, index) => ({
      "@type": "ListItem",
      position: index + 1,
      item: {
        "@type": "Product",
        name: product.name,
        sku: product.sku,
        description: product.description,
        image: product.image ? getCanonicalUrl(product.image) : undefined,
        brand: {
          "@type": "Brand",
          name: SITE_NAME,
          alternateName: SITE_ALTERNATE_NAMES
        },
        offers: {
          "@type": "Offer",
          priceCurrency: "USD",
          price: (product.priceCents / 100).toFixed(2),
          availability: getProductAvailabilityUrl(product, inventory),
          url: getCanonicalUrl("/#shop"),
          itemCondition: "https://schema.org/NewCondition"
        }
      }
    }))
  };
  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((faq) => ({
      "@type": "Question",
      name: faq.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: buildFaqAnswerText(faq)
      }
    }))
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(homePageJsonLd)
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(productCollectionJsonLd)
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(faqJsonLd)
        }}
      />
      <EmailListPopup />
      <header className="hero" data-analytics-section="hero">
        <HeroVideo />
        <div className="hero__overlay"></div>
        <div className="hero__content">
          <div className="hero__brand reveal" style={{ "--delay": "0.05s" }}>
            <Image src="/logo.svg" alt="Vida Verde logo" width={502} height={474} />
            <span className="hero__brand-text">
              <span>vida verde</span>
              <span>sauerkraut</span>
            </span>
          </div>
          <p className="eyebrow reveal" style={{ "--delay": "0.1s" }}>
            Unpasteurized ferments{" "}
            <br className="hero__mobile-break" />
            made for daily meals.
          </p>
          <h1 className="reveal" style={{ "--delay": "0.2s" }}>
            Real food.{" "}
            <br className="hero__mobile-break" />
            Real cultures.
            <br />
            <span className="hero__headline-accent">Real results.</span>
          </h1>
          <p className="hero__subhead reveal" style={{ "--delay": "0.3s" }}>
            We make small-batch, live fermented sauerkraut and hot sauces made to help restore gut balance naturally. A healthier gut microbiome supports digestion, immunity, energy, mood, and overall well-being.
          </p>
          <div className="hero__actions reveal" style={{ "--delay": "0.4s" }}>
            <SectionNavLink
              className="button button--light"
              href="#shop"
              data-analytics-id="hero_shop_cta"
              data-analytics-type="cta"
              data-analytics-hover="true"
            >
              Shop The Jars
            </SectionNavLink>
            <SectionNavLink
              className="button button--ghost"
              href="#market"
              data-analytics-id="hero_market_cta"
              data-analytics-type="cta"
              data-analytics-hover="true"
            >
              Find us in person
            </SectionNavLink>
          </div>
        </div>
        <div className="hero__scroll">Scroll</div>
      </header>

      <JumpNav />

      <main id="main-content">
        {showProofSection ? (
          <section id="proof" className="section section--tight section--line signals">
            <RevealOnScroll className="signals__shell" preset="softScale">
              <div className="signals__intro">
                <p className="eyebrow">Trusted Around Houston</p>
                <h2>Weekly market customers choose us for consistent raw fermentation.</h2>
              </div>
              <ul className="signals__logos" aria-label="Community partners and shoppers">
                {partnerLogos.map((logo) => (
                  <li key={logo}>{logo}</li>
                ))}
              </ul>
              <div className="signals__stats">
                {proofStats.map((item) => (
                  <div key={item.value}>
                    <strong>{item.value}</strong>
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
            </RevealOnScroll>
          </section>
        ) : null}

        <section
          id="voices"
          className="section section--compact section--fade voices"
          data-analytics-section="voices"
        >
          <div className="voices__shell">
            <div className="voices__feature">
              <RevealOnScroll className="voices__intro" delay={0.08} preset="driftRight">
                <p className="eyebrow">Customer Voices</p>
                <h2>Real feedback from weekly customers building a daily ferment routine.</h2>
                <p className="voices__subcopy">
                  Tried Vida Verde recently? Leave a quick Google review to help new
                  customers choose their next jar.
                </p>
              </RevealOnScroll>
              <RevealOnScroll className="voices__media" delay={0.12} preset="driftLeft">
                <figure className="voices__media-frame">
                  <div className="voices__photo">
                    <Image
                      src="/VV Market (16).webp"
                      alt="Vida Verde customer smiling while holding two jars of sauerkraut"
                      width={1536}
                      height={2048}
                      sizes="(max-width: 640px) 260px, (max-width: 900px) 300px, 246px"
                    />
                  </div>
                </figure>
              </RevealOnScroll>
              <RevealOnScroll
                className="voices__review-action"
                delay={0.16}
                preset="driftRight"
              >
                <a
                  className="button button--ghost voices__review-link"
                  href={GOOGLE_REVIEW_URL}
                  target="_blank"
                  rel="noreferrer"
                  data-analytics-id="voices_google_review"
                  data-analytics-hover="true"
                >
                  Leave A Google Review
                </a>
              </RevealOnScroll>
            </div>
            <div className="voices__divider" aria-hidden="true" />
            <RevealOnScroll delay={0.12} preset="rise">
              <TestimonialGrid testimonials={testimonials} />
            </RevealOnScroll>
          </div>
        </section>

        <section
          id="wellness"
          className="section section--compact section--fade pulse pulse--why"
          data-analytics-section="wellness"
        >
          <RevealOnScroll className="pulse__shell" delay={0.12} preset="rise">
            <div className="pulse__intro pulse__intro--why">
              <p className="eyebrow">Foundation</p>
              <h2>Why Live Fermented Foods Matter</h2>
              <p className="pulse__bridge">
                Live fermentation can support digestion, nutrient absorption, and daily resilience.
                Next, see how we translate that into every jar.
              </p>
              <p className="section__disclaimer pulse__disclaimer">
                <span>{medicalDisclaimer}</span>
              </p>
            </div>
            <div className="pulse__grid">
              {whyItWorks.map((item) => (
                <article key={item.step} className="pulse-card">
                  <p className="pulse-card__step">{item.step}</p>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </article>
              ))}
            </div>
            <div className="pulse__continuity">
              <span className="pulse__continuity-label">Next in the story</span>
              <p>How we apply these live-food principles in every jar.</p>
            </div>
          </RevealOnScroll>
        </section>

        <section
          className="section section--compact section--fade pulse pulse--difference"
          data-analytics-section="difference"
        >
          <RevealOnScroll
            className="pulse__shell pulse__shell--linked"
            delay={0.16}
            preset="fade"
          >
            <div className="pulse__difference-layout">
              <div className="pulse__intro pulse__intro--difference">
                <p className="eyebrow">In Every Jar</p>
                <h2>What Makes Our Sauerkraut Different?</h2>
              </div>
              <div className="pulse__answer pulse__answer--difference">
                <p>
                  Crafted with a variety of fresh vegetables, our sauerkraut is fermented with
                  vegetables delivering elevated nutrition and bold, complex flavor.
                </p>
                <ul className="pulse__checklist" aria-label="What makes our sauerkraut different">
                  {sauerkrautDifferenceChecklist.map((item) => (
                    <li key={item}>
                      <span className="pulse__check" aria-hidden="true">&#10004;</span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
                <p>Every jar is alive, bringing together flavor and function.</p>
              </div>
            </div>
          </RevealOnScroll>
        </section>

        <section
          className="section section--tight section--line buy-cta"
          data-analytics-section="buy_cta"
        >
          <RevealOnScroll className="buy-cta__shell" delay={0.14} preset="tiltLift">
            <div className="buy-cta__copy">
              <p className="eyebrow">Ready To Start</p>
              <h2>
                Daily Nourishment,
                <br />
                One Spoon at a Time
              </h2>
              <p>Choose a flavor you already enjoy so the routine sticks.</p>
            </div>
            <div className="buy-cta__actions">
              <SectionNavLink
                className="button button--dark"
                href="#shop"
                data-analytics-id="buy_cta_shop"
                data-analytics-type="cta"
                data-analytics-hover="true"
              >
                Shop The Collection
              </SectionNavLink>
              <SectionNavLink
                className="button button--light"
                href="#market"
                data-analytics-id="buy_cta_market"
                data-analytics-type="cta"
                data-analytics-hover="true"
              >
                Saturday Pickup Info
              </SectionNavLink>
            </div>
          </RevealOnScroll>
        </section>

        <section
          id="shop"
          className="section section--tight section--plain shop"
          data-analytics-section="shop"
        >
          <RevealOnScroll className="section__intro section__intro--compact" delay={0.12} preset="softScale">
            <p className="eyebrow">The Collection</p>
            <h2>Six products: four sauerkraut profiles and two hot sauces.</h2>
            <p>
              Fermented in natural vegetable juices, our small-batch, unpasteurized ferments with no preservatives are made with a variety of fresh vegetables for bold, complex flavor and higher nutrition.
              Some offerings are infused with microgreens to add natural probiotics and prebiotics, with seasonal rotating batches released throughout the year.
              For optimal health benefits, enjoy them raw and refrain from cooking.
            </p>
          </RevealOnScroll>

          <div className="collection__bar" aria-label="Default dietary profile">
            <span className="collection__bar-title">Allergen-friendly</span>
            <ul className="collection__bar-list">
              {allergenBadges.map(({ label, icon, iconWidth, iconHeight }) => (
                <li key={label}>
                  <span className="collection__bar-pill">
                    <Image
                      src={`/allergen-icons/${encodeURIComponent(icon)}`}
                      alt=""
                      aria-hidden="true"
                      width={iconWidth}
                      height={iconHeight}
                      className="collection__bar-pill-icon"
                    />
                    <span className="collection__bar-pill-label">{label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <Storefront
            products={products}
            inventory={inventory}
            pickupDetails={pickupDetails}
          />
        </section>

        <div className="shop-market-divider" aria-hidden="true">
          <span id="market" className="section-anchor section-anchor--market" />
          <RevealOnScroll
            className="shop-market-divider__reveal"
            preset="fade"
            delay={0.22}
            duration={0.68}
            amount={0.08}
          >
            <Image
              src="/storefront-vines.avif"
              alt=""
              width={2647}
              height={305}
              sizes="100vw"
              className="shop-market-divider__img"
            />
          </RevealOnScroll>
        </div>

        <section
          className="section section--compact section--line market"
          data-analytics-section="market"
        >
          <div className="market__grid">
            <RevealOnScroll className="market__intro" delay={0.12} preset="driftRight">
              <p className="eyebrow">{MARKET_NAME}</p>
              <h2>Find Vida Verde in person.</h2>
              <p className="market__summary">{MARKET_PICKUP_SUMMARY}</p>
            </RevealOnScroll>

            <RevealOnScroll className="market__photo" delay={0.12} preset="driftRight">
              <Image
                src="/VV Market (10).webp"
                alt="Vida Verde market booth with customers sampling products"
                width={2048}
                height={1365}
                sizes="(max-width: 640px) 340px, (max-width: 1024px) 520px, 260px"
              />
            </RevealOnScroll>

            <RevealOnScroll className="market__cta" delay={0.16} preset="driftLeft">
              <p className="market__cta-label">This week&apos;s pickup</p>
              <h3>{pickupDetails.market_date_label}</h3>
              <p>
                Order any time before {pickupDetails.same_day_cutoff_label} for pickup that
                Saturday, if stock is available.
              </p>
              <SectionNavLink
                className="button button--light"
                href="#shop"
                data-analytics-id="market_reserve_cta"
                data-analytics-type="cta"
                data-analytics-hover="true"
              >
                Reserve A Jar
              </SectionNavLink>
            </RevealOnScroll>

            <div className="market__board">
              <RevealOnScroll className="market__facts" delay={0.2} duration={0.68} preset="fade">
                <article className="market__card">
                  <span className="market__card-label">When</span>
                  <strong>{`${MARKET_DAY_LABEL}, ${MARKET_PICKUP_WINDOW}`}</strong>
                  <p>Reserve online, then pick up on site during the market window.</p>
                </article>

                <article className="market__card">
                  <span className="market__card-label">Where</span>
                  <strong>{MARKET_NAME}</strong>
                  <p>{MARKET_ADDRESS}</p>
                </article>
              </RevealOnScroll>

              <MarketPickupPolicy items={marketPolicyItems} />
            </div>
          </div>
        </section>

        <section
          id="join-email"
          className="section section--compact section--plain email-cta"
          data-analytics-section="join_email"
        >
          <RevealOnScroll className="email-cta__shell" delay={0.17} preset="softScale">
            <p className="eyebrow">Stay Updated</p>
            <h2>Join our email list.</h2>
            <p>
              Get new product announcements, healthy eating notes, recipe ideas, and Vida Verde updates.
            </p>
            <EmailSignupForm source="homepage_join_email" />
          </RevealOnScroll>
        </section>

        <section id="founder" className="about-hero" data-analytics-section="founder">
          <div className="about-hero__grid about-hero__grid--inline">
            <RevealOnScroll className="about-hero__copy" delay={0.08} preset="driftRight">
              <p className="eyebrow">Founder Story</p>
              <h1>Built from a home fermentation practice in Richmond.</h1>
              <p>
                Eight years ago, a personal challenge changed everything. Our
                founder began making small-batch sauerkraut at home to help his
                wife recover from serious digestive issues and a weakened immune
                system. When she could not tolerate the smell or intensity of
                classic kraut, he started blending cabbage with fresh
                vegetables, herbs, and spices, fermenting only in natural
                juices with no added water.
              </p>
              <p>
                The results were a flavorful, truly live food that she could
                enjoy daily. Over time her digestion improved and her immune
                system grew stronger. For five years he supported his family at
                farmers markets and natural food stores across Houston,
                producing tons by hand and witnessing thousands of customer
                transformations.
              </p>
            </RevealOnScroll>
            <RevealOnScroll className="about-hero__media" delay={0.14} preset="driftLeft">
              <div className="about__portrait about-hero__portrait">
                <Image
                  src="/founder-photo.avif"
                  alt="Vida Verde founder portrait"
                  width={2048}
                  height={1356}
                  sizes="(max-width: 600px) 100vw, (max-width: 900px) 85vw, 700px"
                />
              </div>
              <div className="about-hero__quote">
                <p>&quot;This is not just a product. It is a real story, lived,
                tested, and proven.&quot;</p>
                <span>— Edison Neto, Vida Verde Founder</span>
              </div>
            </RevealOnScroll>
          </div>
        </section>

        <div className="founder-faq-divider" aria-hidden="true">
          <Image
            src="/ornament-divider-collectio.avif"
            alt=""
            width={923}
            height={215}
            className="founder-faq-divider__img"
          />
        </div>

        <section
          id="faq"
          className="section section--compact section--plain faq"
          data-analytics-section="faq"
        >
          <RevealOnScroll className="faq__shell" delay={0.18} preset="rise">
            <div className="faq__intro">
              <p className="eyebrow">FAQ</p>
              <h2>Quick answers before you place your first order.</h2>
            </div>
            <FaqAccordion items={faqs} />
          </RevealOnScroll>
        </section>
      </main>

      <SiteFooter />
    </>
  );
}
