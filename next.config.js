/** @type {import("next").NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com"
      }
    ]
  },
  webpack: (config, { dev }) => {
    if (dev) {
      // Avoid intermittent filesystem cache corruption on synced folders.
      config.cache = false;
    }
    return config;
  }
};

module.exports = nextConfig;
