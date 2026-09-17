/**
 * An update must never silently delete part of a QuickBooks record.
 *
 * Data Studio's update is a FULL (non-sparse) write — the Line array we send
 * becomes the record's complete new truth. That is correct and must stay: it is
 * what makes "I edited the sheet" mean what it says. But the sheet can only
 * carry what the exporter models, so any line type it does not model is absent
 * from the payload and therefore DELETED on save, with no error and nothing in
 * the job history.
 *
 * Found while auditing every entity's Update path after the Expenses/Bills
 * grouping bug destroyed a customer's lines. This is the same failure one layer
 * down: not "which rows are one document" but "which parts of a document can a
 * row even hold".
 *
 * The rule: refuse, and say why. A visible skip naming one document is far
 * better than a silent 200 — the rest of the file still imports.
 */
import { describe, it, expect } from "vitest";
import { checkUpdateSafety } from "@/lib/batch/update-safety";

describe("sales documents", () => {
  it("allows an ordinary invoice", () => {
    const inv = { Line: [
      { DetailType: "SalesItemLineDetail", Amount: 100 },
      { DetailType: "SalesItemLineDetail", Amount: 250 },
      { DetailType: "SubTotalLineDetail",  Amount: 350 },
    ]};
    expect(checkUpdateSafety("invoice", inv)).toBeNull();
  });

  it("REFUSES an invoice containing a bundle", () => {
    // GroupLineDetail is a bundle of items. The exporter only emits
    // SalesItemLineDetail, so the bundle would vanish on save.
    const inv = { Line: [
      { DetailType: "SalesItemLineDetail", Amount: 100 },
      { DetailType: "GroupLineDetail" },
    ]};
    const r = checkUpdateSafety("invoice", inv);
    expect(r).not.toBeNull();
    expect(r!.reason).toMatch(/bundle/i);
    expect(r!.reason).toMatch(/QuickBooks/);
  });

  it("REFUSES a description-only line rather than deleting it", () => {
    const inv = { Line: [
      { DetailType: "SalesItemLineDetail", Amount: 10 },
      { DetailType: "DescriptionOnlyLineDetail" },
    ]};
    expect(checkUpdateSafety("invoice", inv)).not.toBeNull();
  });

  it("does not refuse over a discount — the sheet carries it in header columns", () => {
    const inv = { Line: [
      { DetailType: "SalesItemLineDetail", Amount: 100 },
      { DetailType: "DiscountLineDetail",  Amount: 10 },
    ]};
    expect(checkUpdateSafety("invoice", inv)).toBeNull();
  });

  it("applies to every sales entity, not just invoices", () => {
    const withBundle = { Line: [{ DetailType: "GroupLineDetail" }] };
    for (const e of ["invoice", "estimate", "creditmemo", "salesreceipt", "refundreceipt"]) {
      expect(checkUpdateSafety(e, withBundle), e).not.toBeNull();
    }
  });
});

describe("bills, expenses and the rest of the purchase side", () => {
  it("allows the two line types the sheet models", () => {
    const bill = { Line: [
      { DetailType: "AccountBasedExpenseLineDetail", Amount: 500 },
      { DetailType: "ItemBasedExpenseLineDetail",    Amount: 250 },
      { DetailType: "TaxLineDetail",                 Amount: 150 },
    ]};
    expect(checkUpdateSafety("bill", bill)).toBeNull();
  });

  it("REFUSES anything else", () => {
    const bill = { Line: [
      { DetailType: "AccountBasedExpenseLineDetail", Amount: 500 },
      { DetailType: "GroupLineDetail" },
    ]};
    expect(checkUpdateSafety("bill", bill)).not.toBeNull();
  });

  it("covers expense, check, vendorcredit, purchaseorder and creditcardcredit", () => {
    const odd = { Line: [{ DetailType: "SomethingNewLineDetail" }] };
    for (const e of ["expense", "check", "vendorcredit", "purchaseorder", "creditcardcredit"]) {
      expect(checkUpdateSafety(e, odd), e).not.toBeNull();
    }
  });
});

describe("payments — where a dropped line changes a customer's balance", () => {
  it("allows a payment applied only to invoices", () => {
    const pmt = { Line: [
      { Amount: 100, LinkedTxn: [{ TxnId: "1", TxnType: "Invoice" }] },
      { Amount: 200, LinkedTxn: [{ TxnId: "2", TxnType: "Invoice" }] },
    ]};
    expect(checkUpdateSafety("receivepayment", pmt)).toBeNull();
  });

  it("REFUSES a payment that also applies a credit memo", () => {
    // The exporter emits one row per applied INVOICE only. Saving this would
    // drop the credit-memo application — the credit silently becomes unapplied
    // and the customer's balance changes.
    const pmt = { Line: [
      { Amount: 100, LinkedTxn: [{ TxnId: "1", TxnType: "Invoice" }] },
      { Amount: -50, LinkedTxn: [{ TxnId: "9", TxnType: "CreditMemo" }] },
    ]};
    const r = checkUpdateSafety("receivepayment", pmt);
    expect(r).not.toBeNull();
    expect(r!.reason).toMatch(/CreditMemo/);
    expect(r!.reason).toMatch(/un-apply/i);
  });

  it("REFUSES a bill payment that also applies a vendor credit", () => {
    const pmt = { Line: [
      { Amount: 500, LinkedTxn: [{ TxnId: "1", TxnType: "Bill" }] },
      { Amount: -75, LinkedTxn: [{ TxnId: "7", TxnType: "VendorCredit" }] },
    ]};
    expect(checkUpdateSafety("billpayment", pmt)).not.toBeNull();
  });

  it("allows an unapplied payment with no linked transactions", () => {
    expect(checkUpdateSafety("receivepayment", { Line: [{ Amount: 100 }] })).toBeNull();
  });
});

describe("entities that are safe by construction", () => {
  it("does not block Bank Deposits — they round-trip each line's own id", () => {
    // Because the sheet carries "Line Id", QuickBooks is told exactly which
    // lines survived, so an unmodelled line is not silently dropped.
    const dep = { Line: [
      { Id: "1", DetailType: "DepositLineDetail" },
      { Id: "2", DetailType: "SomethingExoticLineDetail" },
    ]};
    expect(checkUpdateSafety("deposit", dep)).toBeNull();
  });

  it("does not block journal entries — every line is exported", () => {
    const je = { Line: [
      { DetailType: "JournalEntryLineDetail", Amount: 10 },
      { DetailType: "JournalEntryLineDetail", Amount: -10 },
    ]};
    expect(checkUpdateSafety("journalentry", je)).toBeNull();
  });

  it("does not block line-less entities", () => {
    for (const e of ["customer", "vendor", "item", "account", "transfer", "timeactivity"]) {
      expect(checkUpdateSafety(e, { Id: "1" }), e).toBeNull();
    }
  });

  it("is permissive about entities it does not know", () => {
    // This guard exists to catch a KNOWN loss, not to block on unfamiliarity —
    // refusing everything unmapped would break working imports.
    expect(checkUpdateSafety("somethingnew", { Line: [{ DetailType: "X" }] })).toBeNull();
  });

  it("handles a record with no Line array at all", () => {
    expect(checkUpdateSafety("invoice", {})).toBeNull();
    expect(checkUpdateSafety("invoice", { Line: [] })).toBeNull();
    expect(checkUpdateSafety("invoice", null)).toBeNull();
  });
});
