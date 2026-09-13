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
  apAccountId: string;
  undepositedFundsAccountId: string;
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

// ═══════════════════════════════════════════════════════════════════════════
// Shared line handling
//
// QBO puts "which account does this line hit" in a different place per
// DetailType. These helpers centralise that, so every mapper below routes an
// unknown account to suspense identically — the alternative is a dozen
// slightly different fallbacks, most of them wrong.
// ═══════════════════════════════════════════════════════════════════════════

/** Money-carrying lines on a purchase-side document (Bill, Purchase, VendorCredit). */
function expenseLinesOf(txn: any, ctx: GlMapContext, unmapped: string[], side: "debit" | "credit", name: Partial<GlLine>): GlLine[] {
  const out: GlLine[] = [];
  for (const l of (Array.isArray(txn?.Line) ? txn.Line : [])) {
    const dt = l?.DetailType;
    if (dt === "SubTotalLineDetail" || dt === "DescriptionOnly") continue;
    const amt = round2(num(l?.Amount));
    if (amt === 0) continue;
    // AccountBasedExpenseLineDetail names the account directly. An item-based
    // line names an Item, whose expense account is only visible when QBO
    // includes the ref — otherwise it falls to suspense like any other miss.
    const ref = l?.AccountBasedExpenseLineDetail?.AccountRef?.value
             ?? l?.ItemBasedExpenseLineDetail?.ItemAccountRef?.value;
    out.push({ accountId: resolveAccount(ref, ctx, unmapped), [side]: amt, description: l?.Description ?? null, ...name } as GlLine);
  }
  return out;
}

/** Money-carrying lines on a sales-side document. */
function salesLinesOf(txn: any, ctx: GlMapContext, unmapped: string[], side: "debit" | "credit", name: Partial<GlLine>): GlLine[] {
  const out: GlLine[] = [];
  for (const l of (Array.isArray(txn?.Line) ? txn.Line : [])) {
    const dt = l?.DetailType;
    if (dt === "SubTotalLineDetail" || dt === "DescriptionOnly") continue;
    const amt = round2(num(l?.Amount));
    if (amt === 0) continue;
    // A discount always sits on the OPPOSITE side to the revenue it reduces.
    if (dt === "DiscountLineDetail") {
      const acc = resolveAccount(l?.DiscountLineDetail?.DiscountAccountRef?.value, ctx, unmapped);
      out.push({ accountId: acc, [side === "credit" ? "debit" : "credit"]: amt, description: l?.Description ?? "Discount", ...name } as GlLine);
      continue;
    }
    const acc = resolveAccount(l?.SalesItemLineDetail?.ItemAccountRef?.value, ctx, unmapped);
    out.push({ accountId: acc, [side]: amt, description: l?.Description ?? null, ...name } as GlLine);
  }
  return out;
}

/** The account a receipt settles through; Undeposited Funds when QBO omits it. */
function depositAccount(ref: string | null | undefined, ctx: GlMapContext, unmapped: string[]): string {
  if (ref == null || ref === "") return ctx.undepositedFundsAccountId;
  return resolveAccount(ref, ctx, unmapped);
}

function baseEntry(txn: any, sourceType: string, lines: GlLine[], unmapped: string[], ctx: GlMapContext): MappedEntry {
  return {
    externalId: String(txn.Id),
    externalSource: "qbo",
    externalSyncToken: txn.SyncToken != null ? String(txn.SyncToken) : null,
    entryDate: reqDate(txn.TxnDate, "TxnDate"),
    dueDate: typeof txn.DueDate === "string" ? txn.DueDate.slice(0, 10) : null,
    docNumber: txn.DocNumber != null ? String(txn.DocNumber) : null,
    reference: txn.PONumber != null ? String(txn.PONumber) : null,
    sourceType,
    memo: txn.PrivateNote ?? null,
    lines: balanceTo(lines, ctx.suspenseAccountId),
    unmapped,
  };
}

function requireId(txn: any, what: string) {
  if (!txn?.Id) throw new QboMapError(`${what} has no Id`);
}

function requireTotal(txn: any, what: string): number {
  const total = round2(num(txn.TotalAmt));
  if (total === 0) throw new QboMapError(`${what} ${txn.Id} has a zero total — refusing to post an empty entry`);
  return total;
}

