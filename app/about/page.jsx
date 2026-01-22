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
      </main>

      <footer className="footer">
        <div>
          <h3 className="footer__brand">
            <img src="/logo.svg" alt="Vida Verde logo" />
            <span>Vida Verde</span>
          </h3>
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
