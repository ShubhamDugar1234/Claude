import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output gives a small self-contained server for the Docker image.
  output: "standalone",
  poweredByHeader: false,
  // Cache Components is off on purpose: almost every page depends on who is signed in, and
  // limits/pauses must apply immediately, so every page renders fresh on each request.
  // Security headers on every response (pages and API). The CSP is added per request in src/proxy.ts.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          ...(process.env.NODE_ENV === "production" && process.env.APP_URL?.startsWith("https://")
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
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