function partyName(txn: any, kind: "Customer" | "Vendor"): Partial<GlLine> {
  const ref = kind === "Customer" ? txn?.CustomerRef : txn?.VendorRef;
  return { nameType: kind, nameId: null, nameLabel: ref?.name ?? null };
}

/** Customer payment: Dr bank (or Undeposited Funds) / Cr A/R. */
export function mapQboPayment(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "payment");
  const unmapped: string[] = [];
  const name = partyName(txn, "Customer");
  const total = requireTotal(txn, "payment");
  // The FULL amount hits A/R even when part is unapplied: QBO carries an
  // unapplied payment as a credit balance on the customer's A/R, it does not
  // park it elsewhere. Splitting it out here would misstate the control account.
  const lines: GlLine[] = [
    { accountId: depositAccount(txn.DepositToAccountRef?.value, ctx, unmapped), debit: total, description: "Customer payment", ...name },
    { accountId: ctx.arAccountId, credit: total, description: "Customer payment", ...name },
  ];
  return baseEntry(txn, "Payment", lines, unmapped, ctx);
}

/** Credit memo: the mirror image of an invoice. Dr revenue + tax / Cr A/R. */
export function mapQboCreditMemo(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "credit memo");
  const unmapped: string[] = [];
  const name = partyName(txn, "Customer");
  const total = requireTotal(txn, "credit memo");
  const lines: GlLine[] = [...salesLinesOf(txn, ctx, unmapped, "debit", name)];
  const tax = round2(num(txn.TxnTaxDetail?.TotalTax));
  if (tax !== 0) lines.push({ accountId: ctx.taxPayableAccountId, debit: tax, description: "Sales tax", ...name });
  lines.push({ accountId: ctx.arAccountId, credit: total, description: `Credit memo ${txn.DocNumber ?? txn.Id}`, ...name });
  if (lines.length < 2) throw new QboMapError(`credit memo ${txn.Id} produced no lines`);
  return baseEntry(txn, "CreditNote", lines, unmapped, ctx);
}

/** Sales receipt: paid at the point of sale, so it never touches A/R. */
export function mapQboSalesReceipt(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "sales receipt");
  const unmapped: string[] = [];
  const name = partyName(txn, "Customer");
  const total = requireTotal(txn, "sales receipt");
  const lines: GlLine[] = [
    { accountId: depositAccount(txn.DepositToAccountRef?.value, ctx, unmapped), debit: total, description: "Sales receipt", ...name },
    ...salesLinesOf(txn, ctx, unmapped, "credit", name),
  ];
  const tax = round2(num(txn.TxnTaxDetail?.TotalTax));
  if (tax !== 0) lines.push({ accountId: ctx.taxPayableAccountId, credit: tax, description: "Sales tax", ...name });
  if (lines.length < 2) throw new QboMapError(`sales receipt ${txn.Id} produced no income lines`);
  return baseEntry(txn, "SalesReceipt", lines, unmapped, ctx);
}

/** Refund receipt: money back out of the bank. */
export function mapQboRefundReceipt(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "refund receipt");
  const unmapped: string[] = [];
  const name = partyName(txn, "Customer");
  const total = requireTotal(txn, "refund receipt");
  const lines: GlLine[] = [...salesLinesOf(txn, ctx, unmapped, "debit", name)];
  const tax = round2(num(txn.TxnTaxDetail?.TotalTax));
  if (tax !== 0) lines.push({ accountId: ctx.taxPayableAccountId, debit: tax, description: "Sales tax", ...name });
  lines.push({ accountId: depositAccount(txn.DepositToAccountRef?.value, ctx, unmapped), credit: total, description: "Refund", ...name });
  if (lines.length < 2) throw new QboMapError(`refund receipt ${txn.Id} produced no lines`);
  return baseEntry(txn, "RefundReceipt", lines, unmapped, ctx);
}

