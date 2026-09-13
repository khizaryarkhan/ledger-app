/**
 * QBO transaction → native general-ledger entry.
 *
 * Phase 1 of bringing provider transactions into our own ledger instead of a
 * parallel mirror. Today a QBO-connected org's invoices/payments live ONLY in
 * the mirror tables (`invoices`, `payments`, `payment_applications`) and never
 * reach `journal_entries` — which is why `lib/accounting/financials.ts`
 * (P&L / trial balance / balance sheet) has never run against a real book: the
 * only paying org is QBO-connected.
 *
 * ── Why the mapping lives here, pure ────────────────────────────────────────
 * Everything in this file is a pure function over a QBO payload plus a
 * pre-resolved account map. No database, no network. That is deliberate: this
 * is money-path accounting logic for a live client's books, and it has to be
 * provable in tests rather than only observable in production. The impure parts
 * (fetching the payload, loading the account map, posting) live in the caller.
 *
 * ── The two rules that matter ───────────────────────────────────────────────
 * 1. NEVER DROP A LINE. Every QBO transaction is internally balanced, so
 *    dropping one unmappable line unbalances the entry and postJournalEntry
 *    rejects the whole thing — silently leaving a hole in the ledger. An
 *    unresolvable account goes to Suspense, which keeps the entry balanced and
 *    makes the problem visible as a balance somebody must clear.
 * 2. BALANCE IS ENFORCED HERE, NOT HOPED FOR. Rounding each line to cents can
 *    leave a sub-cent residue against a QBO-provided total; `balanceTo` closes
 *    it explicitly against a named account rather than letting validateEntry
 *    reject the entry for a penny.
 */

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** QBO Account.Id → native accounts.id, plus the fallbacks a mapping needs. */
export type GlMapContext = {
  /** QBO Account.Id → our accounts.id (from accounts.external_id). */
  accountByQboId: Map<string, string>;
  /** Where an unresolvable line lands. Never null — see rule 1. */
  suspenseAccountId: string;
  /** Control/system accounts, resolved by the caller from SYSTEM_ACCOUNTS. */
  arAccountId: string;
  taxPayableAccountId: string;
};

export type GlLine = {
  accountId: string;
  debit?: number;
  credit?: number;
  description?: string | null;
  nameType?: string | null;
  nameId?: string | null;
  nameLabel?: string | null;
};

export type MappedEntry = {
  externalId: string;
  externalSource: "qbo";
  externalSyncToken: string | null;
  entryDate: string;
  dueDate: string | null;
  docNumber: string | null;
  reference: string | null;
  sourceType: string;
  memo: string | null;
  lines: GlLine[];
  /** QBO account ids we could not resolve — surfaced so they can be fixed, not buried. */
  unmapped: string[];
};

export class QboMapError extends Error {}

/**
 * Resolve a QBO AccountRef to one of our accounts, recording a miss.
 * A missing ref is as much a miss as an unknown one — both mean "we do not know
 * where this belongs", and both must land in suspense rather than nowhere.
 */
function resolveAccount(qboAccountId: string | null | undefined, ctx: GlMapContext, unmapped: string[]): string {
  const key = qboAccountId == null ? "" : String(qboAccountId);
  if (key) {
    const hit = ctx.accountByQboId.get(key);
    if (hit) return hit;
  }
  unmapped.push(key || "(missing AccountRef)");
  return ctx.suspenseAccountId;
}

/** Sum of debits − sum of credits, to the cent. Zero means balanced. */
export function imbalanceOf(lines: GlLine[]): number {
  const d = lines.reduce((s, l) => s + round2(l.debit ?? 0), 0);
  const c = lines.reduce((s, l) => s + round2(l.credit ?? 0), 0);
  return round2(d - c);
}

/**
 * Close a sub-cent (or larger) residue against `accountId` so the entry can
 * post. Returns the lines unchanged when already balanced.
 *
 * A residue beyond `tolerance` is NOT silently plugged — that would turn a real
 * mapping bug into a quiet suspense balance. It throws, so the ingestion job
 * records a failure against that one transaction and moves on.
 */
export function balanceTo(lines: GlLine[], accountId: string, tolerance = 0.05): GlLine[] {
  const diff = imbalanceOf(lines);
  if (diff === 0) return lines;
  if (Math.abs(diff) > tolerance) {
    throw new QboMapError(`entry does not balance: debits − credits = ${diff.toFixed(2)} (tolerance ${tolerance.toFixed(2)})`);
  }
  // diff > 0 means debits exceed credits, so the plug is a credit.
  return [...lines, diff > 0
    ? { accountId, credit: Math.abs(diff), description: "Rounding" }
    : { accountId, debit: Math.abs(diff), description: "Rounding" }];
}

