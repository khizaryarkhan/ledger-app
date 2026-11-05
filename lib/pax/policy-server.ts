// Database half of lib/pax/policy.ts: the organisation's settings and each user's consent.

import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { organisations, paxConsents, paxOrgSettings } from "@/db/schema";
import { normalisePolicy, type OrgPolicy } from "./policy";

export async function loadOrgPolicy(orgId: string): Promise<OrgPolicy> {
  const [row] = await db.select().from(paxOrgSettings).where(eq(paxOrgSettings.orgId, orgId)).limit(1);
  return normalisePolicy(row);
}

export async function saveOrgPolicy(orgId: string, userId: string, p: OrgPolicy): Promise<void> {
  const values = {
    allowedProviders: p.allowedProviders, allowCustomEndpoints: p.allowCustomEndpoints, writesEnabled: p.writesEnabled,
    consentText: p.consentText, updatedAt: new Date(), updatedBy: userId,
  };
  await db.insert(paxOrgSettings).values({ orgId, ...values }).onConflictDoUpdate({ target: paxOrgSettings.orgId, set: values });
}

/** The organisation-wide switch that binds every AI route to changes (Settings → AI connections). Fails closed. */
export async function aiWritesEnabled(orgId: string): Promise<boolean> {
  try {
    const [o] = await db.select({ w: organisations.aiWritesEnabled }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
    return o?.w === true;
  } catch {
    return false;
  }
}

export async function hasConsented(userId: string, orgId: string): Promise<boolean> {
  const [r] = await db.select({ at: paxConsents.acceptedAt }).from(paxConsents)
    .where(and(eq(paxConsents.userId, userId), eq(paxConsents.orgId, orgId))).limit(1);
  return !!r;
}

export async function recordConsent(userId: string, orgId: string): Promise<void> {
  await db.insert(paxConsents).values({ userId, orgId }).onConflictDoNothing();
}