/** Bill: Dr expense/inventory / Cr A/P. */
export function mapQboBill(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "bill");
  const unmapped: string[] = [];
  const name = partyName(txn, "Vendor");
  const total = requireTotal(txn, "bill");
  const lines: GlLine[] = [...expenseLinesOf(txn, ctx, unmapped, "debit", name)];
  const tax = round2(num(txn.TxnTaxDetail?.TotalTax));
  if (tax !== 0) lines.push({ accountId: ctx.taxPayableAccountId, debit: tax, description: "Purchase tax", ...name });
  lines.push({ accountId: ctx.apAccountId, credit: total, description: `Bill ${txn.DocNumber ?? txn.Id}`, ...name });
  if (lines.length < 2) throw new QboMapError(`bill ${txn.Id} produced no expense lines`);
  return baseEntry(txn, "Bill", lines, unmapped, ctx);
}

/** Bill payment: Dr A/P / Cr bank or credit card, per PayType. */
export function mapQboBillPayment(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "bill payment");
  const unmapped: string[] = [];
  const name = partyName(txn, "Vendor");
  const total = requireTotal(txn, "bill payment");
  // PayType decides which sub-object carries the funding account. An unknown
  // PayType must NOT silently pick one — it goes to suspense like any other
  // unresolvable reference, so the ambiguity is visible rather than guessed.
  const fundingRef = txn.PayType === "Check" ? txn.CheckPayment?.BankAccountRef?.value
                   : txn.PayType === "CreditCard" ? txn.CreditCardPayment?.CCAccountRef?.value
                   : undefined;
  const lines: GlLine[] = [
    { accountId: ctx.apAccountId, debit: total, description: "Bill payment", ...name },
    { accountId: resolveAccount(fundingRef, ctx, unmapped), credit: total, description: "Bill payment", ...name },
  ];
  return baseEntry(txn, "BillPayment", lines, unmapped, ctx);
}

/** Vendor credit: Dr A/P / Cr expense — the mirror image of a bill. */
export function mapQboVendorCredit(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "vendor credit");
  const unmapped: string[] = [];
  const name = partyName(txn, "Vendor");
  const total = requireTotal(txn, "vendor credit");
  const lines: GlLine[] = [
    { accountId: ctx.apAccountId, debit: total, description: "Vendor credit", ...name },
    ...expenseLinesOf(txn, ctx, unmapped, "credit", name),
  ];
  if (lines.length < 2) throw new QboMapError(`vendor credit ${txn.Id} produced no expense lines`);
  return baseEntry(txn, "VendorCredit", lines, unmapped, ctx);
}

/**
 * Purchase (cheque, cash or credit card): Dr expense / Cr the funding account.
 *
 * `Credit: true` marks a credit-card REFUND, which reverses both sides.
 * Getting this backwards posts a refund as a spend and overstates expenses.
 */
export function mapQboPurchase(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "purchase");
  const unmapped: string[] = [];
  const name = partyName(txn, "Vendor");
  const total = requireTotal(txn, "purchase");
  const isRefund = txn.Credit === true;
  const expenseSide: "debit" | "credit" = isRefund ? "credit" : "debit";
  const fundingSide: "debit" | "credit" = isRefund ? "debit" : "credit";
  const lines: GlLine[] = [...expenseLinesOf(txn, ctx, unmapped, expenseSide, name)];
  const tax = round2(num(txn.TxnTaxDetail?.TotalTax));
  if (tax !== 0) lines.push({ accountId: ctx.taxPayableAccountId, [expenseSide]: tax, description: "Purchase tax", ...name } as GlLine);
  lines.push({ accountId: resolveAccount(txn.AccountRef?.value, ctx, unmapped), [fundingSide]: total, description: isRefund ? "Refund" : "Purchase", ...name } as GlLine);
  if (lines.length < 2) throw new QboMapError(`purchase ${txn.Id} produced no expense lines`);
  return baseEntry(txn, "Purchase", lines, unmapped, ctx);
}

