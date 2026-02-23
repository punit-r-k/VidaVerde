/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx,mdx}",
    "./lib/**/*.{js,jsx,ts,tsx,mdx}"
  ],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-fraunces)", "serif"],
        sans: ["var(--font-sora)", "sans-serif"]
      }
    }
  },
  plugins: []
};
