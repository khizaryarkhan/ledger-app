/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  experimental: {
    serverActions: { allowedOrigins: ["*"] }
  },
  serverExternalPackages: ["openai"],
};

// Only wrap with Sentry's build plugin when a DSN is configured, so the build
// is completely unchanged (zero risk) until you opt in by setting SENTRY_DSN.
// Source-map upload runs only when SENTRY_AUTH_TOKEN is also set; without it
// the build still succeeds (upload is skipped).
if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const { withSentryConfig } = require("@sentry/nextjs");
  module.exports = withSentryConfig(nextConfig, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: true,
    widenClientFileUpload: true,
    disableLogger: true,
  });
} else {
  module.exports = nextConfig;
}
