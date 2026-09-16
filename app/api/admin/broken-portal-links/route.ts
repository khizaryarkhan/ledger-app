/**
 * GET /api/admin/broken-portal-links[?orgId=]
 *
 * Which customers were emailed a portal link that lands on Vercel's login page?
 *
 * Portal links built from a `*.vercel.app` deployment host are intercepted by
 * Vercel Deployment Protection — the customer is redirected to
 * `vercel.com/sso-api` instead of their invoices. Fixed going forward by
 * `isPublicHost` in lib/portal.ts, but emails already sent carry the bad host
 * and cannot be recalled.
 *
 * Runs INSIDE the deployed app, so it sees the real production database without
 * anyone copying credentials to a laptop — same reasoning as
 * /api/admin/reconcile. Platform-admin only.
 *
 * STRICTLY READ-ONLY: one SELECT, no writes, no QuickBooks call, and it can
 * never touch an OAuth token.
 */

import { requirePlatformAdmin } from "@/lib/billing";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { sql } from "drizzle-orm";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(req: Request) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const orgId = new URL(req.url).searchParams.get("orgId");

  // Match on BOTH the host and a /portal/ path: an email merely mentioning
  // vercel.app is not a broken portal link, and counting it would overstate the
  // problem to someone deciding how many customers to apologise to.
  const res: any = await db.execute(sql`
    select c.id,
           c.org_id,
           o.name            as org_name,
           c.customer_id,
           p.name            as customer_name,
           p.email           as customer_email,
           i.invoice_number  as invoice_number,
           c.subject,
           c.sent_at
      from communications c
      left join organisations o on o.id = c.org_id
      left join customers     p on p.id = c.customer_id
      left join invoices      i on i.id = c.invoice_id
     where c.direction = 'Outbound'
       and c.body is not null
       and c.body like '%.vercel.app%'
       and c.body like '%/portal/%'
       ${orgId ? sql`and c.org_id = ${orgId}` : sql``}
     order by c.sent_at desc
     limit 2000
  `);
  const rows: any[] = res?.rows ?? res ?? [];

  // Group so the answer reads as "who do I need to re-send to", not a log dump.
  const byOrg = new Map<string, { orgId: string; orgName: string; emails: number; customers: Map<string, any> }>();
  for (const r of rows) {
    const key = String(r.org_id);
    if (!byOrg.has(key)) byOrg.set(key, { orgId: key, orgName: r.org_name ?? key, emails: 0, customers: new Map() });
    const g = byOrg.get(key)!;
    g.emails++;
    const ck = String(r.customer_id ?? r.customer_email ?? r.id);
    if (!g.customers.has(ck)) {
      g.customers.set(ck, {
        customerId: r.customer_id, name: r.customer_name, email: r.customer_email,
        emails: 0, firstSentAt: r.sent_at, lastSentAt: r.sent_at, invoices: [] as string[],
      });
    }
    const c = g.customers.get(ck)!;
    c.emails++;
    if (r.sent_at < c.firstSentAt) c.firstSentAt = r.sent_at;
    if (r.sent_at > c.lastSentAt)  c.lastSentAt  = r.sent_at;
    if (r.invoice_number && !c.invoices.includes(r.invoice_number)) c.invoices.push(r.invoice_number);
  }

  const organisations = [...byOrg.values()]
    .map(g => ({ orgId: g.orgId, orgName: g.orgName, emails: g.emails, customerCount: g.customers.size, customers: [...g.customers.values()] }))
    .sort((a, b) => b.emails - a.emails);

  return NextResponse.json({
    totalEmails: rows.length,
    totalCustomers: organisations.reduce((s, o) => s + o.customerCount, 0),
    truncated: rows.length >= 2000,
    note:
      rows.length === 0
        ? "No outbound email carries a vercel.app portal link. Nothing to re-send."
        : "Re-send these from the app — the link is rebuilt on the production domain now. The portal TOKENS are unaffected; only the host in the URL was wrong.",
    organisations,
  });
}