/** Bank deposit: Dr the bank / Cr each source line. */
export function mapQboDeposit(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "deposit");
  const unmapped: string[] = [];
  const total = requireTotal(txn, "deposit");
  const lines: GlLine[] = [
    { accountId: resolveAccount(txn.DepositToAccountRef?.value, ctx, unmapped), debit: total, description: "Deposit" },
  ];
  for (const l of (Array.isArray(txn.Line) ? txn.Line : [])) {
    const amt = round2(num(l?.Amount));
    if (amt === 0) continue;
    // A line with a LinkedTxn and no AccountRef is a payment already sitting in
    // Undeposited Funds being swept into the bank; one with an AccountRef is
    // direct income. Treating the first as income would double-count revenue.
    const ref = l?.DepositLineDetail?.AccountRef?.value;
    const acc = (!ref && Array.isArray(l?.LinkedTxn) && l.LinkedTxn.length > 0)
      ? ctx.undepositedFundsAccountId
      : resolveAccount(ref, ctx, unmapped);
    lines.push({ accountId: acc, credit: amt, description: l?.Description ?? null });
  }
  if (lines.length < 2) throw new QboMapError(`deposit ${txn.Id} produced no source lines`);
  return baseEntry(txn, "Deposit", lines, unmapped, ctx);
}

/** Transfer between two of the org's own accounts. */
export function mapQboTransfer(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "transfer");
  const unmapped: string[] = [];
  const amt = round2(num(txn.Amount));
  if (amt === 0) throw new QboMapError(`transfer ${txn.Id} has a zero amount`);
  const lines: GlLine[] = [
    { accountId: resolveAccount(txn.ToAccountRef?.value, ctx, unmapped), debit: amt, description: "Transfer in" },
    { accountId: resolveAccount(txn.FromAccountRef?.value, ctx, unmapped), credit: amt, description: "Transfer out" },
  ];
  return baseEntry(txn, "Transfer", lines, unmapped, ctx);
}

/** Journal entry: QBO already states debits and credits, so take them as given. */
export function mapQboJournalEntry(txn: any, ctx: GlMapContext): MappedEntry {
  requireId(txn, "journal entry");
  const unmapped: string[] = [];
  const lines: GlLine[] = [];
  for (const l of (Array.isArray(txn.Line) ? txn.Line : [])) {
    const d = l?.JournalEntryLineDetail;
    if (!d) continue;
    const amt = round2(num(l?.Amount));
    if (amt === 0) continue;
    const acc = resolveAccount(d?.AccountRef?.value, ctx, unmapped);
    const entity = d?.Entity?.EntityRef;
    const name: Partial<GlLine> = entity
      ? { nameType: d?.Entity?.Type ?? null, nameId: null, nameLabel: entity?.name ?? null }
      : {};
    // PostingType is authoritative and must never be defaulted — guessing it
    // silently flips the sign of a line and still balances if you guess twice.
    if (d.PostingType === "Debit")       lines.push({ accountId: acc, debit: amt, description: l?.Description ?? null, ...name });
    else if (d.PostingType === "Credit") lines.push({ accountId: acc, credit: amt, description: l?.Description ?? null, ...name });
    else throw new QboMapError(`journal entry ${txn.Id} has a line with no PostingType`);
  }
  if (lines.length < 2) throw new QboMapError(`journal entry ${txn.Id} produced fewer than two lines`);
  return baseEntry(txn, "Manual", lines, unmapped, ctx);
}

/** QBO entity name → mapper. */
export const QBO_MAPPERS: Record<string, (txn: any, ctx: GlMapContext) => MappedEntry> = {
  Invoice:       mapQboInvoice,
  Payment:       mapQboPayment,
  CreditMemo:    mapQboCreditMemo,
  SalesReceipt:  mapQboSalesReceipt,
  RefundReceipt: mapQboRefundReceipt,
  Bill:          mapQboBill,
  BillPayment:   mapQboBillPayment,
  VendorCredit:  mapQboVendorCredit,
  Purchase:      mapQboPurchase,
  Deposit:       mapQboDeposit,
  Transfer:      mapQboTransfer,
  JournalEntry:  mapQboJournalEntry,
};

/**
 * Entities that legitimately never reach the ledger. Listed explicitly so the
 * ingestion job can distinguish "we decided to skip this" from "we forgot
 * this" — which is the difference between a complete ledger and a quietly
 * incomplete one.
 */
export const QBO_NON_POSTING = ["Estimate", "PurchaseOrder", "TimeActivity"] as const;

export function mapQboTransaction(entity: string, txn: any, ctx: GlMapContext): MappedEntry {
  const fn = QBO_MAPPERS[entity];
  if (!fn) throw new QboMapError(`no GL mapping for QBO entity "${entity}"`);
  return fn(txn, ctx);
}
