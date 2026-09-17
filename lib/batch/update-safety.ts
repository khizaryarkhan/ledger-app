/**
 * Refuse an update that would silently destroy part of a QuickBooks record.
 *
 * ── THE PROBLEM THIS EXISTS FOR ──────────────────────────────────────────────
 *
 * An update in Data Studio is a FULL (non-sparse) write: the Line array we send
 * becomes the record's complete new truth, and anything not in it is removed.
 * That is deliberate and correct — it is what makes "I edited the sheet" mean
 * what it says, and it was itself the fix for updates appending lines instead
 * of replacing them.
 *
 * But it has a sharp edge. The spreadsheet can only carry what `toRows` knows
 * how to export, and `toRows` does not model every line type QuickBooks can
 * hold. A line the export cannot represent is absent from the sheet, therefore
 * absent from the payload, therefore DELETED on save — with no error, nothing
 * in the job history, and nothing visible until someone opens the record in
 * QuickBooks and finds it changed.
 *
 * That is the worst failure shape available to us: silent, invisible, and on a
 * customer's books.
 *
 * ── THE APPROACH ─────────────────────────────────────────────────────────────
 *
 * Do NOT try to model every line type. That is an endless chase, and a
 * half-modelled line type is worse than an unmodelled one because it writes
 * back something plausible and wrong.
 *
 * Instead: before writing, read what is actually in the record and refuse if it
 * contains anything the round trip would drop. A refusal is visible, names the
 * record, and leaves the books untouched — the person can edit that one
 * document in QuickBooks and everything else in their file still imports. Much
 * better than a silent 200 and a mangled transaction.
 *
 * This mirrors the existing progress-invoicing guard in commitOneDoc, which
 * refuses to update an Estimate the API would silently unlink from its
 * invoices. Same principle, generalised.
 *
 * Pure — no I/O — so it is provable in tests against real QBO payload shapes
 * rather than against a live company file.
 */

/** What a given entity's exporter can faithfully round-trip. */
type Coverage = {
  /** Line DetailTypes the sheet can carry back. */
  detailTypes?: string[];
  /**
   * DetailTypes that exist on the record but are QuickBooks' own derived
   * bookkeeping — it recomputes them on save, so not round-tripping them loses
   * nothing and must not trigger a refusal.
   */
  derived?: string[];
  /**
   * For payments, the Line array is a set of APPLICATIONS to other documents.
   * These are the LinkedTxn types the sheet can carry.
   */
  linkedTxnTypes?: string[];
  /**
   * True when the exporter round-trips each line's own QuickBooks id, so QBO
   * keeps the lines that were kept and removes only the ones actually deleted.
   * Those entities are safe by construction and need no check.
   */
  carriesLineIds?: boolean;
};

const SALES_LINES = ["SalesItemLineDetail"];
// QBO recomputes SubTotal on save. Discount is lifted into header columns by
// the sales mapper and rebuilt by the sales builder, so it survives the trip.
const SALES_DERIVED = ["SubTotalLineDetail", "DiscountLineDetail"];

const EXPENSE_LINES = ["AccountBasedExpenseLineDetail", "ItemBasedExpenseLineDetail"];
// TaxLineDetail is computed by QuickBooks from the lines and the tax code.
const EXPENSE_DERIVED = ["TaxLineDetail", "SubTotalLineDetail"];

