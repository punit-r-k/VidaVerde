import { DEFAULT_OG_IMAGE, getCanonicalUrl } from "@/lib/siteMetadata";

const ROUTES = [
  {
    path: "/",
    changeFrequency: "weekly",
    priority: 1,
    images: [DEFAULT_OG_IMAGE, "/founder-photo.avif", "/hero-poster.avif"]
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
  return ROUTES.map((route) => ({
    url: getCanonicalUrl(route.path),
    changeFrequency: route.changeFrequency,
    priority: route.priority,
    ...(route.images
      ? { images: route.images.map((image) => getCanonicalUrl(image)) }
      : {})
  }));
}
