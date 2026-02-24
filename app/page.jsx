import Storefront from "./components/Storefront";
import EmailListPopup from "./components/EmailListPopup";
import EmailSignupForm from "./components/EmailSignupForm";
import ScrollReveal from "./components/ScrollReveal";
import JumpNav from "./components/JumpNav";
import Image from "next/image";
import { getProducts } from "@/lib/products";
import { getInventoryMap } from "@/lib/stock";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

export default async function Home() {
  const [products, inventory] = await Promise.all([
    getProducts(),
    getInventoryMap()
  ]);
  const marketAddress = "9035 Bois d'Arc Ln, Richmond, TX 77406";

  const partnerLogos = [
    "Fulshear Farmers Market",
    "Houston Wellness Co-op",
    "Richmond Natural Grocers",
    "Harvest House Cafe"
  ];

  const whyItWorks = [
    {
      step: "01",
      title: "Signs You May Need Gut Support",
      body:
        "Bloating, irregular digestion, fatigue, brain fog, skin issues, frequent colds, and sugar cravings can all point to an imbalanced gut."
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
        "Start with about 2 tablespoons daily. Enjoy it straight or add it to salads, sandwiches, eggs, grain bowls, and vegetables."
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
        "We started with one spoonful each day and now keep two jars in rotation. Digestion feels steadier and meals feel easier.",
      name: "Market Customer",
      meta: "Richmond, TX"
    },
    {
      quote:
        "Flavor is clean and fresh, never harsh. I like that it is actually raw and refrigerated from pickup to table.",
      name: "Saturday Shopper",
      meta: "Fulshear Farmers Market"
    },
    {
      quote:
        "The mild profile made it simple to build a daily habit. The consistency week-to-week is what keeps me coming back.",
      name: "Repeat Buyer",
      meta: "Houston Area"
    }
  ];

  const faqs = [
    {
      q: "How much should I eat per day?",
      a: "Start with 1 tablespoon daily for a few days, then move to about 2 tablespoons with meals. Add it straight, or use it on salads, sandwiches, eggs, bowls, and vegetables."
    },
    {
      q: "What makes this different from probiotic supplements?",
      a: "Our probiotics come in a natural food matrix, not a capsule. You get live cultures together with real fermented vegetables, flavor, and nutrients in one daily food."
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
      q: "Can I pick up instead of shipping?",
      a: "Yes. Reserve online and pick up at Fulshear Farmers Market every Saturday."
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
      <header className="hero">
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
            <span>Vida Verde</span>
          </div>
          <p className="eyebrow reveal" style={{ "--delay": "0.1s" }}>
            Unpasteurized ferments made for daily meals.
          </p>
          <h1 className="reveal" style={{ "--delay": "0.2s" }}>
            Real food.
            <br className="hero__mobile-break" />
            Real cultures.
            <br />
            <span className="hero__headline-accent">Real results.</span>
          </h1>
          <p className="hero__subhead reveal" style={{ "--delay": "0.3s" }}>
            We make small-batch, live fermented sauerkraut and hot sauces made to help restore gut balance naturally. A healthier gut microbiome supports digestion, immunity, energy, mood, and overall well-being.
          </p>
          <div className="hero__actions reveal" style={{ "--delay": "0.4s" }}>
            <a className="button button--light" href="#shop">
              Shop The Jars
            </a>
            <a className="button button--ghost" href="#proof">
              Find us in person
            </a>
          </div>
        </div>
        <div className="hero__scroll">Scroll</div>
      </header>

      <main>
        <JumpNav />

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

        <section id="voices" className="section section--compact section--fade voices">
          <div className="voices__shell js-reveal" style={{ "--reveal-delay": "80ms" }}>
            <div className="voices__intro">
              <p className="eyebrow">Customer Voices</p>
              <h2>Real feedback from weekly customers building a daily ferment routine.</h2>
            </div>
            <div className="voices__grid" aria-label="Customer testimonials">
              {testimonials.map((item, index) => (
                <article
                  key={item.name}
                  className={`voices-card ${index % 2 === 0 ? "voices-card--sage" : "voices-card--oat"}`}
                >
                  <p className="voices-card__quote">&quot;{item.quote}&quot;</p>
                  <p className="voices-card__meta">
                    <strong>{item.name}</strong>
                    <span>{item.meta}</span>
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="wellness" className="section section--compact section--fade pulse">
          <div className="pulse__shell js-reveal" style={{ "--reveal-delay": "120ms" }}>
            <div className="pulse__intro">
              <p className="eyebrow">Why Live Fermented Foods Matter</p>
              <h2>What Makes Our Sauerkraut Different?</h2>
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
          </div>
        </section>

        <section className="section section--tight section--line buy-cta">
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
              <a className="button button--dark" href="#shop">
                Shop The Collection
              </a>
              <a className="button button--light" href="#market">
                Saturday Pickup Info
              </a>
            </div>
          </div>
        </section>

        <section id="shop" className="section section--tight section--plain shop">
          <div className="section__intro section__intro--compact js-reveal" style={{ "--reveal-delay": "120ms" }}>
            <p className="eyebrow">The Collection</p>
            <h2>Six products: four sauerkraut profiles and two hot sauces.</h2>
            <p>
              Small-batch, refrigerated, and unpasteurized ferments made with a variety of fresh vegetables beyond cabbage for bold, complex flavor and higher nutrition.
              Some offerings are infused with microgreens to add natural probiotics and prebiotics, with seasonal rotating batches released throughout the year.
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

        <section id="market" className="section section--tight section--line market">
          <div className="market__grid js-reveal" style={{ "--reveal-delay": "160ms" }}>
            <div className="market__copy">
              <p className="eyebrow">Fulshear Farmers Market</p>
              <h2>Find Vida Verde in person.</h2>
              <p>
                Reserve online, then pick up your jars every Saturday at the
                Fulshear Farmers Market.
              </p>
              <div className="market__details">
                <div>
                  <strong>When</strong>
                  <span>Every Saturday, 9:00 AM - 1:00 PM</span>
                </div>
                <div>
                  <strong>Where</strong>
                  <span>{marketAddress}</span>
                </div>
                <div>
                  <strong>Pickup</strong>
                  <span>Reserve online, pick up on site</span>
                </div>
              </div>
            </div>
            <div className="market__panel">
              <h3>Market Day Essentials</h3>
              <ul>
                <li>Reserve online and pick up on site every Saturday.</li>
                <li>Bring a cooler bag for peak freshness.</li>
                <li>Ask which batches are newest this week.</li>
              </ul>
              <a className="button button--light" href="#shop">
                Reserve A Jar
              </a>
            </div>
          </div>
        </section>

        <section id="join-email" className="section section--compact section--plain email-cta">
          <div className="email-cta__shell js-reveal" style={{ "--reveal-delay": "170ms" }}>
            <p className="eyebrow">Stay Updated</p>
            <h2>Join our email list.</h2>
            <p>
              Get new batch drops, seasonal flavor releases, and Saturday pickup reminders.
            </p>
            <EmailSignupForm source="homepage_join_email" />
          </div>
        </section>

        <section id="founder" className="about-hero">
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

        <section id="faq" className="section section--compact section--plain faq">
          <div className="faq__shell js-reveal" style={{ "--reveal-delay": "180ms" }}>
            <div className="faq__intro">
              <p className="eyebrow">FAQ</p>
              <h2>Quick answers before you place your first order.</h2>
            </div>
            <div className="faq__list">
              {faqs.map((item) => (
                <details key={item.q}>
                  <summary>{item.q}</summary>
                  <p>{item.a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div>
          <h3 className="footer__brand">
            <Image src="/logo.svg" alt="Vida Verde logo" width={32} height={32} />
            <span>Vida Verde</span>
          </h3>
          <p>Live fermented sauerkraut and hot sauce for daily nourishment.</p>
        </div>
        <div className="footer__meta">
          <span>{marketAddress}</span>
          <span>Every Saturday, 9:00 AM - 1:00 PM</span>
          <span>hello@vidaverde.com</span>
        </div>
      </footer>
    </>
  );
}
