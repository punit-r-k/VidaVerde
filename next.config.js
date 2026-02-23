/** @type {import("next").NextConfig} */
const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

module.exports = (phase) => {
  const isDevServer = phase === PHASE_DEVELOPMENT_SERVER;

  return {
    reactStrictMode: true,
    distDir: isDevServer ? ".next-dev" : ".next",
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
};
