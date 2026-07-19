import type { NextConfig } from "next";

/**
 * Security headers applied to all responses.
 * Content-Security-Policy is set in report-only mode to avoid breaking
 * third-party scripts while still surfacing violations.
 */
const SECURITY_HEADERS = [
  // Prevent MIME-type sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Deny framing from other origins (clickjacking protection)
  { key: "X-Frame-Options", value: "DENY" },
  // Enable XSS filter in legacy browsers
  { key: "X-XSS-Protection", value: "1; mode=block" },
  // Restrict referrer info sent to third parties
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Permissions policy — deny microphone/camera access by default
  // (voice features request permissions explicitly via getUserMedia)
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(self), geolocation=()",
  },
  // Content Security Policy — restricts resource origins
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Allow Next.js inline scripts (RSC + hydration)
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
      // Allow Google Fonts and local styles
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Allow Google Fonts font files
      "font-src 'self' https://fonts.gstatic.com",
      // Allow images from same origin and data URIs
      "img-src 'self' data: blob:",
      // Allow API calls to Python agent and OpenAI (for client-side calls if any)
      "connect-src 'self' http://localhost:8000 https://api.openai.com",
      // Disallow framing
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply security headers to all routes
        source: "/:path*",
        headers: SECURITY_HEADERS,
      },
    ];
  },
};

export default nextConfig;
