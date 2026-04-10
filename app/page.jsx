import Storefront from "./components/Storefront";
import EmailListPopup from "./components/EmailListPopup";
import EmailSignupForm from "./components/EmailSignupForm";
import ScrollReveal from "./components/ScrollReveal";
import JumpNav from "./components/JumpNav";
import TestimonialGrid from "./components/TestimonialGrid";
import Image from "next/image";
import { getProducts } from "@/lib/products";
import {
  FOLLOWING_WEEK_PICKUP_NOTICE,
  MARKET_ADDRESS,
  MARKET_DAY_LABEL,
  MARKET_NAME,
  MARKET_PICKUP_POLICY_BULLETS,
  MARKET_PICKUP_POLICY_NOTES,
  MARKET_PICKUP_SUMMARY,
  MARKET_PICKUP_WINDOW,
  MARKET_UPDATES_NOTICE,
  SAME_DAY_PICKUP_NOTICE,
  WEATHER_CLOSURE_NOTICE,
  getPickupDetails
} from "@/lib/pickupDetails";
import { getInventoryMap } from "@/lib/stock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

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
      q: "How much should I eat per day?",
      a: "Start with 1 tablespoon daily for a few days, then move to about 2 tablespoons with meals. Add it straight, or use it on salads, sandwiches, eggs, bowls, and vegetables."
    },
    {
      q: "What makes this different from probiotic supplements?",
      a: "Our probiotics come in a natural food matrix, not a capsule. You get live cultures together with real fermented vegetables, flavor, and nutrients in one daily food.",
      disclaimer: medicalDisclaimer
    },
    {
      q: "How do I know if I may need gut support?",
      a: "Common signs include bloating, irregular digestion, fatigue, brain fog, skin issues, frequent colds, and sugar cravings."
    },
    {
      q: "What standards do you follow?",
      a: "We ferment in natural vegetable juices with no preservatives or shortcuts, and we never pasteurize. That keeps the cultures live and active."
    },
    {
      q: "Do you offer shipping?",
      intro: "Not yet. We currently offer pickup only. Shipping is coming soon.",
      bullets: [
        `Pickup: ${MARKET_NAME}`,
        `Location: ${MARKET_ADDRESS}`,
        `When: ${MARKET_DAY_LABEL}, ${MARKET_PICKUP_WINDOW}`,
        SAME_DAY_PICKUP_NOTICE,
        FOLLOWING_WEEK_PICKUP_NOTICE
      ],
      notes: [WEATHER_CLOSURE_NOTICE, MARKET_UPDATES_NOTICE]
    }
  ];

  const allergenBadges = [
    {
      label: "Gluten-free",
      icon: "gluten-free.svg"
    },
    {
      label: "Dairy-free",
      icon: "dairy-free.svg"
    },
    {
      label: "Nut-free",
      icon: "nut-free.svg"
    },
    {
      label: "Soy-free",
      icon: "soy-free.svg"
    },
    {
      label: "Egg-free",
      icon: "egg-free.svg"
    }
  ];

  return (
    <>
      <EmailListPopup />
      <ScrollReveal />
      <header className="hero" data-analytics-section="hero">
        <video
          className="hero__video"
          autoPlay
          muted
          loop
          playsInline
          poster="https://images.unsplash.com/photo-1512621776951-a57141f2eefd?auto=format&fit=crop&w=1600&q=80"
        >
          <source
            src="https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4"
            type="video/mp4"
          />
        </video>
        <div className="hero__overlay"></div>
        <div className="hero__content">
          <div className="hero__brand reveal" style={{ "--delay": "0.05s" }}>
            <Image src="/logo.svg" alt="Vida Verde logo" width={46} height={46} />
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
            <a
              className="button button--light"
              href="#shop"
              data-analytics-id="hero_shop_cta"
              data-analytics-type="cta"
              data-analytics-hover="true"
            >
              Shop The Jars
            </a>
            <a
              className="button button--ghost"
              href="#market"
              data-analytics-id="hero_market_cta"
              data-analytics-type="cta"
              data-analytics-hover="true"
            >
              Find us in person
            </a>
          </div>
        </div>
        <div className="hero__scroll">Scroll</div>
      </header>

      <JumpNav />

      <main>
        {showProofSection ? (
          <section id="proof" className="section section--tight section--line signals">
            <div className="signals__shell js-reveal">
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
            </div>
          </section>
        ) : null}

        <section
          id="voices"
          className="section section--compact section--fade voices"
          data-analytics-section="voices"
        >
          <div className="voices__shell js-reveal" style={{ "--reveal-delay": "80ms" }}>
            <div className="voices__intro">
              <p className="eyebrow">Customer Voices</p>
              <h2>Real feedback from weekly customers building a daily ferment routine.</h2>
            </div>
            <TestimonialGrid testimonials={testimonials} />
          </div>
        </section>

        <section
          id="wellness"
          className="section section--compact section--fade pulse pulse--why"
          data-analytics-section="wellness"
        >
          <div className="pulse__shell js-reveal" style={{ "--reveal-delay": "120ms" }}>
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
          </div>
        </section>

        <section
          className="section section--compact section--fade pulse pulse--difference"
          data-analytics-section="difference"
        >
          <div className="pulse__shell pulse__shell--linked js-reveal" style={{ "--reveal-delay": "160ms" }}>
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
          </div>
        </section>

        <section
          className="section section--tight section--line buy-cta"
          data-analytics-section="buy_cta"
        >
          <div className="buy-cta__shell js-reveal" style={{ "--reveal-delay": "140ms" }}>
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
              <a
                className="button button--dark"
                href="#shop"
                data-analytics-id="buy_cta_shop"
                data-analytics-type="cta"
                data-analytics-hover="true"
              >
                Shop The Collection
              </a>
              <a
                className="button button--light"
                href="#market"
                data-analytics-id="buy_cta_market"
                data-analytics-type="cta"
                data-analytics-hover="true"
              >
                Saturday Pickup Info
              </a>
            </div>
          </div>
        </section>

        <section
          id="shop"
          className="section section--tight section--plain shop"
          data-analytics-section="shop"
        >
          <div className="section__intro section__intro--compact js-reveal" style={{ "--reveal-delay": "120ms" }}>
            <p className="eyebrow">The Collection</p>
            <h2>Six products: four sauerkraut profiles and two hot sauces.</h2>
            <p>
              Fermented in natural vegetable juices, our small-batch, unpasteurized ferments with no preservatives are made with a variety of fresh vegetables for bold, complex flavor and higher nutrition.
              Some offerings are infused with microgreens to add natural probiotics and prebiotics, with seasonal rotating batches released throughout the year.
              For optimal health benefits, enjoy them raw and refrain from cooking.
            </p>
          </div>

          <div className="collection__bar" aria-label="Default dietary profile">
            <span className="collection__bar-title">Allergen-friendly</span>
            <ul className="collection__bar-list">
              {allergenBadges.map(({ label, icon }) => (
                <li key={label}>
                  <span className="collection__bar-pill">
                    <Image
                      src={`/allergen-icons/${encodeURIComponent(icon)}`}
                      alt=""
                      aria-hidden="true"
                      width={18}
                      height={18}
                      className="collection__bar-pill-icon"
                    />
                    <span className="collection__bar-pill-label">{label}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <Storefront products={products} inventory={inventory} />
        </section>

        <section
          id="market"
          className="section section--tight section--line market"
          data-analytics-section="market"
        >
          <div className="market__grid js-reveal" style={{ "--reveal-delay": "160ms" }}>
            <div className="market__copy">
              <p className="eyebrow">{MARKET_NAME}</p>
              <h2>Find Vida Verde in person.</h2>
              <p>{MARKET_PICKUP_SUMMARY}</p>
              <div className="market__details">
                <div>
                  <strong>When</strong>
                  <span>{`${MARKET_DAY_LABEL}, ${MARKET_PICKUP_WINDOW}`}</span>
                </div>
                <div>
                  <strong>Where</strong>
                  <span>{MARKET_ADDRESS}</span>
                </div>
                <div>
                  <strong>Pickup Date</strong>
                  <span>{pickupDetails.market_date_label}</span>
                </div>
              </div>
            </div>
            <div className="market__panel">
              <h3>Pickup Policy</h3>
              <ul>
                {MARKET_PICKUP_POLICY_BULLETS.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {MARKET_PICKUP_POLICY_NOTES.map((line) => (
                <p key={line} className="market__panel-note">
                  {line}
                </p>
              ))}
              <a
                className="button button--light"
                href="#shop"
                data-analytics-id="market_reserve_cta"
                data-analytics-type="cta"
                data-analytics-hover="true"
              >
                Reserve A Jar
              </a>
            </div>
          </div>
        </section>

        <section
          id="join-email"
          className="section section--compact section--plain email-cta"
          data-analytics-section="join_email"
        >
          <div className="email-cta__shell js-reveal" style={{ "--reveal-delay": "170ms" }}>
            <p className="eyebrow">Stay Updated</p>
            <h2>Join our email list.</h2>
            <p>
              Get new batch drops, seasonal flavor releases, and Saturday pickup reminders.
            </p>
            <EmailSignupForm source="homepage_join_email" />
          </div>
        </section>

        <section id="founder" className="about-hero" data-analytics-section="founder">
          <div
            className="about-hero__grid about-hero__grid--inline js-reveal"
            style={{ "--reveal-delay": "100ms" }}
          >
            <div className="about-hero__copy">
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
            </div>
            <div className="about-hero__media">
              <div className="about__portrait about-hero__portrait">
                <Image
                  src="/founder-photo.webp"
                  alt="Vida Verde founder portrait"
                  width={2048}
                  height={1356}
                  quality={95}
                  sizes="(max-width: 600px) 100vw, (max-width: 900px) 85vw, 700px"
                />
              </div>
              <div className="about-hero__quote">
                <p>&quot;This is not just a product. It is a real story, lived,
                tested, and proven.&quot;</p>
                <span>— Edison Neto, Vida Verde Founder</span>
              </div>
            </div>
          </div>
        </section>

        <div className="founder-faq-divider" aria-hidden="true">
          <Image
            src="/ornament-divider-collectio.png"
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
          <div className="faq__shell js-reveal" style={{ "--reveal-delay": "180ms" }}>
            <div className="faq__intro">
              <p className="eyebrow">FAQ</p>
              <h2>Quick answers before you place your first order.</h2>
            </div>
            <div className="faq__list">
              {faqs.map((item, index) => (
                <details
                  key={item.q}
                  data-analytics-id={`faq_${index + 1}`}
                  data-analytics-type="faq"
                >
                  <summary>{item.q}</summary>
                  {item.a ? <p>{item.a}</p> : null}
                  {item.intro || item.bullets || item.notes ? (
                    <div className="faq__answer">
                      {item.intro ? <p>{item.intro}</p> : null}
                      {item.bullets?.length ? (
                        <ul>
                          {item.bullets.map((line) => (
                            <li key={line}>{line}</li>
                          ))}
                        </ul>
                      ) : null}
                      {item.notes?.map((line) => (
                        <p key={line}>{line}</p>
                      ))}
                    </div>
                  ) : null}
                  {item.disclaimer ? (
                    <p className="faq__disclaimer">
                      <span>{item.disclaimer}</span>
                    </p>
                  ) : null}
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer" data-analytics-section="footer">
        <div>
          <h3 className="footer__brand">
            <Image src="/logo.svg" alt="Vida Verde logo" width={32} height={32} />
            <span>Vida Verde Sauerkraut</span>
          </h3>
          <p>Live fermented sauerkraut and hot sauce for daily nourishment.</p>
        </div>
        <div className="footer__meta">
          <span>{MARKET_ADDRESS}</span>
          <span>{`${MARKET_DAY_LABEL}, ${MARKET_PICKUP_WINDOW}`}</span>
          <span>vidaverdemicrogreens@gmail.com</span>
        </div>
      </footer>
    </>
  );
}
