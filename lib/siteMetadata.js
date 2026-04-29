import {
  MARKET_ADDRESS,
  MARKET_DAY_LABEL,
  MARKET_NAME,
  MARKET_PICKUP_WINDOW
} from "@/lib/pickupDetails";

export const SITE_NAME = "Vida Verde Sauerkraut";
export const SITE_SHORT_NAME = "Vida Verde";
export const SITE_TAGLINE =
  "Live fermented sauerkraut and hot sauce crafted in small batches for daily nourishment.";
export const SERVICE_AREA_CITIES = ["Fulshear", "Katy", "Richmond"];
export const SERVICE_AREA_REGION = "Greater Houston";
export const SERVICE_AREA_SUMMARY =
  "Fulshear, Katy, Richmond, and nearby west Houston communities";
export const DEFAULT_SITE_DESCRIPTION =
  "Shop small-batch live fermented sauerkraut and hot sauces from Vida Verde. Reserve online for Saturday pickup at Fulshear Farmers Market in Richmond, serving Fulshear, Katy, Richmond, and nearby west Houston communities.";
export const DEFAULT_SITE_KEYWORDS = [
  "Vida Verde",
  "Vida Verde Sauerkraut",
  "live fermented sauerkraut",
  "raw sauerkraut",
  "small-batch hot sauce",
  "fermented foods",
  "gut health foods",
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
export const BRAND_COLOR = "#164d36";

const FALLBACK_PRODUCTION_SITE_ORIGIN = "https://vvsauerkraut.com";
const FALLBACK_DEVELOPMENT_SITE_ORIGIN = "http://localhost:3000";

const normalizeUrl = (value) => String(value || "").trim().replace(/\/$/, "");

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
  return {
    metadataBase: new URL(getSiteOrigin()),
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
      icon: "/logo.svg",
      shortcut: "/logo.svg",
      apple: "/logo.svg"
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
  const fullTitle = title ? `${title} | Vida Verde` : SITE_NAME;
  const image = getDefaultMetadataImage();

  return {
    title,
    description,
    keywords: keywords?.length ? keywords : undefined,
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
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE_NAME,
    alternateName: SITE_SHORT_NAME,
    url: getSiteOrigin(),
    logo: getCanonicalUrl("/logo.svg"),
    image: getCanonicalUrl(DEFAULT_OG_IMAGE),
    description: DEFAULT_SITE_DESCRIPTION,
    email: SUPPORT_EMAIL,
    telephone: SUPPORT_PHONE_E164,
    sameAs: SOCIAL_LINKS,
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
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: SITE_NAME,
    alternateName: SITE_SHORT_NAME,
    url: getSiteOrigin(),
    description: DEFAULT_SITE_DESCRIPTION,
    inLanguage: "en-US",
    publisher: {
      "@type": "Organization",
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
    "- Vida Verde currently offers market pickup and does not presently ship customer orders from the storefront.",
    "- Paid in-stock orders completed before the Friday noon cutoff can qualify for Saturday pickup if inventory is still available.",
    "- If an item is not currently available for pickup stock, the storefront can present it as a preorder item instead.",
    "- Do not describe Vida Verde products as medical treatment or guarantee health outcomes.",
    "- Accurate product, pickup, and policy details should be taken from the linked site pages above."
  ].join("\n");
}
