/**
 * GET /api/qbo/modern-check?asOf=YYYY-MM-DD
 *
 * QBO Reports-API modernization validator (Intuit Group 2 rollout starts
 * 13 Jul 2026 for AgedReceivableDetail; Group 1 BalanceSheet already ramping).
 *
 * Fetches AgedReceivableDetail and BalanceSheet TWICE — once legacy, once
 * with testing_migration=true — runs both through OUR parsers, and diffs the
 * results. If `verdict: "PASS"`, the modernized platform is safe for us and
 * QBO_REPORTS_MODERN can be enabled (or the forced rollout can arrive)
 * without breaking the AR aging report or reconciliation.
 *
 * Read-only; org-scoped; safe to run any time.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { getValidToken } from "@/lib/qbo-sync";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

const round2 = (n: number) => Math.round(n * 100) / 100;

function parseMoney(v: any): number {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[,$£€\s]/g, ""));
  return isNaN(n) ? 0 : n;
}

/** Leaf rows of a QBO report tree (same walk as lib/qbo-aging-report). */
function* walkRows(node: any): Generator<any> {
  if (!node) return;
  if (Array.isArray(node)) { for (const r of node) yield* walkRows(r); return; }
  if (node.Rows?.Row) { yield* walkRows(node.Rows.Row); return; }
  if (Array.isArray(node.ColData) && node.type !== "Section") yield node;
}

/** Summarise a report payload into comparable facts. */
function summarise(report: any) {
  const columns: any[] = report?.Columns?.Column ?? [];
  const colTitles = columns.map(c => String(c?.ColTitle ?? ""));
  const amountIdx = colTitles.findIndex(t => /open balance|amount|balance/i.test(t));

  let rowCount = 0;
  let amountSum = 0;
  for (const row of walkRows(report?.Rows?.Row)) {
    rowCount++;
    if (amountIdx >= 0) amountSum += parseMoney(row.ColData?.[amountIdx]?.value);
  }
  return { colTitles, rowCount, amountSum: round2(amountSum) };
}

/** Find the AR line in a BalanceSheet (same logic as ar-reconcile). */
function findArAmount(rows: any): number | null {
  if (!rows) return null;
  if (Array.isArray(rows)) {
    for (const r of rows) { const f = findArAmount(r); if (f !== null) return f; }
    return null;
  }
  for (const part of ["Header", "Summary"] as const) {
    const cd = rows[part]?.ColData;
    const label = String(cd?.[0]?.value ?? "").toLowerCase();
    if (label.includes("accounts receivable")) {
      const amt = parseMoney(cd[cd.length - 1]?.value);
      if (!isNaN(amt)) return amt;
    }
  }
  if (rows.Rows?.Row) return findArAmount(rows.Rows.Row);
  return null;
}

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const asOf = url.searchParams.get("asOf") ?? new Date().toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return bad("asOf must be YYYY-MM-DD");

  const token = await getValidToken(orgId!);
  if (!token) return bad("QuickBooks not connected", 400);

  const fetchReport = async (path: string, modern: boolean) => {
    const res = await fetch(`${QBO_API}/${token.realmId}${path}${modern ? "&testing_migration=true" : ""}`, {
      headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) return { error: `${res.status}: ${(await res.text()).slice(0, 300)}`, modernHeader: null, body: null };
    return {
      error: null,
      modernHeader: res.headers.get("v3modernResponse") === "true",
      body: await res.json(),
    };
  };

  const agingPath = `/reports/AgedReceivableDetail?report_date=${asOf}&aging_method=Report_Date&accounting_method=Accrual&num_periods=4&aging_period=30&minorversion=65`;
  const bsPath    = `/reports/BalanceSheet?as_of=${asOf}&accounting_method=Accrual&minorversion=65`;

  const [agingLegacy, agingModern, bsLegacy, bsModern] = await Promise.all([
    fetchReport(agingPath, false),
    fetchReport(agingPath, true),
    fetchReport(bsPath, false),
    fetchReport(bsPath, true),
  ]);

  // ── Aging comparison ──────────────────────────────────────────────────────
  const aging: any = { legacyError: agingLegacy.error, modernError: agingModern.error };
  if (!agingLegacy.error && !agingModern.error) {
    const l = summarise(agingLegacy.body);
    const m = summarise(agingModern.body);
    aging.modernHeaderPresent = agingModern.modernHeader;
    aging.legacy = l;
    aging.modern = m;
    aging.columnsMatch = JSON.stringify(l.colTitles) === JSON.stringify(m.colTitles);
    aging.rowCountMatch = l.rowCount === m.rowCount;
    aging.amountMatch = Math.abs(l.amountSum - m.amountSum) < 0.01;
    aging.pass = aging.rowCountMatch && aging.amountMatch;
  }

  // ── BalanceSheet comparison ───────────────────────────────────────────────
  const balanceSheet: any = { legacyError: bsLegacy.error, modernError: bsModern.error };
  if (!bsLegacy.error && !bsModern.error) {
    const lAr = findArAmount(bsLegacy.body?.Rows?.Row);
    const mAr = findArAmount(bsModern.body?.Rows?.Row);
    balanceSheet.modernHeaderPresent = bsModern.modernHeader;
    balanceSheet.legacyAR = lAr;
    balanceSheet.modernAR = mAr;
    balanceSheet.pass = lAr !== null && mAr !== null && Math.abs(lAr - mAr) < 0.01;
  }

  const verdict =
    aging.pass && balanceSheet.pass ? "PASS"
    : aging.pass === false || balanceSheet.pass === false ? "FAIL"
    : "INCONCLUSIVE";

  return ok({
    asOf,
    verdict,
    note: verdict === "PASS"
      ? "Modernized responses parse identically to legacy — safe for the July 13 rollout. You may set QBO_REPORTS_MODERN=true (optional; the forced rollout will behave the same)."
      : verdict === "FAIL"
      ? "Modernized responses DIFFER from legacy through our parsers — inspect the aging/balanceSheet sections below and fix the parser before July 13."
      : "One or more requests failed — see the error fields. If modern requests 4xx, Intuit may not have enabled testing_migration for this realm yet.",
    aging,
    balanceSheet,
  });
}
