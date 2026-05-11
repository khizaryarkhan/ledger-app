/**
 * AR Total Verification — read-only audit
 *
 * GET /api/qbo/verify-ar
 *
 * Compares total open AR across THREE sources:
 *   1. QBO directly  — SUM(Balance) from open invoices in QBO right now
 *   2. Our ledger    — SUM(qbo_balance) from open invoices in our DB
 *   3. Last sync log — what STEP 9 recorded as Ledger Total AR last time
 *
 * Also breaks down by currency in case multi-currency is causing a sum mismatch.
 * Helps diagnose "AR reports show wrong number" issues.
 */

import { db } from "@/db";
import { qboTokens, invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, sql, ne } from "drizzle-orm";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

async function refreshToken(token: any): Promise<string> {
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

async function fetchAllOpen(accessToken: string, realmId: string, entity: string) {
  const all: any[] = [];
  let start = 1;
  const size = 500;
  while (true) {
    const url = `${QBO_API}/${realmId}/query?query=${encodeURIComponent(
      `SELECT Id, TotalAmt, Balance, CurrencyRef FROM ${entity} WHERE Balance != '0' STARTPOSITION ${start} MAXRESULTS ${size}`
    )}&minorversion=65`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) break;
    const data = await res.json();
    const rows = data?.QueryResponse?.[entity] || [];
    all.push(...rows);
    if (rows.length < size) break;
    start += size;
    await new Promise(r => setTimeout(r, 200));
  }
  return all;
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId!));
  if (!token) return bad("No QBO connection for this org", 400);

  const accessToken = new Date(token.accessTokenExpiresAt).getTime() - Date.now() < 60_000
    ? await refreshToken(token)
    : token.accessToken;

  // 1. Pull QBO's current open invoices + open credit memos
  const [qboOpenInvoices, qboOpenCredits] = await Promise.all([
    fetchAllOpen(accessToken, token.realmId, "Invoice"),
    fetchAllOpen(accessToken, token.realmId, "CreditMemo"),
  ]);

  const qboByCurrency: Record<string, { invoices: number; credits: number; net: number; count: number }> = {};
  let qboTotalInv = 0, qboTotalCm = 0;

  for (const inv of qboOpenInvoices) {
    const cur = inv.CurrencyRef?.value || "EUR";
    const bal = parseFloat(inv.Balance) || 0;
    qboByCurrency[cur] = qboByCurrency[cur] || { invoices: 0, credits: 0, net: 0, count: 0 };
    qboByCurrency[cur].invoices += bal;
    qboByCurrency[cur].count++;
    qboTotalInv += bal;
  }
  for (const cm of qboOpenCredits) {
    const cur = cm.CurrencyRef?.value || "EUR";
    // QBO returns CreditMemo.Balance as a POSITIVE number (= unapplied amount).
    // We normalise to a negative number so credits + invoices = net AR consistently
    // for both this side and the ledger side (which already stores CMs as negative).
    const bal = -(parseFloat(cm.Balance) || 0);
    qboByCurrency[cur] = qboByCurrency[cur] || { invoices: 0, credits: 0, net: 0, count: 0 };
    qboByCurrency[cur].credits += bal;
    qboByCurrency[cur].count++;
    qboTotalCm += bal;
  }
  for (const cur of Object.keys(qboByCurrency)) {
    qboByCurrency[cur].net = qboByCurrency[cur].invoices + qboByCurrency[cur].credits;
  }
  const qboNetAR = qboTotalInv + qboTotalCm;

  // 2. Our ledger — same definition
  const ledgerRows = await db
    .select({
      currency: invoices.currency,
      txnType: invoices.txnType,
      total: invoices.total,
      paid: invoices.paid,
      qboBalance: invoices.qboBalance,
      paymentStatus: invoices.paymentStatus,
      collectionStage: invoices.collectionStage,
    })
    .from(invoices)
    .where(eq(invoices.orgId, orgId!));

  const ledgerByCurrency: Record<string, { invoices: number; credits: number; net: number; count: number }> = {};
  let ledgerTotalInv = 0, ledgerTotalCm = 0;

  for (const r of ledgerRows) {
    const cur = r.currency || "EUR";
    ledgerByCurrency[cur] = ledgerByCurrency[cur] || { invoices: 0, credits: 0, net: 0, count: 0 };

    if (r.txnType === "CreditMemo") {
      // Unapplied CM has qbo_balance < 0; fully applied has 0
      const bal = r.qboBalance ?? 0;
      if (bal < 0) {
        ledgerByCurrency[cur].credits += bal;
        ledgerByCurrency[cur].count++;
        ledgerTotalCm += bal;
      }
    } else {
      // Invoice — open if not Paid and not Closed
      const isOpen = r.paymentStatus !== "Paid"
                  && r.paymentStatus !== "Written Off"
                  && r.collectionStage !== "Closed";
      if (isOpen) {
        const bal = r.qboBalance ?? Math.max(0, (r.total || 0) - (r.paid || 0));
        if (bal > 0.005) {
          ledgerByCurrency[cur].invoices += bal;
          ledgerByCurrency[cur].count++;
          ledgerTotalInv += bal;
        }
      }
    }
  }
  for (const cur of Object.keys(ledgerByCurrency)) {
    ledgerByCurrency[cur].net = ledgerByCurrency[cur].invoices + ledgerByCurrency[cur].credits;
  }
  const ledgerNetAR = ledgerTotalInv + ledgerTotalCm;

  // Combine currency rows
  const allCurrencies = new Set([...Object.keys(qboByCurrency), ...Object.keys(ledgerByCurrency)]);
  const byCurrency = [...allCurrencies].map(cur => ({
    currency: cur,
    qbo:    qboByCurrency[cur]    ?? { invoices: 0, credits: 0, net: 0, count: 0 },
    ledger: ledgerByCurrency[cur] ?? { invoices: 0, credits: 0, net: 0, count: 0 },
  }));

  return ok({
    qbo: {
      grossInvoices: qboTotalInv,
      grossCredits:  qboTotalCm,
      netAR:         qboNetAR,
      openInvoiceCount: qboOpenInvoices.length,
      openCmCount:      qboOpenCredits.length,
    },
    ledger: {
      grossInvoices: ledgerTotalInv,
      grossCredits:  ledgerTotalCm,
      netAR:         ledgerNetAR,
    },
    difference: ledgerNetAR - qboNetAR,
    byCurrency,
    checkedAt: new Date().toISOString(),
  });
}
