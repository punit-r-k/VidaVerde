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
            Eight years ago, a personal challenge changed everything. Our
            founder began making small-batch sauerkraut at home to help his wife
            recover from serious digestive issues and a weakened immune system.
            When she could not tolerate the smell or intensity of classic kraut,
            he started blending cabbage with fresh vegetables, herbs, and spices,
            fermenting only in natural juices with no added water. The results
            delivered a flavorful, truly live food that transformed their daily
            health.
          </p>
        </div>
      </header>

      <main>
        <section className="section about">
          <div className="about__grid">
            <div>
              <h2>From a family challenge to a living mission.</h2>
              <p>
                The turning point came when those new blends made sauerkraut
                approachable and deeply nourishing. His wife began eating it
                daily, her digestion improved, and her immune system grew
                stronger. That success proved traditional fermentation could be
                both functional and delicious for modern palates.
              </p>
              <p>
                For the past five years he has supported his family by selling
                these jars at farmers markets and natural food stores across
                Houston, producing tons by hand and witnessing positive health
                transformations for thousands of customers. Now Vida Verde is
                moving online to expand access to gut and mental health through
                real, living food.
              </p>
              <h3>Default dietary profile</h3>
              <ul>
                <li>Gluten-free</li>
                <li>Dairy-free</li>
                <li>Nut-free</li>
                <li>Soy-free</li>
                <li>Egg-free</li>
              </ul>
              <h3>Who we serve</h3>
              <ul>
                <li>
                  Primary buyers (30-55): focused on gut health, immunity, and
                  long-term wellness.
                </li>
                <li>
                  Secondary buyers (55-70): health-driven, loyal, and drawn to
                  natural solutions and tradition.
                </li>
                <li>
                  Emerging segment (23-35): wellness trends, gut-brain
                  connection, and flavor exploration.
                </li>
                <li>Low priority: under 23 due to limited purchasing power.</li>
              </ul>
              <p>
                <strong>Ideal online customer:</strong> 35-50, urban or
                suburban, middle to upper-middle income, and motivated by
                transparency, real food, and results.
              </p>
            </div>
            <div className="about__panel">
              <div className="about__portrait">
                <img
                  src="https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=600&q=80"
                  alt="Vida Verde founder portrait"
                  loading="lazy"
                />
              </div>
              <h3>Founder Principles</h3>
              <ul>
                <li>Fermented in natural vegetable juices with no added water.</li>
                <li>Never pasteurized so live cultures stay active.</li>
                <li>Balanced flavors from fresh vegetables, herbs, and spices.</li>
                <li>Traditional methods, crafted for a modern palate.</li>
              </ul>
              <div className="about__card">
                <p>
                  "This is not just a product. It is a real story, lived, tested,
                  and proven."
                </p>
                <span>Vida Verde Founder</span>
              </div>
            </div>
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
