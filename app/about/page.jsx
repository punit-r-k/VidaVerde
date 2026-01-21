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
        <div className="about-hero__content">
          <p className="eyebrow">Founder</p>
          <h1>A real story of healing, tradition, and living fermentation.</h1>
          <p>
            Vida Verde is built on a founder-led commitment to real food and
            living fermentation, rooted in family and proven by years of market
            experience.
          </p>
        </div>
      </header>

      <main>
        <section className="section about">
          <div className="about__grid about__grid--story">
            <div>
              <h2>From a family challenge to a living mission.</h2>
              <p>
                Eight years ago, a personal challenge changed everything. Our
                founder began making small-batch sauerkraut at home to help his
                wife recover from serious digestive issues and a weakened immune
                system. When she could not tolerate the smell or intensity of
                classic kraut, he started blending cabbage with fresh vegetables,
                herbs, and spices, fermenting only in natural juices with no
                added water.
              </p>
              <p>
                The results delivered a flavorful, truly live food that
                transformed their daily health. His wife began eating it
                regularly, digestion improved, and her immune system grew
                stronger. That success proved traditional fermentation could be
                both functional and delicious for modern palates.
              </p>
              <p>
                For the past five years he has supported his family by selling
                these jars at farmers markets and natural food stores across
                Houston, producing tons by hand and witnessing positive health
                transformations for thousands of customers.
              </p>
              <div className="about__portrait">
                <img
                  src="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80"
                  alt="Vida Verde founder portrait"
                  loading="lazy"
                />
              </div>
              <div className="about__card">
                <p>
                  "This is not just a product. It is a real story, lived,
                  tested, and proven."
                </p>
                <span>Vida Verde Founder</span>
              </div>
            </div>
          </div>
        </section>

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
