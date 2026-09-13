/**
 * How a QBO webhook notification is split between the handlers.
 *
 * QuickBooks does not resend a notification once we have returned 200, so an
 * entity that falls through this split is gone for good. Two failure modes,
 * both silent:
 *  - an entity wrongly in `ar` reaches a sync that cannot handle it
 *  - an entity wrongly in `other` stops being synced while still looking
 *    captured, which is worse, because the log says it was handled
 */
import { describe, it, expect } from "vitest";
import {
  partitionWebhookEntities, QBO_WEBHOOK_ENTITIES,
  AR_WEBHOOK_ENTITIES, AP_WEBHOOK_ENTITIES,
} from "@/lib/qbo-webhook-entities";

const ev = (name: string, id = "1", operation = "Update", extra: any = {}) => ({ name, id, operation, ...extra });

describe("the three buckets", () => {
  it("routes AR entities to the receivables sync", () => {
    const { ar } = partitionWebhookEntities([ev("Invoice"), ev("Payment"), ev("CreditMemo"), ev("Customer"), ev("RefundReceipt")]);
    expect(ar.map(e => e.name)).toEqual(["Invoice", "Payment", "CreditMemo", "Customer", "RefundReceipt"]);
  });

  it("routes Bill to the payables sync", () => {
    const { ap, ar, other } = partitionWebhookEntities([ev("Bill", "7", "Create")]);
    expect(ap).toEqual([{ id: "7", operation: "Create" }]);
    expect(ar).toHaveLength(0);
    expect(other).toHaveLength(0);
  });

  it("gives AP changes NO name field — the de-duplicator relies on its absence", () => {
    // deduplicateQboEntities tells an AP change from an AR one purely by
    // whether `name` is present. Adding it here would make every Bill change
    // look like an AR change and be de-duplicated against the wrong key set.
    const { ap } = partitionWebhookEntities([ev("Bill")]);
    expect(ap[0]).not.toHaveProperty("name");
  });

  it("captures everything else rather than dropping it", () => {
    // QBO never resends after a 200, so anything not captured here is lost.
    const { other } = partitionWebhookEntities([
      ev("Deposit"), ev("JournalEntry"), ev("Transfer"), ev("Vendor"), ev("Account"), ev("Item"),
    ]);
    expect(other.map(e => e.name)).toEqual(["Deposit", "JournalEntry", "Transfer", "Vendor", "Account", "Item"]);
  });

  it("puts every entity in exactly one bucket", () => {
    const names = [...QBO_WEBHOOK_ENTITIES];
    const { ar, ap, other } = partitionWebhookEntities(names.map(n => ev(n)));
    expect(ar.length + ap.length + other.length).toBe(names.length);
  });
});

describe("details that must survive", () => {
  it("carries deletedId through on both AR and captured entities", () => {
    // A delete notification without its deletedId cannot be acted on at all.
    const { ar, other } = partitionWebhookEntities([
      ev("Invoice", "9", "Delete", { deletedId: "9" }),
      ev("Deposit", "4", "Delete", { deletedId: "4" }),
    ]);
    expect(ar[0].deletedId).toBe("9");
    expect(other[0].deletedId).toBe("4");
  });

  it("omits deletedId when there isn't one, rather than writing undefined", () => {
    expect(partitionWebhookEntities([ev("Invoice")])[
      "ar"
    ][0]).not.toHaveProperty("deletedId");
  });

  it("preserves the operation, which decides sync vs delete", () => {
    const { ar } = partitionWebhookEntities([ev("Invoice", "1", "Void")]);
    expect(ar[0].operation).toBe("Void");
  });

  it("survives a malformed or empty payload without throwing", () => {
    // This runs inside a webhook we must answer 200 to; throwing here would
    // make QBO retry for up to 14 days.
    for (const bad of [[], null as any, undefined as any, [{}], [{ name: null }]]) {
      expect(() => partitionWebhookEntities(bad)).not.toThrow();
    }
    expect(partitionWebhookEntities([{}]).other).toHaveLength(1);
  });
});

describe("the wanted-entity list", () => {
  it("covers every posting type the GL ingestion maps", () => {
    // If these drift apart, a transaction type gets ingested on a full run but
    // never updated afterwards — the ledger silently goes stale for that type.
    for (const e of ["Invoice", "CreditMemo", "SalesReceipt", "RefundReceipt", "Bill", "VendorCredit",
                     "Purchase", "Payment", "BillPayment", "Deposit", "Transfer", "JournalEntry"]) {
      expect(QBO_WEBHOOK_ENTITIES).toContain(e);
    }
  });

  it("covers the master data that changes how a transaction is read", () => {
    for (const e of ["Account", "Item", "Customer", "Vendor"]) {
      expect(QBO_WEBHOOK_ENTITIES).toContain(e);
    }
  });

  it("includes everything currently dispatched, so nothing in flight is dropped", () => {
    for (const e of [...AR_WEBHOOK_ENTITIES, ...AP_WEBHOOK_ENTITIES]) {
      expect(QBO_WEBHOOK_ENTITIES).toContain(e);
    }
  });
});
