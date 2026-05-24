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
  serverExternalPackages: ["groq-sdk", "pdfkit"],
};

module.exports = nextConfig;