export const UPDATE_COVERAGE: Record<string, Coverage> = {
  invoice:       { detailTypes: SALES_LINES, derived: SALES_DERIVED },
  estimate:      { detailTypes: SALES_LINES, derived: SALES_DERIVED },
  creditmemo:    { detailTypes: SALES_LINES, derived: SALES_DERIVED },
  salesreceipt:  { detailTypes: SALES_LINES, derived: SALES_DERIVED },
  refundreceipt: { detailTypes: SALES_LINES, derived: SALES_DERIVED },

  bill:             { detailTypes: EXPENSE_LINES, derived: EXPENSE_DERIVED },
  vendorcredit:     { detailTypes: EXPENSE_LINES, derived: EXPENSE_DERIVED },
  purchaseorder:    { detailTypes: EXPENSE_LINES, derived: EXPENSE_DERIVED },
  expense:          { detailTypes: EXPENSE_LINES, derived: EXPENSE_DERIVED },
  check:            { detailTypes: EXPENSE_LINES, derived: EXPENSE_DERIVED },
  creditcardcredit: { detailTypes: EXPENSE_LINES, derived: EXPENSE_DERIVED },

  // A payment's lines are applications. The exporter emits one row per applied
  // Invoice/Bill — but a payment can also carry a credit memo or vendor credit
  // application, and dropping one of those un-applies a credit on a customer's
  // books, which is a real balance change, not a cosmetic one.
  receivepayment: { linkedTxnTypes: ["Invoice"] },
  billpayment:    { linkedTxnTypes: ["Bill"] },

  // Journal lines are always JournalEntryLineDetail, and all of them are
  // exported — nothing to lose.
  journalentry: { detailTypes: ["JournalEntryLineDetail"] },

  // Bank Deposits round-trip each line's own id ("Line Id"), so QuickBooks is
  // told exactly which lines survived. Safe by construction.
  deposit: { carriesLineIds: true },
};

/** Friendly names, so a refusal says something a bookkeeper can act on. */
const DETAIL_TYPE_LABELS: Record<string, string> = {
  GroupLineDetail: "a bundle/group item",
  DescriptionOnlyLineDetail: "a description-only line",
  ItemBasedExpenseLineDetail: "an item line",
  AccountBasedExpenseLineDetail: "a category line",
  SalesItemLineDetail: "a product/service line",
  JournalEntryLineDetail: "a journal line",
  DepositLineDetail: "a deposit line",
  TaxLineDetail: "a tax line",
};

const label = (t: string) => DETAIL_TYPE_LABELS[t] ?? `a "${t.replace(/LineDetail$/, "")}" line`;

export type UnsafeUpdate = { reason: string };

/**
 * Inspect the record as it exists in QuickBooks RIGHT NOW (the fresh read
 * commitOneDoc already performs) and report anything an update would drop.
 *
 * Returns null when the update is safe to send.
 */
export function checkUpdateSafety(entityId: string, existing: any): UnsafeUpdate | null {
  const cov = UPDATE_COVERAGE[entityId];
  // An entity with no lines at all (lists, Transfer, TimeActivity) or one we
  // have not mapped: nothing to check. Deliberately permissive — this guard
  // exists to catch a KNOWN loss, not to block on unfamiliarity.
  if (!cov || cov.carriesLineIds) return null;

  const lines: any[] = Array.isArray(existing?.Line) ? existing.Line : [];
  if (!lines.length) return null;

  if (cov.linkedTxnTypes) {
    const dropped = new Set<string>();
    for (const l of lines) {
      const links: any[] = Array.isArray(l?.LinkedTxn) ? l.LinkedTxn : [];
      for (const x of links) {
        const t = String(x?.TxnType ?? "");
        if (t && !cov.linkedTxnTypes.includes(t)) dropped.add(t);
      }
    }
    if (dropped.size) {
      const list = [...dropped].join(", ");
      return {
        reason:
          `Skipped — this payment also applies to ${list}, which the spreadsheet cannot carry. ` +
          `Saving it would un-apply that, changing the balance on the customer's account. ` +
          `Edit this payment directly in QuickBooks.`,
      };
    }
    return null;
  }

  if (cov.detailTypes) {
    const known = new Set([...(cov.detailTypes ?? []), ...(cov.derived ?? [])]);
    const dropped = new Set<string>();
    for (const l of lines) {
      const t = String(l?.DetailType ?? "");
      if (t && !known.has(t)) dropped.add(t);
    }
    if (dropped.size) {
      const list = [...dropped].map(label).join(" and ");
      return {
        reason:
          `Skipped — this record contains ${list}, which the spreadsheet cannot carry. ` +
          `An update replaces every line, so saving it would delete that. ` +
          `Edit this one directly in QuickBooks; the rest of your file is unaffected.`,
      };
    }
  }

  return null;
}
