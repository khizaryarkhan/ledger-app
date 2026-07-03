/**
 * AR Reconciliation — compare our AR Aging total to QBO's Balance Sheet AR.
 *
 * GET /api/reports/ar-reconcile?asOf=YYYY-MM-DD
 *
 * Calls QBO's BalanceSheet report for the given date and extracts the
 * Accounts Receivable line. Returns:
 *   - balanceSheetAR:  QBO's stated AR balance per Balance Sheet
 *   - ledgerAR:        our computed AR from the Aging engine
 *   - variance:        difference (positive = our ledger overstates AR)
 *   - explanation:     plain-language note on probable causes if non-zero
 */

import { db } from "@/db";
import { qboTokens } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { computeArAging } from "@/lib/ar-aging";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

type TokenRow = typeof qboTokens.$inferSelect;

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

/** Refresh an expired QBO access token and persist the new value to the DB
 *  so subsequent calls from any route don't re-trigger another refresh. */
async function refreshAndPersistToken(token: TokenRow): Promise<string> {
  const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: decryptSecret(token.refreshToken)! }),
  });
  if (!res.ok) return decryptSecret(token.accessToken)!; // Fall back to the existing (possibly still valid) token
  const d = await res.json();
  const newAccessToken: string = d.access_token;
  const expiresIn: number = d.expires_in ?? 3600; // seconds; QBO default is 3600
  // Persist so every subsequent route call finds a fresh token without
  // triggering another network round-trip to Intuit.
  await db.update(qboTokens)
    .set({
      accessToken: encryptSecret(newAccessToken)!,
      accessTokenExpiresAt: new Date(Date.now() + expiresIn * 1000),
      updatedAt: new Date(),
    })
    .where(eq(qboTokens.id, token.id));
  return newAccessToken;
}

/**
 * Recursively search QBO Balance Sheet rows for an Accounts Receivable line.
 * QBO uses AccountTypeRef.value = 'Accounts Receivable' on the row metadata.
 */
function findArAmountInBalanceSheet(rows: any): number | null {
  if (!rows) return null;
  if (Array.isArray(rows)) {
    for (const r of rows) {
      const found = findArAmountInBalanceSheet(r);
      if (found !== null) return found;
    }
    return null;
  }

  // Match by header text — most reliable across QBO chart variations
  const headerText: string = (rows.Header?.ColData?.[0]?.value || "").toLowerCase();
  if (headerText.includes("accounts receivable")) {
    // Sum the Amount columns in Header.ColData (last col is usually the amount)
    const lastCol = rows.Header?.ColData?.[rows.Header.ColData.length - 1];
    const amt = parseFloat((lastCol?.value || "0").replace(/[,$]/g, ""));
    if (!isNaN(amt)) return amt;
  }

  // Try Summary row at the section's bottom
  const summaryText: string = (rows.Summary?.ColData?.[0]?.value || "").toLowerCase();
  if (summaryText.includes("accounts receivable")) {
    const lastCol = rows.Summary?.ColData?.[rows.Summary.ColData.length - 1];
    const amt = parseFloat((lastCol?.value || "0").replace(/[,$]/g, ""));
    if (!isNaN(amt)) return amt;
  }

  // Recurse into nested rows
  if (rows.Rows?.Row) {
    return findArAmountInBalanceSheet(rows.Rows.Row);
  }
  return null;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf");
  if (!asOf) return bad("asOf=YYYY-MM-DD required");

  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId!));
  if (!token) return bad("No QBO connection", 400);

  const accessToken = new Date(token.accessTokenExpiresAt).getTime() - Date.now() < 60_000
    ? await refreshAndPersistToken(token)
    : decryptSecret(token.accessToken)!;

  // 1. Compute our aging
  let ledger;
  try {
    ledger = await computeArAging(orgId!, asOf);
  } catch (e: any) {
    return bad(e?.message || "Failed to compute ledger aging", 500);
  }

  // 2. Fetch QBO Balance Sheet at asOf
  let balanceSheetAR: number | null = null;
  let qboError: string | null = null;
  try {
    // QBO_REPORTS_MODERN=true opts into the modernized Reports API platform early.
    // BalanceSheet is Group 1 (ramping July 1 → 100% July 16 2026).
    const modernParam = process.env.QBO_REPORTS_MODERN === "true" ? "&testing_migration=true" : "";
    const bsUrl = `${QBO_API}/${token.realmId}/reports/BalanceSheet?as_of=${asOf}&accounting_method=Accrual&minorversion=65${modernParam}`;
    const res = await fetch(bsUrl, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (res.ok) {
      const isModern = res.headers.get("v3modernResponse") === "true";
      if (isModern) console.log("[QBO BalanceSheet] modernized response received");
      const bs = await res.json();
      balanceSheetAR = findArAmountInBalanceSheet(bs.Rows?.Row);
    } else {
      qboError = `QBO ${res.status}: ${await res.text()}`;
    }
  } catch (e: any) {
    qboError = e?.message || String(e);
  }

  const ledgerAR = ledger.grandTotals.total;
  const variance = balanceSheetAR !== null ? ledgerAR - balanceSheetAR : null;

  // Plain-language explanation
  let explanation = "";
  if (balanceSheetAR === null) {
    explanation = qboError
      ? `Couldn't fetch QBO Balance Sheet (${qboError}). Compare manually.`
      : "Couldn't locate Accounts Receivable line in QBO Balance Sheet.";
  } else if (Math.abs(variance!) < 1) {
    explanation = "AR Aging total matches QBO Balance Sheet exactly.";
  } else {
    const reasons: string[] = [];
    if (ledger.flags.unappliedCredits > 0) {
      reasons.push(`${ledger.flags.unappliedCredits} unapplied credit memo(s) — direct CM→Invoice applications via QBO LinkedTxn not yet captured`);
    }
    if (ledger.flags.missingDueDate > 0) {
      reasons.push(`${ledger.flags.missingDueDate} transaction(s) without a due date — using transaction date as fallback`);
    }
    reasons.push("Refund Receipts reduce net AR in our engine but are not linked to specific invoices — balance impact is captured, per-invoice detail may differ from QBO");
    reasons.push("Direct Credit Memo → Invoice applications (no Payment intermediary) are not yet captured — these reduce the CM's unapplied balance without a payment_application row");
    explanation = `Variance of ${variance!.toFixed(2)}. Likely causes: ${reasons.join("; ")}.`;
  }

  return ok({
    asOf,
    balanceSheetAR,
    ledgerAR,
    variance,
    explanation,
    flags: ledger.flags,
    meta: ledger.meta,
  });
}