/** QBO dates arrive as YYYY-MM-DD; guard rather than post an entry to a bad date. */
function reqDate(v: unknown, field: string): string {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new QboMapError(`${field} is not a valid date: ${JSON.stringify(v)}`);
  return s;
}

/**
 * QBO Invoice → Dr A/R, Cr income per line, Cr sales tax.
 *
 * Line handling follows QBO's DetailType discriminator:
 *   - SalesItemLineDetail  → revenue, credited to the item's income account
 *   - DiscountLineDetail   → a DEBIT (it reduces revenue), never a negative credit
 *   - SubTotalLineDetail   → ignored; it is a display artefact, and summing it
 *                            would double the invoice
 *   - DescriptionOnly      → ignored; carries no money
 * Anything else is treated as revenue and routed through resolveAccount, so an
 * unrecognised detail type lands in suspense rather than vanishing.
 */
export function mapQboInvoice(txn: any, ctx: GlMapContext): MappedEntry {
  if (!txn?.Id) throw new QboMapError("invoice has no Id");
  const unmapped: string[] = [];
  const lines: GlLine[] = [];

  const customer = {
    nameType: "Customer" as const,
    nameId: null,
    nameLabel: txn.CustomerRef?.name ?? null,
  };

  const total = round2(num(txn.TotalAmt));
  if (total === 0) throw new QboMapError(`invoice ${txn.Id} has a zero total — refusing to post an empty entry`);

  // Dr Accounts Receivable for the full invoice value.
  lines.push({ accountId: ctx.arAccountId, debit: total, description: `Invoice ${txn.DocNumber ?? txn.Id}`, ...customer });

  for (const l of (Array.isArray(txn.Line) ? txn.Line : [])) {
    const dt = l?.DetailType;
    if (dt === "SubTotalLineDetail" || dt === "DescriptionOnly") continue;

    const amt = round2(num(l?.Amount));
    if (amt === 0) continue;

    if (dt === "DiscountLineDetail") {
      const acc = resolveAccount(l?.DiscountLineDetail?.DiscountAccountRef?.value, ctx, unmapped);
      lines.push({ accountId: acc, debit: amt, description: l?.Description ?? "Discount", ...customer });
      continue;
    }

    const acc = resolveAccount(l?.SalesItemLineDetail?.ItemAccountRef?.value, ctx, unmapped);
    lines.push({ accountId: acc, credit: amt, description: l?.Description ?? null, ...customer });
  }

  const tax = round2(num(txn.TxnTaxDetail?.TotalTax));
  if (tax !== 0) {
    lines.push({ accountId: ctx.taxPayableAccountId, credit: tax, description: "Sales tax", ...customer });
  }

  if (lines.length < 2) throw new QboMapError(`invoice ${txn.Id} produced no income lines`);

  return {
    externalId: String(txn.Id),
    externalSource: "qbo",
    externalSyncToken: txn.SyncToken != null ? String(txn.SyncToken) : null,
    entryDate: reqDate(txn.TxnDate, "TxnDate"),
    dueDate: typeof txn.DueDate === "string" ? txn.DueDate.slice(0, 10) : null,
    docNumber: txn.DocNumber != null ? String(txn.DocNumber) : null,
    reference: txn.PONumber != null ? String(txn.PONumber) : null,
    sourceType: "Invoice",
    memo: txn.PrivateNote ?? null,
    // The plug goes to suspense, not to a revenue account: a rounding residue
    // is a mapping artefact and must never quietly move reported profit.
    lines: balanceTo(lines, ctx.suspenseAccountId),
    unmapped,
  };
}

/**
 * Has this transaction changed since we last mirrored it?
 *
 * QBO bumps SyncToken on every edit, so an unchanged token means an identical
 * transaction and the ingestion job can skip it entirely — which is what makes
 * an incremental re-sync cheap rather than a full re-post.
 *
 * Unknown (never mirrored) → post. Token differs → replace. Same → skip.
 */
export function ingestDecision(
  existing: { externalSyncToken: string | null } | null | undefined,
  txn: { SyncToken?: unknown },
): "post" | "replace" | "skip" {
  if (!existing) return "post";
  const incoming = txn?.SyncToken != null ? String(txn.SyncToken) : null;
  if (existing.externalSyncToken == null || incoming == null) return "replace";
  return existing.externalSyncToken === incoming ? "skip" : "replace";
}
