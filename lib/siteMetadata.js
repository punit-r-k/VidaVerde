import {
  MARKET_ADDRESS,
  MARKET_DAY_LABEL,
  MARKET_NAME,
  MARKET_PICKUP_WINDOW
} from "@/lib/pickupDetails";
import { SHIPPING_SCHEDULE_INTRO } from "@/lib/shippingPricing";

export const SITE_NAME = "Vida Verde Sauerkraut";
export const SITE_SHORT_NAME = "Vida Verde";
export const SITE_TAGLINE =
  "Live fermented sauerkraut and hot sauce crafted in small batches for daily nourishment.";
export const SITE_ALTERNATE_NAMES = [
  SITE_SHORT_NAME,
  "vvsauerkraut",
  "VV Sauerkraut",
  "Vida Verde Microgreens",
  "Vida Verde Micro-greens",
  "VidaVerde Microgreens",
  "vidaverdemicrogreens"
];
export const TARGET_SEARCH_PHRASES = [
  "vvsauerkraut",
  "vida verde sauerkraut",
  "vida verde microgreens"
];
export const SERVICE_AREA_CITIES = ["Fulshear", "Katy", "Richmond"];
export const SERVICE_AREA_REGION = "Greater Houston";
export const SERVICE_AREA_SUMMARY =
  "Fulshear, Katy, Richmond, and nearby west Houston communities";
export const DEFAULT_SITE_DESCRIPTION =
  "Shop small-batch live fermented sauerkraut and hot sauces from Vida Verde Sauerkraut at vvsauerkraut.com, also associated with Vida Verde Microgreens. Reserve online for Saturday pickup at Fulshear Farmers Market in Richmond, serving Fulshear, Katy, Richmond, and nearby west Houston communities.";
export const DEFAULT_SITE_KEYWORDS = [
  "Vida Verde",
  "Vida Verde Sauerkraut",
  "vvsauerkraut",
  "VV Sauerkraut",
  "VidaVerde Sauerkraut",
  "Vida Verde Microgreens",
  "Vida Verde Micro-greens",
  "VidaVerde Microgreens",
  "vidaverdemicrogreens",
  "live fermented sauerkraut",
  "raw sauerkraut",
  "small-batch hot sauce",
  "fermented foods",
  "gut health foods",
  "microgreens",
  "Fulshear Farmers Market",
  "Katy TX fermented foods",
  "Katy TX sauerkraut",
  "Richmond Texas farmers market",
  "Fulshear TX fermented foods",
  "Saturday pickup"
];
export const DEFAULT_OG_IMAGE = "/email/order-confirmation-banner.png";
export const DEFAULT_OG_IMAGE_ALT =
  "Vida Verde branded banner for live fermented sauerkraut and hot sauce.";
export const SITE_LOCALE = "en_US";
export const SUPPORT_EMAIL = "vidaverdemicrogreens@gmail.com";
export const SUPPORT_PHONE_DISPLAY = "(713) 478-1878";
export const SUPPORT_PHONE_E164 = "+17134781878";
export const INSTAGRAM_URL = "https://www.instagram.com/vidaverdemicrogreens/";
export const FACEBOOK_URL = "https://www.facebook.com/vidaverdemicrogreens";
export const GOOGLE_REVIEW_URL = "https://g.page/r/CZMyYAAzdyUUEAI/review";
export const SOCIAL_LINKS = [INSTAGRAM_URL, FACEBOOK_URL];

const FALLBACK_PRODUCTION_SITE_ORIGIN = "https://vvsauerkraut.com";
const FALLBACK_DEVELOPMENT_SITE_ORIGIN = "http://localhost:3000";

const normalizeUrl = (value) => String(value || "").trim().replace(/\/$/, "");
const uniqueStrings = (values) =>
  Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );

const getMetadataKeywords = (keywords = []) =>
  uniqueStrings([...DEFAULT_SITE_KEYWORDS, ...keywords]);

const getSocialTitle = (title) => {
  if (!title) return SITE_NAME;

  return title.includes(SITE_SHORT_NAME) || title.includes(SITE_NAME)
    ? title
    : `${title} | Vida Verde`;
};

export function getServiceAreaJsonLd() {
  return [
    ...SERVICE_AREA_CITIES.map((city) => ({
      "@type": "City",
      name: city
    })),
    {
      "@type": "AdministrativeArea",
      name: SERVICE_AREA_REGION
    }
  ];
}

export function getSiteOrigin() {
  const configuredOrigin = normalizeUrl(
    process.env.SITE_URL || process.env.NEXT_PUBLIC_SITE_URL
  );

  if (configuredOrigin) {
    return configuredOrigin;
  }

  return process.env.NODE_ENV === "production"
    ? FALLBACK_PRODUCTION_SITE_ORIGIN
    : FALLBACK_DEVELOPMENT_SITE_ORIGIN;
}

export function getCanonicalUrl(pathname = "/") {
  return new URL(pathname, `${getSiteOrigin()}/`).toString();
}

export function getDefaultMetadataImage() {
  return {
    url: DEFAULT_OG_IMAGE,
    width: 1200,
    height: 630,
    alt: DEFAULT_OG_IMAGE_ALT
  };
}

