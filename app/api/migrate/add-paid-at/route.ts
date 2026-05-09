/**
 * One-shot migration: adds paid_at column to invoices table.
 * Also backfills existing paid invoices using QBO MetaData.LastUpdatedTime
 * (best available proxy for payment date from the Invoice object alone).
 *
 * POST /api/migrate/add-paid-at
 * Protected by CRON_SECRET to prevent accidental calls.
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { invoices, qboTokens } from "@/db/schema";
import { sql, eq, isNull, and } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";

async function qboFetchPaidInvoices(accessToken: string, realmId: string) {
  const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
  const url = `${QBO_API}/${realmId}/query?query=${encodeURIComponent(
    "SELECT * FROM Invoice WHERE Balance = '0' MAXRESULTS 1000"
  )}&minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return [];
  const data = await res.json();
  return data.QueryResponse?.Invoice || [];
}

export async function POST(req: Request) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // 1. Add column (safe — IF NOT EXISTS prevents re-run errors)
  const rawSql = neon(process.env.DATABASE_URL!);
  await rawSql`ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_at VARCHAR(16)`;

  // 2. Backfill: for each org that has a QBO token, fetch paid invoices and populate paidAt
  const tokens = await db.select().from(qboTokens);
  let backfilled = 0;
  let errors = 0;

  for (const token of tokens) {
    if (!token.orgId) continue;
    try {
      // Check token freshness (simple check — re-use existing token)
      const now = Date.now();
      const tokenExpired = new Date(token.accessTokenExpiresAt).getTime() - now < 60_000;
      let accessToken = token.accessToken;

      if (tokenExpired) {
        // Refresh
        const r = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`,
          },
          body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken }),
        });
        if (r.ok) {
          const d = await r.json();
          accessToken = d.access_token;
        }
      }

      const paidQboInvoices = await qboFetchPaidInvoices(accessToken, token.realmId);

      // Build map: qboId → lastUpdatedDate
      const qboDateByQboId = new Map<string, string>();
      for (const qi of paidQboInvoices) {
        if (!qi.Id) continue;
        // MetaData.LastUpdatedTime is ISO8601 — take date portion
        const lastUpdated = qi.MetaData?.LastUpdatedTime?.slice(0, 10);
        if (lastUpdated) qboDateByQboId.set(qi.Id, lastUpdated);
      }

      // Fetch all paid invoices in this org that have no paidAt yet
      const orgPaidInvs = await db.select({ id: invoices.id, qboId: invoices.qboId })
        .from(invoices)
        .where(and(
          eq(invoices.orgId, token.orgId),
          eq(invoices.paymentStatus, "Paid"),
          isNull(invoices.paidAt),
        ));

      for (const inv of orgPaidInvs) {
        const paidDate = inv.qboId ? qboDateByQboId.get(inv.qboId) : undefined;
        // Fallback: use today as approximation if QBO has no date
        const dateToStore = paidDate || new Date().toISOString().slice(0, 10);
        await db.update(invoices)
          .set({ paidAt: dateToStore })
          .where(eq(invoices.id, inv.id));
        backfilled++;
      }
    } catch (e: any) {
      console.error(`backfill failed for org ${token.orgId}:`, e.message);
      errors++;
    }
  }

  return NextResponse.json({ ok: true, backfilled, errors });
}
