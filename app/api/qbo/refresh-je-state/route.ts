/**
 * Refresh open/closed state of every Journal Entry AR line against QBO.
 *
 * POST /api/qbo/refresh-je-state
 *
 * Background: QBO can "close" a JE by applying it through a zero-amount
 * payment that references the JE in its LinkedTxn. Once closed, QBO drops
 * the JE from AR Aging Detail and Customer.Balance, but our local copy of
 * journal_entry_ar_lines still has it as posted. The local balance
 * calculation in /api/customers/[id]/balance (used by reports + the
 * reconciliation tool) was therefore counting JEs that QBO had already
 * netted out — the classic JE drift in the reconcile output.
 *
 * Resolution: use QBO's own AR Aging Detail report as the oracle. Any JE
 * QBO still considers open will appear there. Any JE in our DB that is
 * NOT in the open list has been closed by QBO and we mark it voided so
 * downstream sums exclude it.
 *
 * Result: running this once after a sync should collapse the JE-drift
 * rows in /settings/integrations/reconcile to match QBO.
 */

import { db } from "@/db";
import { journalEntryArLines } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { getValidToken } from "@/lib/qbo-sync";
import { and, eq, inArray } from "drizzle-orm";

export const maxDuration = 120;

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

// Walk the QBO report's hierarchical Rows tree and yield every leaf data row.
function* walkRows(node: any): Generator<any> {
  if (!node) return;
  if (Array.isArray(node)) {
    for (const r of node) yield* walkRows(r);
    return;
  }
  if (node.Rows?.Row) { yield* walkRows(node.Rows.Row); return; }
  if (Array.isArray(node.ColData) && node.type !== "Section") yield node;
}

function pickColIndex(columns: any[], titles: string[]): number {
  for (let i = 0; i < columns.length; i++) {
    const t = (columns[i]?.ColTitle || "").toLowerCase();
    if (titles.some(needle => t === needle || t.includes(needle))) return i;
  }
  return -1;
}

export async function POST() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const token = await getValidToken(orgId!);
  if (!token) return bad("QBO not connected", 400);

  const today = new Date().toISOString().slice(0, 10);
  const url =
    `${QBO_API}/${token.realmId}/reports/AgedReceivableDetail` +
    `?report_date=${today}` +
    `&aging_method=Report_Date` +
    `&accounting_method=Accrual` +
    `&num_periods=4&aging_period=30&minorversion=65`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    return bad(`QBO AgedReceivableDetail ${res.status}: ${await res.text()}`, res.status);
  }
  const report = await res.json();

  // Find the Transaction Type and Num columns; QBO reports the JE id on Num.
  const columns: any[] = report?.Columns?.Column || [];
  const colTxnType = pickColIndex(columns, ["transaction type", "txn type", "type"]);
  const colNum     = pickColIndex(columns, ["num", "number"]);

  const openJournalIds = new Set<string>();
  for (const row of walkRows(report?.Rows?.Row)) {
    const cd = row.ColData;
    if (!Array.isArray(cd)) continue;
    const txnType = String(cd[colTxnType]?.value || "");
    if (!/journal/i.test(txnType)) continue;
    const jeId = String(cd[colNum]?.id ?? cd[colNum]?.value ?? "").trim();
    if (jeId) openJournalIds.add(jeId);
  }

  // Pull our JEs and split into "still open per QBO" vs "closed per QBO".
  const ourJes = await db
    .select({ id: journalEntryArLines.id, qboJournalId: journalEntryArLines.qboJournalId, voided: journalEntryArLines.voided })
    .from(journalEntryArLines)
    .where(eq(journalEntryArLines.orgId, orgId!));

  const idsToReopen: string[] = [];   // currently voided, but QBO has them as open → un-void
  const idsToClose:  string[] = [];   // currently active, but QBO has them as closed → void

  for (const je of ourJes) {
    const qboOpen = openJournalIds.has(je.qboJournalId);
    if (qboOpen && je.voided)       idsToReopen.push(je.id);
    if (!qboOpen && !je.voided)     idsToClose.push(je.id);
  }

  if (idsToClose.length > 0) {
    for (let i = 0; i < idsToClose.length; i += 200) {
      await db.update(journalEntryArLines)
        .set({ voided: true, updatedAt: new Date() })
        .where(and(
          eq(journalEntryArLines.orgId, orgId!),
          inArray(journalEntryArLines.id, idsToClose.slice(i, i + 200)),
        ));
    }
  }
  if (idsToReopen.length > 0) {
    for (let i = 0; i < idsToReopen.length; i += 200) {
      await db.update(journalEntryArLines)
        .set({ voided: false, updatedAt: new Date() })
        .where(and(
          eq(journalEntryArLines.orgId, orgId!),
          inArray(journalEntryArLines.id, idsToReopen.slice(i, i + 200)),
        ));
    }
  }

  return ok({
    asOf:                today,
    jeOpenPerQbo:        openJournalIds.size,
    jeRowsInLedger:      ourJes.length,
    jeClosedNow:         idsToClose.length,
    jeReopenedNow:       idsToReopen.length,
    note:
      idsToClose.length + idsToReopen.length === 0
        ? "Every JE in our ledger already matches QBO's open/closed state."
        : `Reconciled JE state: ${idsToClose.length} JE(s) marked closed, ${idsToReopen.length} reopened. Re-run the customer reconciliation to see the drift collapse.`,
  });
}
