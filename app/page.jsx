import SiteHeader from "./components/SiteHeader";
import Storefront from "./components/Storefront";
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

  const basePrice = products[0]?.priceCents
    ? `$${(products[0].priceCents / 100).toFixed(2)}`
    : "$11.99";

  return (
    <>
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
        <SiteHeader />
        <div className="hero__content">
          <p className="eyebrow reveal" style={{ "--delay": "0.1s" }}>
            Premium sourkrout for gut health
          </p>
          <h1 className="reveal" style={{ "--delay": "0.2s" }}>
            Plant-centered fermentation, ready for your table.
          </h1>
          <p className="hero__subhead reveal" style={{ "--delay": "0.3s" }}>
            Six small-batch sourkrout jars, each finished with microgreen
            infusions and botanical aromatics. Every jar is {basePrice} plus shipping,
            with live stock synced from our cellar sheet.
          </p>
          <div className="hero__actions reveal" style={{ "--delay": "0.4s" }}>
            <a className="button button--light" href="#shop">
              Shop The Jars
            </a>
            <a className="button button--ghost" href="#market">
              Find Us In Fulshear
            </a>
          </div>
          <div className="hero__metrics reveal" style={{ "--delay": "0.5s" }}>
            <div>
              <span>6</span>
              <small>Signature jars</small>
            </div>
            <div>
              <span>100%</span>
              <small>Live cultures</small>
            </div>
            <div>
              <span>0</span>
              <small>Added sugar</small>
            </div>
          </div>
        </div>
        <div className="hero__scroll">Scroll</div>
      </header>

      <main>
        <section id="shop" className="section shop">
          <div className="section__intro">
            <p className="eyebrow">The Collection</p>
            <h2>Six sourkrout profiles, each built for daily nourishment.</h2>
            <p>
              Fresh microgreens, slow fermentation, and premium ingredients make
              each jar a daily ritual. Stock levels update in real time and
              preorders open automatically when jars sell out.
            </p>
          </div>
          <Storefront products={products} inventory={inventory} />
        </section>

        <section id="market" className="section market">
          <div className="market__grid">
            <div>
              <p className="eyebrow">Fulshear Farmers Market</p>
              <h2>Find Vida Verde in person.</h2>
              <p>
                Pick up your jars at the Fulshear Farmers Market, or meet the
                team for weekly seasonal drops.
              </p>
              <div className="market__details">
                <div>
                  <strong>When</strong>
                  <span>Saturday, 9:00 AM - 1:00 PM</span>
                </div>
                <div>
                  <strong>Where</strong>
                  <span>Fulshear Farmers Market, TX</span>
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
                <li>Preorders are held for 48 hours.</li>
                <li>Bring a cooler bag for peak freshness.</li>
                <li>Ask about our seasonal microgreen bundles.</li>
              </ul>
              <a className="button button--dark" href="#shop">
                Reserve A Jar
              </a>
            </div>
          </div>
        </section>

        <section className="section story">
          <div className="story__grid">
            <div>
              <p className="eyebrow">Rooted In Plants</p>
              <h2>Microgreens, minerals, and fermentation in harmony.</h2>
              <p>
                Vida Verde exists to bring fresh, gut-healthy nourishment into
                the homes of our community. Each jar blends farm-grown
                microgreens with slow-fermented cabbage to support digestion,
                energy, and everyday wellness.
              </p>
              <a className="text-link" href="/about">
                Read the founder story
              </a>
            </div>
            <div className="story__panel">
              <h3>Why We Ferment</h3>
              <p>
                We nurture every batch for 18 to 35 days to develop probiotics
                naturally, without shortcuts or heat processing. The result is a
                premium, live-culture product that stays crisp and vibrant.
              </p>
              <div className="story__stats">
                <div>
                  <strong>18-35</strong>
                  <span>Day ferments</span>
                </div>
                <div>
                  <strong>6</strong>
                  <span>Microgreen blends</span>
                </div>
                <div>
                  <strong>100%</strong>
                  <span>Cold processed</span>
                </div>
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
