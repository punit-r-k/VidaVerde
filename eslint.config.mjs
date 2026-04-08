import nextVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextVitals,
  {
    ignores: ["apps-script/**", ".next-dev/**"]
  }
];

export default config;
