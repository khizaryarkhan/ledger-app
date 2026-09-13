/**
 * Ingesting a QBO company's transactions into our own general ledger.
 *
 * SHADOW BY DESIGN. This writes journal_entries/journal_lines and nothing else.
 * It does not touch `invoices`, `payments`, `payment_applications` or any other
 * mirror table, so the AR management a paying client uses every day is entirely
 * unaffected by running it. Nothing reads these entries yet either — the point
 * of the exercise is to post them and then prove, against QBO's own
 * TrialBalance, that our ledger reproduces their books before anything depends
 * on it.
 *
 * ── Why page-at-a-time ──────────────────────────────────────────────────────
 * A company's whole history can be tens of thousands of transactions. Holding
 * them in memory and posting at the end means an interrupted run loses
 * everything; posting per page with a cursor means it resumes. `qboQueryPage`
 * exists for exactly this.
 *
 * ── Why replace rather than reverse ─────────────────────────────────────────
 * The GL is immutable and reversal-only for entries WE author, which is right:
 * they are the book of record. A mirrored entry is not — QBO is. So an edited
 * QBO transaction replaces its mirrored entry rather than generating a
 * reversal plus a repost. Five edits in QBO must not become eleven entries
 * here; nobody could reconcile that against a company file showing one
 * transaction.
 */

import { db } from "@/db";
import { journalEntries, journalLines } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { postJournalEntry } from "@/lib/ledger";
import { getOrgQboToken } from "@/lib/qbo-token";
import { qboQueryPage } from "@/lib/batch/qbo-client";
import { buildGlMapContext, accountCoverage } from "./qbo-gl-context";
import { mapQboTransaction, ingestDecision, QBO_MAPPERS, QboMapError, type GlMapContext } from "./qbo-gl";

/**
 * The QBO entities we post, in the order we post them.
 *
 * Order is presentational only — every entry is self-balancing and carries its
 * own date, so nothing here depends on what was posted before it. Documents
 * come before the payments that settle them purely so a partial run reads
 * sensibly.
 */
export const INGEST_ENTITIES = [
  "Invoice", "CreditMemo", "SalesReceipt", "RefundReceipt",
  "Bill", "VendorCredit", "Purchase",
  "Payment", "BillPayment", "Deposit", "Transfer", "JournalEntry",
] as const;

export type IngestEntity = (typeof INGEST_ENTITIES)[number];

export type EntityReport = {
  entity: string;
  scanned: number;
  posted: number;
  replaced: number;
  skipped: number;
  failed: number;
  /** One line per failure — the QBO id and why, so it can be chased down. */
  errors: { id: string; reason: string }[];
  /** QBO account ids that had to fall back to suspense, with a count each. */
  unmapped: Record<string, number>;
};

export type IngestReport = {
  orgId: string;
  from: string | null;
  dryRun: boolean;
  coverage: { total: number; mapped: number };
  entities: EntityReport[];
  totals: { scanned: number; posted: number; replaced: number; skipped: number; failed: number };
};

export type IngestOptions = {
  /** Only transactions on or after this date (YYYY-MM-DD). Null = all history. */
  from?: string | null;
  /** Map and validate, but write nothing. The safe first run. */
  dryRun?: boolean;
  /** Restrict to these entities (default: all of INGEST_ENTITIES). */
  only?: readonly string[];
  /** Called after each page so a long run can report progress. */
  onProgress?: (r: EntityReport) => void;
  pageSize?: number;
};

const emptyReport = (entity: string): EntityReport =>
  ({ entity, scanned: 0, posted: 0, replaced: 0, skipped: 0, failed: 0, errors: [], unmapped: {} });

/** Existing mirrored entries for these QBO ids, so we can decide post/skip/replace. */
async function existingByExternalId(orgId: string, ids: string[]) {
  if (ids.length === 0) return new Map<string, { id: string; externalSyncToken: string | null }>();
  const rows = await db
    .select({ id: journalEntries.id, externalId: journalEntries.externalId, externalSyncToken: journalEntries.externalSyncToken })
    .from(journalEntries)
    .where(and(
      eq(journalEntries.orgId, orgId),
      eq(journalEntries.externalSource, "qbo"),
      inArray(journalEntries.externalId, ids),
    ));
  const m = new Map<string, { id: string; externalSyncToken: string | null }>();
  for (const r of rows) if (r.externalId) m.set(r.externalId, { id: r.id, externalSyncToken: r.externalSyncToken });
  return m;
}

