import type { MetadataRoute } from "next";

const SITE_URL = "https://primeaccountax.com";

/**
 * robots.txt
 * - Allow general crawlers to index public marketing pages.
 * - Explicitly welcome AI / answer-engine crawlers (ChatGPT, Claude, Perplexity,
 *   Google-Extended, Apple) so the product can surface in AI search results.
 * - Keep the authenticated app and API out of the index.
 */
export default function robots(): MetadataRoute.Robots {
  const disallow = [
    "/api/",
    "/dashboard",
    "/settings",
    "/invoices",
    "/customers",
    "/reports",
    "/smart-views",
    "/tasks",
    "/automations",
    "/board",
    "/rep-portal",
    "/portal/",
  ];

  return {
    rules: [
      { userAgent: "*", allow: "/", disallow },
      // AI / answer-engine crawlers — explicitly allowed so we appear in
      // AI-generated answers and citations.
      {
        userAgent: [
          "GPTBot",
          "OAI-SearchBot",
          "ChatGPT-User",
          "ClaudeBot",
          "Claude-Web",
          "anthropic-ai",
          "PerplexityBot",
          "Perplexity-User",
          "Google-Extended",
          "Applebot",
          "Applebot-Extended",
          "Bingbot",
          "CCBot",
        ],
        allow: "/",
        disallow,
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
