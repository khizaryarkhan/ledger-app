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
  // Serve the Prime Accountax marketing site (in public/) as the homepage.
  async rewrites() {
    return [{ source: "/", destination: "/index.html" }];
  },
};

module.exports = nextConfig;
