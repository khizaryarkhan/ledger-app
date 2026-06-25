import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmCampaigns, landingPageRequests, opportunities } from "@/db/schema";
import { eq, sql, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// GET — campaigns with attribution stats: leads, converted, open pipeline value,
// won value (all via leads attributed to the campaign).
export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const campaigns = await db.select().from(crmCampaigns).orderBy(desc(crmCampaigns.createdAt));

  // Lead counts + conversion per campaign.
  const leadAgg = await db.select({
    campaignId: landingPageRequests.campaignId,
    leads:      sql<number>`count(*)::int`,
    converted:  sql<number>`(count(*) filter (where ${landingPageRequests.status} = 'converted'))::int`,
  }).from(landingPageRequests).groupBy(landingPageRequests.campaignId);
  const leadBy = new Map(leadAgg.filter(l => l.campaignId).map(l => [l.campaignId as string, l]));

  // Pipeline + won value via opportunities joined to their lead's campaign.
  const dealAgg = await db.select({
    campaignId: landingPageRequests.campaignId,
    openValue:  sql<number>`coalesce(sum(${opportunities.value}) filter (where ${opportunities.status} = 'open'), 0)::int`,
    wonValue:   sql<number>`coalesce(sum(${opportunities.value}) filter (where ${opportunities.status} = 'won'), 0)::int`,
  }).from(opportunities)
    .innerJoin(landingPageRequests, eq(opportunities.leadId, landingPageRequests.id))
    .groupBy(landingPageRequests.campaignId);
  const dealBy = new Map(dealAgg.filter(d => d.campaignId).map(d => [d.campaignId as string, d]));

  const out = campaigns.map(c => ({
    ...c,
    leads:     leadBy.get(c.id)?.leads ?? 0,
    converted: leadBy.get(c.id)?.converted ?? 0,
    openValue: dealBy.get(c.id)?.openValue ?? 0,
    wonValue:  dealBy.get(c.id)?.wonValue ?? 0,
  }));
  return NextResponse.json({ campaigns: out });
}

// POST — create a campaign.
export async function POST(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({} as any));
  if (!b.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const CHANNELS = ["email", "ads", "social", "event", "referral", "content", "other"];
  const [row] = await db.insert(crmCampaigns).values({
    name:      String(b.name).trim().slice(0, 200),
    channel:   CHANNELS.includes(b.channel) ? b.channel : "other",
    utmKey:    b.utmKey?.trim()?.slice(0, 120) || null,
    status:    b.status === "ended" ? "ended" : "active",
    startDate: b.startDate || null,
    endDate:   b.endDate || null,
    budget:    b.budget != null && !isNaN(Number(b.budget)) ? Math.round(Number(b.budget) * 100) : null,
    notes:     b.notes?.slice(0, 1000) || null,
  }).returning();
  return NextResponse.json({ ...row, leads: 0, converted: 0, openValue: 0, wonValue: 0 }, { status: 201 });
}

// PATCH — update a campaign (status, fields).
export async function PATCH(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({} as any));
  if (!b.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim().slice(0, 200);
  if (typeof b.utmKey === "string") patch.utmKey = b.utmKey.trim().slice(0, 120) || null;
  if (b.status === "active" || b.status === "ended") patch.status = b.status;
  if (typeof b.channel === "string") patch.channel = b.channel;
  if ("notes" in b) patch.notes = b.notes?.slice(0, 1000) || null;
  await db.update(crmCampaigns).set(patch).where(eq(crmCampaigns.id, b.id));
  return NextResponse.json({ ok: true });
}
