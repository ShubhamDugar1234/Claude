import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output gives a small self-contained server for the Docker image.
  output: "standalone",
  poweredByHeader: false,
  // Cache Components is off on purpose: almost every page depends on who is signed in, and
  // limits/pauses must apply immediately, so every page renders fresh on each request.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
