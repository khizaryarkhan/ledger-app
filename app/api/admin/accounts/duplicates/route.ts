import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, organisations, opportunities, landingPageRequests } from "@/db/schema";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { formatAccountRef } from "@/lib/admin/accounts";

const normName = (s: string) => (s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// GET — candidate duplicate accounts, grouped. Two accounts are candidates when
// they share a normalized name, a domain, or a billing email. Grouped via
// union-find so a transitive cluster (A~B, B~C) becomes one group {A,B,C}.
export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const accounts = await db.select().from(crmAccounts);
  if (accounts.length < 2) return NextResponse.json({ groups: [] });

  // Union-find.
  const parent = new Map<string, string>();
  const find = (x: string): string => { let r = x; while (parent.get(r) && parent.get(r) !== r) r = parent.get(r)!; parent.set(x, r); return r; };
  const union = (a: string, b: string) => { parent.set(find(a), find(b)); };
  for (const a of accounts) parent.set(a.id, a.id);

  // Index by each signal; union accounts that share one.
  const nameIdx = new Map<string, string>(), domainIdx = new Map<string, string>(), emailIdx = new Map<string, string>();
  for (const a of accounts) {
    const n = normName(a.name); const d = (a.domain || "").toLowerCase(); const e = (a.billingEmail || "").toLowerCase();
    if (n) { const p = nameIdx.get(n); if (p) union(p, a.id); else nameIdx.set(n, a.id); }
    if (d) { const p = domainIdx.get(d); if (p) union(p, a.id); else domainIdx.set(d, a.id); }
    if (e) { const p = emailIdx.get(e); if (p) union(p, a.id); else emailIdx.set(e, a.id); }
  }

  // Bucket accounts by their root.
  const clusters = new Map<string, typeof accounts>();
  for (const a of accounts) {
    const root = find(a.id);
    (clusters.get(root) ?? clusters.set(root, []).get(root)!).push(a);
  }

  // Enrich groups of size >= 2 with deal + org-status context.
  const dupAccounts = [...clusters.values()].filter(g => g.length > 1);
  const ids = dupAccounts.flat().map(a => a.id);
  const dealCounts = ids.length
    ? await db.select({ accountId: opportunities.accountId, c: sql<number>`count(*)::int` }).from(opportunities).groupBy(opportunities.accountId)
    : [];
  const dealsBy = new Map(dealCounts.filter(d => d.accountId).map(d => [d.accountId as string, d.c]));
  const leadCounts = ids.length
    ? await db.select({ accountId: landingPageRequests.accountId, c: sql<number>`count(*)::int` }).from(landingPageRequests).groupBy(landingPageRequests.accountId)
    : [];
  const leadsBy = new Map(leadCounts.filter(l => l.accountId).map(l => [l.accountId as string, l.c]));
  const orgRows = await db.select({ id: organisations.id, status: organisations.status }).from(organisations);
  const orgStatus = new Map(orgRows.map(o => [o.id, o.status]));

  const groups = dupAccounts.map(g => ({
    accounts: g
      .map(a => ({
        id: a.id, ref: formatAccountRef(a.refSeq), name: a.name, domain: a.domain, billingEmail: a.billingEmail,
        lifecycleStage: a.lifecycleStage, organisationId: a.organisationId,
        orgStatus: a.organisationId ? (orgStatus.get(a.organisationId) ?? null) : null,
        deals: dealsBy.get(a.id) ?? 0, leads: leadsBy.get(a.id) ?? 0,
        createdAt: a.createdAt,
      }))
      .sort((x, y) => (y.deals + (y.organisationId ? 100 : 0)) - (x.deals + (x.organisationId ? 100 : 0))), // richest first = suggested primary
  }));

  return NextResponse.json({ groups });
}
