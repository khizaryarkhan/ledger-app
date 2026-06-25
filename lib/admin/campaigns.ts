import { db } from "@/db";
import { crmCampaigns } from "@/db/schema";
import { eq, and } from "drizzle-orm";

const norm = (s?: string | null) => (s || "").trim().toLowerCase();

/**
 * Resolve a lead's campaign from its UTM / source tokens by matching an active
 * campaign's utmKey (case-insensitive) against utm_campaign → utm_source →
 * source, in that order. Best-effort: returns null on no match or error.
 */
export async function resolveCampaignId(input: { utmCampaign?: string | null; utmSource?: string | null; source?: string | null }): Promise<string | null> {
  try {
    const candidates = [norm(input.utmCampaign), norm(input.utmSource), norm(input.source)].filter(Boolean);
    if (!candidates.length) return null;
    const active = await db.select({ id: crmCampaigns.id, utmKey: crmCampaigns.utmKey })
      .from(crmCampaigns).where(eq(crmCampaigns.status, "active"));
    for (const cand of candidates) {
      const hit = active.find(c => c.utmKey && norm(c.utmKey) === cand);
      if (hit) return hit.id;
    }
    return null;
  } catch {
    return null;
  }
}
