/**
 * GET /api/admin/broken-portal-links[?orgId=&days=]
 *
 * Portal links built from a `*.vercel.app` deployment host are intercepted by
 * Vercel Deployment Protection — the customer is redirected to
 * `vercel.com/sso-api` instead of their invoices. Fixed going forward by
 * `isPublicHost` in lib/portal.ts. This is about the ones already sent.
 *
 * ── READ THIS BEFORE TRUSTING A NUMBER FROM HERE ────────────────────────────
 *
 * **We cannot identify which links were poisoned.** The first version of this
 * endpoint searched `communications.body` for a vercel.app host and returned a
 * confident zero. That zero was meaningless:
 *
 *   - `communications.body` does NOT hold the sent HTML. The AR senders store
 *     the plain intro text (see app/api/cron/route.ts — `body: introText`); the
 *     portal button lives in the HTML that renderInvoiceEmail builds, and that
 *     is never persisted.
 *   - `customer_portal_tokens` stores the token and nothing about the URL — no
 *     host, no link.
 *
 * So no table anywhere records the host a link was built with, and a definitive
 * "these customers were affected" list is not derivable from our data. Saying
 * so is more useful than a clean-looking zero somebody acts on.
 *
 * ── What this DOES give you ─────────────────────────────────────────────────
 *
 * The nearest real signal: portal tokens that were issued and NEVER OPENED
 * (`last_viewed_at IS NULL`). A customer who clicked a poisoned link hit a
 * Vercel login wall and never reached the portal, so their token stays
 * unviewed. It is not proof — plenty of customers simply never click — but it
 * is the actionable re-send list, and it is a real measurement rather than a
 * fabricated one.
 *
 * The complete fix for links already in inboxes does not depend on identifying
 * them at all: disabling Vercel Deployment Protection makes every one of them
 * resolve, because the redirect happens at Vercel's edge before our code runs.
 *
 * Platform-admin only. STRICTLY READ-ONLY — one SELECT, no writes, no
 * QuickBooks call, and it can never touch an OAuth token.
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

  const url = new URL(req.url);
  const orgId = url.searchParams.get("orgId");
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? 30), 1), 365);

  const res: any = await db.execute(sql`
    select t.id,
           t.org_id,
           o.name             as org_name,
           t.customer_id,
           p.name             as customer_name,
           p.email            as customer_email,
           t.status,
           t.created_at,
           t.expires_at,
           t.created_by is null as from_automation,
           jsonb_array_length(t.invoice_ids) as invoice_count
      from customer_portal_tokens t
      left join organisations o on o.id = t.org_id
      left join customers     p on p.id = t.customer_id
     where t.last_viewed_at is null
       and t.created_at >= now() - (${days} || ' days')::interval
       ${orgId ? sql`and t.org_id = ${orgId}` : sql``}
     order by t.created_at desc
     limit 2000
  `);
  const rows: any[] = res?.rows ?? res ?? [];

  const byOrg = new Map<string, any>();
  for (const r of rows) {
    const k = String(r.org_id);
    if (!byOrg.has(k)) byOrg.set(k, { orgId: k, orgName: r.org_name ?? k, tokens: 0, customers: new Map() });
    const g = byOrg.get(k);
    g.tokens++;
    const ck = String(r.customer_id);
    if (!g.customers.has(ck)) {
      g.customers.set(ck, { customerId: r.customer_id, name: r.customer_name, email: r.customer_email, tokens: 0, newest: r.created_at, oldest: r.created_at });
    }
    const c = g.customers.get(ck);
    c.tokens++;
    if (r.created_at < c.oldest) c.oldest = r.created_at;
    if (r.created_at > c.newest) c.newest = r.created_at;
  }

  const organisations = [...byOrg.values()]
    .map(g => ({ orgId: g.orgId, orgName: g.orgName, unopenedTokens: g.tokens, customerCount: g.customers.size, customers: [...g.customers.values()] }))
    .sort((a, b) => b.unopenedTokens - a.unopenedTokens);

  return NextResponse.json({
    caveat:
      "We CANNOT identify which portal links carried a vercel.app host. The email HTML is not " +
      "stored (communications.body holds the intro text only) and customer_portal_tokens records " +
      "no URL. Treat the list below as candidates, not as the affected set.",
    whatThisIs: `Portal tokens issued in the last ${days} days that have NEVER been opened. A customer ` +
      "who clicked a poisoned link hit a Vercel login wall and never reached the portal, so their " +
      "token stays unviewed — but so does the token of anyone who simply did not click.",
    completeFix:
      "Disabling Vercel Deployment Protection makes every already-sent link resolve, whether or not " +
      "we can identify it — the redirect happens at Vercel's edge before our code runs.",
    days,
    unopenedTokens: rows.length,
    customersAffectedAtMost: organisations.reduce((s, o) => s + o.customerCount, 0),
    truncated: rows.length >= 2000,
    organisations,
  });
}