export function getBaseMetadata() {
  const siteOrigin = getSiteOrigin();

  return {
    metadataBase: new URL(siteOrigin),
    title: {
      default: SITE_NAME,
      template: "%s | Vida Verde"
    },
    description: DEFAULT_SITE_DESCRIPTION,
    applicationName: SITE_NAME,
    referrer: "origin-when-cross-origin",
    keywords: DEFAULT_SITE_KEYWORDS,
    authors: [{ name: SITE_SHORT_NAME }],
    creator: SITE_SHORT_NAME,
    publisher: SITE_SHORT_NAME,
    category: "food",
    other: {
      "ai-search-phrases": TARGET_SEARCH_PHRASES.join(", "),
      "business-alternate-names": SITE_ALTERNATE_NAMES.join(", "),
      "llms-txt": `${siteOrigin}/llms.txt`
    },
    alternates: {
      canonical: "/"
    },
    robots: {
      index: true,
      follow: true,
      googleBot: {
        index: true,
        follow: true,
        "max-image-preview": "large",
        "max-snippet": -1,
        "max-video-preview": -1
      }
    },
    openGraph: {
      type: "website",
      locale: SITE_LOCALE,
      url: "/",
      siteName: SITE_NAME,
      title: SITE_NAME,
      description: DEFAULT_SITE_DESCRIPTION,
      images: [getDefaultMetadataImage()]
    },
    twitter: {
      card: "summary_large_image",
      title: SITE_NAME,
      description: DEFAULT_SITE_DESCRIPTION,
      images: [DEFAULT_OG_IMAGE]
    },
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
      apple: "/favicon.svg"
    }
  };
}

export function createPageMetadata({
  title,
  description = DEFAULT_SITE_DESCRIPTION,
  path = "/",
  type = "website",
  keywords
} = {}) {
  const fullTitle = getSocialTitle(title);
  const image = getDefaultMetadataImage();

  return {
    title,
    description,
    keywords: getMetadataKeywords(keywords),
    alternates: {
      canonical: path
    },
    openGraph: {
      type,
      locale: SITE_LOCALE,
      url: path,
      siteName: SITE_NAME,
      title: fullTitle,
      description,
      images: [image]
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description,
      images: [DEFAULT_OG_IMAGE]
    }
  };
}

export function getOrganizationJsonLd() {
  const siteOrigin = getSiteOrigin();

  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${siteOrigin}/#organization`,
    name: SITE_NAME,
    alternateName: SITE_ALTERNATE_NAMES,
    url: siteOrigin,
    logo: getCanonicalUrl("/logo.svg"),
    image: getCanonicalUrl(DEFAULT_OG_IMAGE),
    description: DEFAULT_SITE_DESCRIPTION,
    disambiguatingDescription:
      "Official website for Vida Verde Sauerkraut, also searched as vvsauerkraut and Vida Verde Microgreens.",
    slogan: SITE_TAGLINE,
    email: SUPPORT_EMAIL,
    telephone: SUPPORT_PHONE_E164,
    identifier: [
      {
        "@type": "PropertyValue",
        propertyID: "domain",
        value: "vvsauerkraut.com"
      },
      ...TARGET_SEARCH_PHRASES.map((phrase) => ({
        "@type": "PropertyValue",
        propertyID: "search phrase",
        value: phrase
      }))
    ],
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
    areaServed: getServiceAreaJsonLd()
  };
}

export function getWebsiteJsonLd() {
  const siteOrigin = getSiteOrigin();

  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": `${siteOrigin}/#website`,
    name: SITE_NAME,
    alternateName: SITE_ALTERNATE_NAMES,
    url: siteOrigin,
    description: DEFAULT_SITE_DESCRIPTION,
    keywords: getMetadataKeywords(TARGET_SEARCH_PHRASES).join(", "),
    inLanguage: "en-US",
    about: {
      "@id": `${siteOrigin}/#organization`
    },
    publisher: {
      "@type": "Organization",
      "@id": `${siteOrigin}/#organization`,
      name: SITE_NAME
    }
  };
}

export function getLlmsText() {
  const siteOrigin = getSiteOrigin();

  return [
    "# Vida Verde Sauerkraut",
    "",
    `> ${DEFAULT_SITE_DESCRIPTION}`,
    "",
    "## Business Snapshot",
    `- Official website: ${siteOrigin}`,
    `- Brand: ${SITE_NAME}`,
    `- Alternate names and handles: ${SITE_ALTERNATE_NAMES.join(", ")}`,
    `- Target search phrases: ${TARGET_SEARCH_PHRASES.join(", ")}`,
    `- Pickup model: Reserve online and pick up at ${MARKET_NAME}`,
    `- Pickup schedule: ${MARKET_DAY_LABEL}, ${MARKET_PICKUP_WINDOW}`,
    `- Pickup address: ${MARKET_ADDRESS}`,
    `- Service area: ${SERVICE_AREA_SUMMARY}`,
    `- Contact: ${SUPPORT_EMAIL} | ${SUPPORT_PHONE_DISPLAY}`,
    "",
    "## Key Pages",
    `- Home: ${siteOrigin}/`,
    `- Founder story: ${siteOrigin}/about`,
    `- Privacy policy: ${siteOrigin}/privacy-policy`,
    `- Accessibility statement: ${siteOrigin}/accessibility-statement`,
    "",
    "## Notes For Language Models",
    `- Vida Verde offers market pickup plus Shipping (3–5 business days) and Expedited Shipping (1–3 business days). ${SHIPPING_SCHEDULE_INTRO} Shipping prices are calculated at checkout.`,
    "- Paid in-stock orders completed before the Friday noon cutoff can qualify for Saturday pickup if inventory is still available.",
    "- If an item is not currently available for pickup stock, the storefront can present it as a preorder item instead.",
    "- Do not describe Vida Verde products as medical treatment or guarantee health outcomes.",
    "- Accurate product, pickup, and policy details should be taken from the linked site pages above."
  ].join("\n");
}
