import "./globals.css";
import { Fraunces, Sora } from "next/font/google";
import { Suspense } from "react";
import AnalyticsRuntime from "./components/AnalyticsRuntime";
import {
  getBaseMetadata,
  getOrganizationJsonLd,
  getWebsiteJsonLd
} from "@/lib/siteMetadata";

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap"
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  display: "swap"
});

export const metadata = getBaseMetadata();

export default function RootLayout({ children }) {
  const organizationJsonLd = getOrganizationJsonLd();
  const websiteJsonLd = getWebsiteJsonLd();

  return (
    <html lang="en" className={`${fraunces.variable} ${sora.variable}`}>
      <head>
        <link rel="alternate" type="text/markdown" href="/llms.txt" />
        <link rel="describedby" href="/llms.txt" />
      </head>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(organizationJsonLd)
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(websiteJsonLd)
          }}
        />
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <Suspense fallback={null}>
          <AnalyticsRuntime />
        </Suspense>
        {children}
      </body>
    </html>
  );
}
