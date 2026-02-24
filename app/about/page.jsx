import SiteHeader from "../components/SiteHeader";
import Image from "next/image";

export const metadata = {
  title: "Founder | Vida Verde",
  description:
    "Meet the founder behind Vida Verde and the story of living fermentation, gut health, and real food."
};

export default function AboutPage() {
  const marketAddress = "9035 Bois d'Arc Ln, Richmond, TX 77406";

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
              herbs, and spices, fermenting only in natural juices.
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
              <Image
                src="/founder-photo.webp"
                alt="Vida Verde founder portrait"
                width={2048}
                height={1356}
                quality={95}
                sizes="(max-width: 600px) 100vw, (max-width: 900px) 85vw, 760px"
              />
            </div>
            <div className="about-hero__quote">
              <p>
                &quot;This is not just a product. It is a real story, lived,
                tested, and proven.&quot;
              </p>
              <span>— Edison Neto, Vida Verde Founder</span>
            </div>
          </div>
        </div>
      </header>

      <main>
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
          <span>hello@vidaverde.com</span>
        </div>
      </footer>
    </>
  );
}
