import SiteHeader from "../components/SiteHeader";

export const metadata = {
  title: "Founder | Vida Verde",
  description:
    "Meet the founder behind Vida Verde and the mission to bring plant-forward nourishment home."
};

export default function AboutPage() {
  return (
    <>
      <header className="about-hero">
        <SiteHeader variant="solid" />
        <div className="about-hero__content">
          <p className="eyebrow">Founder</p>
          <h1>Rooted in fresh plants, guided by fermentation.</h1>
          <p>
            Vida Verde began as a small microgreen garden and grew into a
            fermentary focused on gut health. Our founder blends culinary craft
            with nutrition science to create jars that feel both premium and
            deeply nourishing.
          </p>
        </div>
      </header>

      <main>
        <section className="section about">
          <div className="about__grid">
            <div>
              <h2>From backyard microgreens to a premium fermentary.</h2>
              <p>
                The founder started by growing microgreens for family tables,
                then began fermenting small cabbage batches to preserve the
                harvest. The results were crisp, aromatic, and full of live
                cultures. That experiment sparked the Vida Verde line you see
                today.
              </p>
              <p>
                Every jar is rooted in the belief that daily nourishment should
                be beautiful, intentional, and plant-forward. We partner with
                local growers, harvest in small lots, and ferment with patience.
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
                <li>Microgreens in every batch for freshness and vitality.</li>
                <li>Slow fermentation to keep cultures alive and active.</li>
                <li>Clean ingredients, no added sugar or fillers.</li>
                <li>Premium quality with transparent sourcing.</li>
              </ul>
              <div className="about__card">
                <p>
                  "We want to bring fresh, gut-healthy nourishment into homes,
                  one jar at a time."
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