/**
 * Remove a mirrored entry so it can be re-posted.
 *
 * Lines first, then the header: neon-http has no transactions, so if the
 * process dies between the two, orphaned lines would be far worse than a
 * headerless gap — they would be counted by any query that sums journal_lines.
 * Deleting lines first means the worst interruption leaves an empty entry,
 * which contributes nothing to any balance.
 *
 * Losing a mirrored entry entirely is recoverable in a way losing a native one
 * would not be: the next run finds no entry for that QBO id and posts it again.
 */
async function deleteMirroredEntry(orgId: string, entryId: string) {
  await db.delete(journalLines).where(and(eq(journalLines.orgId, orgId), eq(journalLines.entryId, entryId)));
  await db.delete(journalEntries).where(and(
    eq(journalEntries.orgId, orgId),
    eq(journalEntries.id, entryId),
    // Belt and braces: never delete an entry that is not a QBO mirror, whatever
    // id gets passed in. A native entry is the book of record and immutable.
    eq(journalEntries.externalSource, "qbo"),
  ));
}

/** The WHERE clause limiting how far back we go. */
export function ingestWhere(entity: string, from: string | null | undefined): string {
  if (!from) return "";
  // Transfer has no TxnDate in some QBO minor versions, but every posting
  // entity does carry it; keep one clause so the cutoff means the same thing
  // everywhere rather than silently differing per entity.
  return `TxnDate >= '${from}'`;
}

export async function ingestOrgTransactions(orgId: string, opts: IngestOptions = {}): Promise<IngestReport> {
  const { from = null, dryRun = false, onProgress, pageSize = 200 } = opts;
  const entities = (opts.only ?? INGEST_ENTITIES).filter(e => QBO_MAPPERS[e]);

  const token = await getOrgQboToken(orgId);
  if (!token) throw new Error(`org ${orgId} has no QuickBooks connection`);

  const ctx = await buildGlMapContext(orgId);
  const coverage = await accountCoverage(orgId);

  const report: IngestReport = {
    orgId, from, dryRun, coverage, entities: [],
    totals: { scanned: 0, posted: 0, replaced: 0, skipped: 0, failed: 0 },
  };

  for (const entity of entities) {
    const er = emptyReport(entity);
    let cursor: number | null = 1;
    while (cursor !== null) {
      const page = await qboQueryPage(token, entity, ingestWhere(entity, from), cursor, pageSize);
      cursor = page.nextStart;
      if (page.records.length === 0) break;

      await ingestRecords(orgId, entity, page.records, ctx, dryRun, er);
      onProgress?.(er);
    }
    report.entities.push(er);
    for (const k of ["scanned", "posted", "replaced", "skipped", "failed"] as const) report.totals[k] += er[k];
  }

  return report;
}

/**
 * One page. Exported so a resumable job can drive pages itself and checkpoint
 * between them rather than running the whole entity in one function invocation.
 */
export async function ingestRecords(
  orgId: string,
  entity: string,
  records: any[],
  ctx: GlMapContext,
  dryRun: boolean,
  er: EntityReport,
): Promise<void> {
  const ids = records.map(r => String(r?.Id ?? "")).filter(Boolean);
  const existing = await existingByExternalId(orgId, ids);

  for (const txn of records) {
    er.scanned++;
    const qboId = String(txn?.Id ?? "");
    try {
      const decision = ingestDecision(existing.get(qboId) ?? null, txn);
      if (decision === "skip") { er.skipped++; continue; }

      // Map FIRST, before deleting anything. A mapping failure on a replace
      // would otherwise leave the org with neither the old entry nor the new
      // one — strictly worse than leaving the stale entry in place.
      const mapped = mapQboTransaction(entity, txn, ctx);
      for (const u of mapped.unmapped) er.unmapped[u] = (er.unmapped[u] ?? 0) + 1;

      if (dryRun) { decision === "replace" ? er.replaced++ : er.posted++; continue; }

      if (decision === "replace") {
        await deleteMirroredEntry(orgId, existing.get(qboId)!.id);
      }

      await postJournalEntry({
        orgId,
        entryDate: mapped.entryDate,
        dueDate: mapped.dueDate,
        docNumber: mapped.docNumber,
        reference: mapped.reference,
        memo: mapped.memo,
        sourceType: mapped.sourceType,
        externalId: mapped.externalId,
        externalSource: mapped.externalSource,
        externalSyncToken: mapped.externalSyncToken,
        createdBy: null,
        lines: mapped.lines as any,
      });

      decision === "replace" ? er.replaced++ : er.posted++;
    } catch (e: any) {
      er.failed++;
      // One bad transaction must not abort the run: the rest of the company's
      // history is still worth having, and the failure is recorded with the id
      // so it can be looked at in QBO directly.
      er.errors.push({ id: qboId, reason: e instanceof QboMapError ? e.message : (e?.message ?? String(e)) });
    }
  }
}
