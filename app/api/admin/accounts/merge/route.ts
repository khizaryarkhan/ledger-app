import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, organisations, landingPageRequests, opportunities, crmActivities, crmEmails } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/admin/activities";

const LIFECYCLE_ORDER = ["lead", "prospect", "qualified", "customer"];

// POST { primaryId, mergeIds[] } — fold duplicate accounts into one. Non-
// destructive to billing: every child (org, lead, deal, activity, email) is
// RE-POINTED to the primary; only the now-empty duplicate account rows are
// removed. The primary keeps the most-advanced lifecycle and fills any blank
// identity fields (domain/email/org/stripe) from the merged accounts.
export async function POST(req: NextRequest) {
  const { error, userId, userName } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));
  const primaryId: string = body.primaryId;
  const mergeIds: string[] = Array.isArray(body.mergeIds) ? body.mergeIds.filter((x: string) => x && x !== primaryId) : [];
  if (!primaryId || mergeIds.length === 0) return NextResponse.json({ error: "primaryId and at least one mergeId required" }, { status: 400 });

  const all = await db.select().from(crmAccounts).where(inArray(crmAccounts.id, [primaryId, ...mergeIds]));
  const primary = all.find(a => a.id === primaryId);
  if (!primary) return NextResponse.json({ error: "Primary account not found" }, { status: 404 });
  const merged = all.filter(a => mergeIds.includes(a.id));
  if (merged.length === 0) return NextResponse.json({ error: "No accounts to merge" }, { status: 404 });

  // Re-point children. account_id on org/lead/opp is a plain column; activities
  // + emails FK-cascade to crm_accounts, so they MUST move before the delete.
  for (const m of merged) {
    await db.update(organisations).set({ accountId: primaryId }).where(eq(organisations.accountId, m.id));
    await db.update(landingPageRequests).set({ accountId: primaryId }).where(eq(landingPageRequests.accountId, m.id));
    await db.update(opportunities).set({ accountId: primaryId }).where(eq(opportunities.accountId, m.id));
    await db.update(crmActivities).set({ accountId: primaryId }).where(eq(crmActivities.accountId, m.id));
    await db.update(crmEmails).set({ accountId: primaryId }).where(eq(crmEmails.accountId, m.id));
  }

  // Promote primary: most-advanced lifecycle + fill blanks from merged.
  const patch: Record<string, any> = { updatedAt: new Date() };
  let bestStage = primary.lifecycleStage;
  for (const m of merged) {
    if (LIFECYCLE_ORDER.indexOf(m.lifecycleStage) > LIFECYCLE_ORDER.indexOf(bestStage)) bestStage = m.lifecycleStage;
    if (!primary.organisationId && m.organisationId) patch.organisationId = m.organisationId;
    if (!primary.domain && m.domain) patch.domain = m.domain;
    if (!primary.billingEmail && m.billingEmail) patch.billingEmail = m.billingEmail;
    if (!primary.stripeCustomerId && m.stripeCustomerId) patch.stripeCustomerId = m.stripeCustomerId;
    if (!primary.country && m.country) patch.country = m.country;
    if (!primary.ownerAdminId && m.ownerAdminId) patch.ownerAdminId = m.ownerAdminId;
  }
  if (bestStage !== primary.lifecycleStage) patch.lifecycleStage = bestStage;
  if (Object.keys(patch).length > 1) await db.update(crmAccounts).set(patch).where(eq(crmAccounts.id, primaryId));

  // Delete the now-empty duplicate accounts.
  await db.delete(crmAccounts).where(inArray(crmAccounts.id, mergeIds));

  await logActivity({
    type: "account_created", title: `Merged ${merged.length} duplicate account${merged.length !== 1 ? "s" : ""} into ${primary.name}`,
    accountId: primaryId, actorId: userId, actorName: userName,
    meta: { mergedFrom: merged.map(m => m.name) },
  });

  return NextResponse.json({ ok: true, merged: merged.length, primaryId });
}
