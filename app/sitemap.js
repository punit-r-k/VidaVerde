import { getCanonicalUrl } from "@/lib/siteMetadata";

const ROUTES = [
  {
    path: "/",
    changeFrequency: "weekly",
    priority: 1
  },
  {
    path: "/about",
    changeFrequency: "monthly",
    priority: 0.8
  },
  {
    path: "/privacy-policy",
    changeFrequency: "monthly",
    priority: 0.5
  },
  {
    path: "/accessibility-statement",
    changeFrequency: "monthly",
    priority: 0.5
  }
];

export default function sitemap() {
  const lastModified = new Date();

  return ROUTES.map((route) => ({
    url: getCanonicalUrl(route.path),
    lastModified,
    changeFrequency: route.changeFrequency,
    priority: route.priority
  }));
}
