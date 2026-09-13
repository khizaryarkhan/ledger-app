/**
 * Every QuickBooks entity we want to be notified about.
 *
 * ⚠️ THIS LIST DOES NOT SUBSCRIBE US TO ANYTHING. Which entities QBO actually
 * sends is configured per-app in the Intuit developer portal (Dashboard → your
 * app → Webhooks), NOT in code. Adding a name here only means we will keep the
 * event if it arrives. If an entity is not ticked in that portal, no event is
 * ever sent and nothing below will fire — same class of "the code alone is not
 * enough" step as the wildcard DNS note in CLAUDE.md.
 *
 * The twelve posting entities come from INGEST_ENTITIES (lib/accounting/
 * qbo-ingest.ts); the rest are the master-data lists whose changes alter how a
 * transaction is interpreted — an account renamed or merged, an item's income
 * account changed, a tax rate edited.
 */
export const QBO_WEBHOOK_ENTITIES = [
  // Posting transactions — everything that can move the ledger.
  "Invoice", "CreditMemo", "SalesReceipt", "RefundReceipt",
  "Bill", "VendorCredit", "Purchase",
  "Payment", "BillPayment", "Deposit", "Transfer", "JournalEntry",
  // Non-posting documents we mirror or report on.
  "Estimate", "PurchaseOrder", "TimeActivity",
  // Master data.
  "Account", "Item", "Customer", "Vendor", "Employee",
  "Class", "Department", "Term", "PaymentMethod", "TaxService", "Budget",
] as const;

/** AR entities handled by the receivables sync (lib/qbo-sync.ts). */
export const AR_WEBHOOK_ENTITIES = new Set(["Invoice", "Payment", "CreditMemo", "Customer", "RefundReceipt"]);

/**
 * AP entities handled by the payables sync (real-time bill pull). A QBO Payment
 * against a bill also updates the Bill, so the "Bill" event covers paid/closed.
 */
export const AP_WEBHOOK_ENTITIES = new Set(["Bill"]);

export type QboEntityNotification = { name: string; id: string; operation: string; deletedId?: string };

/**
 * Split one notification's entities into the three buckets the handler needs.
 *
 * Extracted from the route so it can be tested without importing a module that
 * pulls in the database and next/headers (CLAUDE.md: "to test route logic,
 * extract it"). The split is worth pinning down because getting it wrong is
 * silent in both directions: an entity wrongly placed in `ar` reaches a sync
 * that cannot handle it, and one wrongly placed in `other` stops being synced
 * at all while still looking captured.
 */
export function partitionWebhookEntities(entities: any[]): {
  ar: QboEntityNotification[];
  ap: { id: string; operation: string; deletedId?: string }[];
  other: QboEntityNotification[];
} {
  const list = Array.isArray(entities) ? entities : [];
  const base = (e: any) => ({
    name: e?.name, id: e?.id, operation: e?.operation,
    ...(e?.deletedId ? { deletedId: e.deletedId } : {}),
  });
  return {
    ar: list.filter(e => AR_WEBHOOK_ENTITIES.has(e?.name)).map(base),
    // Deliberately no `name`: deduplicateQboEntities distinguishes an AP change
    // from an AR one by the ABSENCE of that field. Adding it here would make
    // every Bill change look like an AR change to the de-duplicator.
    ap: list.filter(e => AP_WEBHOOK_ENTITIES.has(e?.name))
            .map(e => ({ id: e?.id, operation: e?.operation, ...(e?.deletedId ? { deletedId: e.deletedId } : {}) })),
    other: list.filter(e => !AR_WEBHOOK_ENTITIES.has(e?.name) && !AP_WEBHOOK_ENTITIES.has(e?.name)).map(base),
  };
}
