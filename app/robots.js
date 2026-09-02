import { getSiteOrigin } from "@/lib/siteMetadata";

const AI_CRAWLER_USER_AGENTS = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "Google-Extended",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "PerplexityBot",
  "Perplexity-User",
  "Amazonbot",
  "Applebot-Extended",
  "Bytespider",
  "CCBot",
  "cohere-ai",
  "Meta-ExternalAgent"
];

export default function robots() {
  const siteOrigin = getSiteOrigin();

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/"
      },
      ...AI_CRAWLER_USER_AGENTS.map((userAgent) => ({
        userAgent,
        allow: "/"
      }))
    ],
    sitemap: `${siteOrigin}/sitemap.xml`,
    host: siteOrigin
  };
}
