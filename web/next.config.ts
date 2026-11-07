import type { NextConfig } from "next";

const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const apiOrigin = new URL(apiUrl).origin;
const wsOrigin = apiOrigin.replace(/^http/, "ws");

// Inline styles and scripts are needed by Next.js hydration; eval only benefits dev tooling.
const contentSecurityPolicy = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://images.unsplash.com https://tile.openstreetmap.org",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self'",
  `connect-src 'self' ${apiOrigin} ${wsOrigin}`,
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: `${contentSecurityPolicy};` },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  devIndicators: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/photo-**",
      },
    ],
  },
};

export default nextConfig;
