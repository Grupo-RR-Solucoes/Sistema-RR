const path = require("path");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias["@"] = path.resolve(__dirname);
    return config;
  },
  // Rename Forecast -> Recebiveis: cobre bookmarks salvos da rota antiga sem 404.
  // permanent:false (307) — rename interno, nao SEO; nao queremos cache permanente.
  async redirects() {
    return [
      { source: "/forecast", destination: "/recebiveis", permanent: false },
      { source: "/api/forecast", destination: "/api/recebiveis", permanent: false },
    ];
  },
};

module.exports = nextConfig;
