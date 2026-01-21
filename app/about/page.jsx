import SiteHeader from "../components/SiteHeader";

export const metadata = {
  title: "Founder | Vida Verde",
  description:
    "Meet the founder behind Vida Verde and the story of living fermentation, gut health, and real food."
};

export default function AboutPage() {
  return (
    <>
      <header className="about-hero">
        <SiteHeader variant="solid" />
        <div className="about-hero__grid">
          <div className="about-hero__copy">
            <p className="eyebrow">Founder</p>
            <h1>A real story of healing, tradition, and living fermentation.</h1>
            <p>
              Eight years ago, a personal challenge changed everything. Our
              founder began making small-batch sauerkraut at home to help his
              wife recover from serious digestive issues and a weakened immune
              system. When she could not tolerate the smell or intensity of
              classic kraut, he started blending cabbage with fresh vegetables,
              herbs, and spices, fermenting only in natural juices with no added
              water.
            </p>
            <p>
              The results were a flavorful, truly live food that she could enjoy
              daily. Over time her digestion improved and her immune system grew
              stronger. For five years he supported his family at farmers
              markets and natural food stores across Houston, producing tons by
              hand and witnessing thousands of customer transformations.
            </p>
            <div className="about-hero__stats">
              <div>
                <strong>8 years</strong>
                <span>Family fermentation</span>
              </div>
              <div>
                <strong>5 years</strong>
                <span>Market tested</span>
              </div>
              <div>
                <strong>Thousands</strong>
                <span>Customers served</span>
              </div>
            </div>
          </div>
          <div className="about-hero__media">
            <div className="about__portrait about-hero__portrait">
              <img
                src="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=700&q=80"
                alt="Vida Verde founder portrait"
                loading="lazy"
              />
            </div>
            <div className="about-hero__quote">
              <p>
                "This is not just a product. It is a real story, lived, tested,
                and proven."
              </p>
              <span>Vida Verde Founder</span>
            </div>
          </div>
        </div>
      </header>

      <main>
        <section className="section about about--goals">
          <div className="about__grid about__grid--goals">
            <div>
              <p className="eyebrow">Founder Goals</p>
              <h2>Growing access to gut health through real, living food.</h2>
              <p>
                The mission is to expand the reach of traditional fermentation
                while keeping every jar honest, functional, and crafted with
                care.
              </p>
            </div>
            <ul className="about__goals" aria-label="Founder goals">
              <li className="about__goal">
                <span className="about__goal-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path
                      d="M12 3v18M5 8c4-4 10-4 14 0M7 16c3 3 7 3 10 0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div>
                  <strong>Expand online access</strong>
                  <span>Bring live fermentation beyond the market tent.</span>
                </div>
              </li>
              <li className="about__goal">
                <span className="about__goal-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <rect
                      x="7"
                      y="6"
                      width="10"
                      height="14"
                      rx="2"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M9 4h6"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div>
                  <strong>Protect the process</strong>
                  <span>No added water, never pasteurized.</span>
                </div>
              </li>
              <li className="about__goal">
                <span className="about__goal-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <path
                      d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2 4 4 0 0 1 7 2c0 5.5-7 10-7 10z"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                  </svg>
                </span>
                <div>
                  <strong>Support daily wellness</strong>
                  <span>Functional jars for gut and mental health.</span>
                </div>
              </li>
              <li className="about__goal">
                <span className="about__goal-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">
                    <circle
                      cx="12"
                      cy="8"
                      r="3"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                    />
                    <path
                      d="M5 20c1.5-3.5 12.5-3.5 14 0"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                    />
                  </svg>
                </span>
                <div>
                  <strong>Serve the community</strong>
                  <span>Local roots, clear education, honest sourcing.</span>
                </div>
              </li>
            </ul>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div>
          <h3>Vida Verde</h3>
          <p>Premium sourkrout and microgreen nourishment.</p>
        </div>
        <div className="footer__meta">
          <span>Fulshear, TX</span>
          <span>hello@vidaverde.com</span>
        </div>
      </footer>
    </>
  );
}
