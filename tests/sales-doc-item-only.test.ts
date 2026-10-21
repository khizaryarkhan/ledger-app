import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const ROOT = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/**
 * Sales-document refactor, Phase 2 (2026-10-21): Invoice, Estimate,
 * SalesReceipt, CreditNote and RefundReceipt post (or, for Estimate, will
 * post on conversion) entirely from an item's own account mapping — never a
 * hand-picked Chart of Accounts line. SalesOrder/PurchaseOrder/Bill/Expense/
 * VendorCredit are explicitly untouched (the first two are already item-only
 * via a different mechanism; the rest keep their items/accounts SPLIT_TYPES
 * tab). These pin the exact scope so a future change can't silently widen or
 * narrow which document types this applies to.
 */
describe("item-only sales document scope", () => {
  it("new-document-form.tsx hides the account column for exactly the five spec'd types", () => {
    const src = read("components/new-document-form.tsx");
    expect(src).toMatch(/isItemOnlySales\s*=\s*\(\["Invoice", "Estimate", "SalesReceipt", "CreditNote", "RefundReceipt"\]/);
    // showAccountCol must be gated off by it, not just isOrderDoc.
    expect(src).toMatch(/showAccountCol\s*=\s*\(isOrderDoc \|\| isItemOnlySales\)\s*\?\s*false/);
  });

  it("documents.ts refuses a missing or unmapped item account for exactly the four posting types", () => {
    const src = read("lib/accounting/documents.ts");
    expect(src).toMatch(/ITEM_ONLY_SALES_TYPES = new Set<DocType>\(\["Invoice", "SalesReceipt", "CreditNote", "RefundReceipt"\]\)/);
    // Estimate is deliberately absent here — it's non-posting, checked in trade-documents.ts instead.
    const match = src.match(/ITEM_ONLY_SALES_TYPES = new Set<DocType>\((\[[^\]]+\])\)/);
    expect(match).not.toBeNull();
    const list = JSON.parse(match![1].replace(/'/g, '"'));
    expect(list).not.toContain("Estimate");
    expect(list).not.toContain("SalesOrder");
    expect(list).not.toContain("PurchaseOrder");
    expect(list).not.toContain("Bill");
    expect(list).not.toContain("Expense");
    expect(list).not.toContain("VendorCredit");
    // accountOverride must be ignored for these types, not just an unmapped item refused.
    expect(src).toMatch(/l\.accountOverride && l\.accountId && !isItemOnlySale/);
  });

  it("trade-documents.ts requires an item on every Estimate line, not Sales/Purchase Order", () => {
    const src = read("lib/accounting/trade-documents.ts");
    expect(src).toMatch(/if \(kind === "Estimate"\) \{\s*\n\s*const bad = raw\.filter\(l => !l\.itemId\);/);
  });
});
