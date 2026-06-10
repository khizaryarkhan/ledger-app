import type { MetadataRoute } from "next";
import { SOLUTIONS } from "@/lib/marketing-data";
import { POSTS } from "@/lib/blog-data";
import { COMPETITORS } from "@/lib/competitors-data";

const SITE_URL = "https://primeaccountax.com";

/**
 * sitemap.xml — public, indexable pages only.
 */
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  const core: MetadataRoute.Sitemap = [
    { url: SITE_URL, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    { url: `${SITE_URL}/register`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${SITE_URL}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  const solutions: MetadataRoute.Sitemap = Object.values(SOLUTIONS).map((s) => ({
    url: `${SITE_URL}/${s.slug}`,
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.8,
  }));

  const posts: MetadataRoute.Sitemap = POSTS.map((p) => ({
    url: `${SITE_URL}/blog/${p.slug}`,
    lastModified: new Date(p.date + "T00:00:00Z"),
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  const alternatives: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/alternatives`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    ...COMPETITORS.map((c) => ({
      url: `${SITE_URL}/${c.slug}`,
      lastModified: now,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];

  return [...core, ...solutions, ...posts, ...alternatives];
}
