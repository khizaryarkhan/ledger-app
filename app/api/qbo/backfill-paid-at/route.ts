/**
 * Backfills paid_at on existing paid invoices using QBO Payment TxnDate.
 * Session-protected (admin only).
 *
 * POST /api/qbo/backfill-paid-at
 */

import { db } from "@/db";
import { invoices, qboTokens } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, isNull, and } from "drizzle-orm";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

async function qboQuery(accessToken: string, realmId: string, query: string) {
  const url = `${QBO_API}/${realmId}/query?query=${encodeURIComponent(query)}&minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  return res.json();
}

async function fetchAllPayments(accessToken: string, realmId: string) {
  const payments: any[] = [];
  let startPosition = 1;
  const pageSize = 1000;

  while (true) {
    const data = await qboQuery(
      accessToken, realmId,
      `SELECT * FROM Payment STARTPOSITION ${startPosition} MAXRESULTS ${pageSize}`
    );
    const page = data?.QueryResponse?.Payment || [];
    payments.push(...page);
    if (page.length < pageSize) break;
    startPosition += pageSize;
    await new Promise(r => setTimeout(r, 300));
  }
  return payments;
}

async function refreshQboToken(token: any): Promise<string> {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken }),
  });
  if (!res.ok) return token.accessToken;
  const d = await res.json();
  return d.access_token as string;
}

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // Find the QBO token for this org
  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId!));
  if (!token) return bad("No QBO connection found for this org", 400);

  try {
    const now = Date.now();
    const tokenExpired = new Date(token.accessTokenExpiresAt).getTime() - now < 60_000;
    const accessToken = tokenExpired ? await refreshQboToken(token) : token.accessToken;

    // 1. Fetch all QBO payments
    const allPayments = await fetchAllPayments(accessToken, token.realmId);

    // 2. Build: invoiceQboId → latest payment date (YYYY-MM-DD)
    const paymentDateByInvId = new Map<string, string>();
    for (const pay of allPayments) {
      const txnDate: string = pay.TxnDate;
      if (!txnDate) continue;
      for (const line of (pay.Line || [])) {
        for (const linked of (line.LinkedTxn || [])) {
          if (linked.TxnType === "Invoice") {
            const existing = paymentDateByInvId.get(linked.TxnId);
            if (!existing || txnDate > existing) paymentDateByInvId.set(linked.TxnId, txnDate);
          }
        }
      }
    }

    // 3. Find paid invoices in this org without a paidAt
    const unpopulated = await db
      .select({ id: invoices.id, qboId: invoices.qboId })
      .from(invoices)
      .where(and(
        eq(invoices.orgId, orgId!),
        eq(invoices.paymentStatus, "Paid"),
        isNull(invoices.paidAt),
      ));

    // 4. Update each one with the payment date from QBO
    let backfilled = 0;
    let skipped = 0;
    for (const inv of unpopulated) {
      const paidDate = inv.qboId ? paymentDateByInvId.get(inv.qboId) : undefined;
      if (!paidDate) { skipped++; continue; }
      await db.update(invoices)
        .set({ paidAt: paidDate, updatedAt: new Date() })
        .where(and(eq(invoices.id, inv.id), eq(invoices.orgId, orgId!)));
      backfilled++;
    }

    return ok({ backfilled, skipped, total: unpopulated.length });
  } catch (e: any) {
    console.error("Backfill paid-at failed:", e);
    return bad(`Backfill failed: ${e.message}`, 500);
  }
}
