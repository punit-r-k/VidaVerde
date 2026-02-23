import "./globals.css";
import { Fraunces, Sora } from "next/font/google";

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

export const metadata = {
  title: "Vida Verde | Live Fermented Foods",
  description:
    "Live fermented sauerkraut and hot sauce crafted in small batches for daily gut nourishment."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${fraunces.variable} ${sora.variable}`}>
      <body>{children}</body>
    </html>
  );
}
