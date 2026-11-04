import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { paymentRowFromQbo, applicationsFromQboPayment, creditMemoIndex } from "@/lib/qbo/payment-mapping";

const ORG = "org-1";
const PAY = {
  Id: "72873", TxnDate: "2026-11-04", TotalAmt: "1500.00", UnappliedAmt: "0",
  CustomerRef: { value: "58", name: "Acme" }, CurrencyRef: { value: "EUR" },
  DepositToAccountRef: { value: "35", name: "AIB Current" }, PaymentMethodRef: { name: "EFT" },
  Line: [
    { Amount: "1000", LinkedTxn: [{ TxnId: "1452", TxnType: "Invoice" }] },
    { Amount: "500", LinkedTxn: [{ TxnId: "900", TxnType: "CreditMemo" }, { TxnId: "77", TxnType: "JournalEntry", TxnLineId: "3" }] },
    { Amount: "10", LinkedTxn: [{ TxnId: "5", TxnType: "Deposit" }] },
  ],
};

describe("paymentRowFromQbo", () => {
  it("maps the fields the payments list shows, including the deposit account", () => {
    const r = paymentRowFromQbo(ORG, PAY, new Map([["58", "cust-1"]]));
    expect(r.ok).toBe(true);
    if (r.ok === false) return;
    expect(r.row).toMatchObject({
      orgId: ORG, qboId: "72873", customerId: "cust-1", qboCustomerId: "58", txnDate: "2026-11-04",
      totalAmount: 1500, currency: "EUR", depositAccountId: "35", depositAccountName: "AIB Current", paymentMethod: "EFT",
    });
  });
  it("keeps a payment whose customer is not mirrored yet, with no customer link", () => {
    const r = paymentRowFromQbo(ORG, PAY, new Map());
    expect(r.ok === true && r.row.customerId).toBe(null);
  });
  it("refuses a payment with no id or no date, saying which", () => {
    expect(paymentRowFromQbo(ORG, { TxnDate: "2026-11-04" }, new Map())).toMatchObject({ ok: false, reason: "Missing Id" });
    expect(paymentRowFromQbo(ORG, { Id: "9" }, new Map())).toMatchObject({ ok: false, qboId: "9", reason: "Missing TxnDate" });
  });
});

describe("applicationsFromQboPayment", () => {
  it("records invoices, credit memos and journal entries, and nothing else", () => {
    const apps = applicationsFromQboPayment(ORG, "pay-1", PAY, new Map([["1452", "inv-1"]]), new Map([["900", "cm-1"]]));
    expect(apps.map((a) => [a.targetType, a.targetQboId, a.invoiceId, a.amountApplied])).toEqual([
      ["Invoice", "1452", "inv-1", 1000],
      ["CreditMemo", "900", "cm-1", 500],
      ["JournalEntry", "77", null, 500],
    ]);
    expect(apps[2].targetLineId).toBe("3");
  });
  it("keeps the applications of a zero-amount payment (how QuickBooks applies credits)", () => {
    const zero = { ...PAY, TotalAmt: "0" };
    expect(applicationsFromQboPayment(ORG, "pay-1", zero, new Map(), new Map())).toHaveLength(3);
  });
  it("indexes credit memos by their raw QuickBooks id", () => {
    expect(creditMemoIndex([{ id: "a", qboId: "CM-900" }, { id: "b", qboId: "1452" }, { id: "c", qboId: null }]))
      .toEqual(new Map([["900", "a"]]));
  });
});

describe("qbo-sync wiring", () => {
  const src = readFileSync(join(__dirname, "..", "lib", "qbo-sync.ts"), "utf8");
  const targeted = src.slice(src.indexOf("export async function syncTargetedEntities("));

  it("the webhook stores the payments it is told about", () => {
    expect(targeted).toMatch(/await persistWebhookPayments\(/);
  });
  it("…but only after reading their previous applications, which it would otherwise overwrite", () => {
    const readPrev = targeted.indexOf("const prevApps = await db");
    const persist = targeted.indexOf("await persistWebhookPayments(");
    expect(readPrev).toBeGreaterThan(-1);
    expect(persist).toBeGreaterThan(readPrev);
  });
  it("the nightly sync and the webhook use the same mapping", () => {
    expect(src.match(/paymentRowFromQbo\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(src.match(/applicationsFromQboPayment\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("a QuickBooks delete or merge soft-deletes; nothing marks an invoice Written Off", () => {
    // "Written Off" is a real AR outcome; a row QuickBooks no longer has must be
    // deleted_at, or it stays live with its old balance (EDC, 2026-11-04).
    expect(src).not.toMatch(/paymentStatus:\s*"Written Off"/);
  });
});
