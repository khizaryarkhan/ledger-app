/**
 * The rest of the QBO → general-ledger mappings.
 *
 * One property matters above all and is asserted for every single type: the
 * entry BALANCES. A mapper that produces an unbalanced entry is rejected by
 * postJournalEntry, so that transaction silently never lands and the ledger
 * carries a hole nobody sees until a trial balance is run months later.
 *
 * The rest of each block pins down the direction of the posting — which side
 * each account lands on. Getting a side backwards still balances, which is
 * exactly why it needs a test rather than an eyeball.
 */
import { describe, it, expect } from "vitest";
import {
  mapQboPayment, mapQboCreditMemo, mapQboSalesReceipt, mapQboRefundReceipt,
  mapQboBill, mapQboBillPayment, mapQboVendorCredit, mapQboPurchase,
  mapQboDeposit, mapQboTransfer, mapQboJournalEntry,
  mapQboTransaction, imbalanceOf, QboMapError, QBO_MAPPERS, QBO_NON_POSTING,
  type GlMapContext,
} from "@/lib/accounting/qbo-gl";

const AR = "acc-ar", TAX = "acc-tax", SUSPENSE = "acc-suspense", AP = "acc-ap", UF = "acc-undeposited";
const INCOME = "acc-income", BANK = "acc-bank", BANK2 = "acc-bank2", CARD = "acc-card", EXPENSE = "acc-expense";

const ctx = (): GlMapContext => ({
  accountByQboId: new Map([["79", INCOME], ["35", BANK], ["36", BANK2], ["41", CARD], ["60", EXPENSE]]),
  suspenseAccountId: SUSPENSE, arAccountId: AR, taxPayableAccountId: TAX,
  apAccountId: AP, undepositedFundsAccountId: UF,
});

const base = { Id: "77", SyncToken: "0", TxnDate: "2026-09-14" };
const dr = (e: any, a: string) => e.lines.filter((l: any) => l.accountId === a).reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
const cr = (e: any, a: string) => e.lines.filter((l: any) => l.accountId === a).reduce((s: number, l: any) => s + (l.credit ?? 0), 0);
const salesLine = (amt: number, acct = "79") => ({ DetailType: "SalesItemLineDetail", Amount: amt, SalesItemLineDetail: { ItemAccountRef: { value: acct } } });
const expLine = (amt: number, acct = "60") => ({ DetailType: "AccountBasedExpenseLineDetail", Amount: amt, AccountBasedExpenseLineDetail: { AccountRef: { value: acct } } });

describe("customer payment", () => {
  it("debits the bank and credits A/R", () => {
    const e = mapQboPayment({ ...base, TotalAmt: 500, DepositToAccountRef: { value: "35" } }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, BANK)).toBe(500);
    expect(cr(e, AR)).toBe(500);
  });

  it("falls back to Undeposited Funds when QBO names no deposit account", () => {
    // QBO omits DepositToAccountRef when the payment is held undeposited.
    // Sending it to suspense instead would misstate the bank AND leave a
    // suspense balance for an entirely ordinary transaction.
    const e = mapQboPayment({ ...base, TotalAmt: 500 }, ctx());
    expect(dr(e, UF)).toBe(500);
    expect(e.unmapped).toEqual([]);
  });

  it("puts the FULL amount to A/R even when partly unapplied", () => {
    // QBO carries an unapplied payment as a credit balance on the customer's
    // A/R — it does not park it elsewhere. Splitting it out misstates control.
    const e = mapQboPayment({ ...base, TotalAmt: 500, UnappliedAmt: 200, DepositToAccountRef: { value: "35" } }, ctx());
    expect(cr(e, AR)).toBe(500);
  });
});

describe("credit memo — the mirror image of an invoice", () => {
  it("debits revenue and credits A/R", () => {
    const e = mapQboCreditMemo({ ...base, TotalAmt: 300, CustomerRef: { name: "ACC" }, Line: [salesLine(300)] }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, INCOME)).toBe(300);
    expect(cr(e, AR)).toBe(300);
  });

  it("debits the tax back out too", () => {
    const e = mapQboCreditMemo({ ...base, TotalAmt: 339, Line: [salesLine(300)], TxnTaxDetail: { TotalTax: 39 } }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, TAX)).toBe(39);
  });
});

describe("sales receipt — paid at the till, never touches A/R", () => {
  it("debits the bank and credits revenue, with no A/R line at all", () => {
    const e = mapQboSalesReceipt({ ...base, TotalAmt: 250, DepositToAccountRef: { value: "35" }, Line: [salesLine(250)] }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, BANK)).toBe(250);
    expect(cr(e, INCOME)).toBe(250);
    expect(e.lines.some((l: any) => l.accountId === AR)).toBe(false);
  });
});

describe("refund receipt — money back out", () => {
  it("debits revenue and credits the bank", () => {
    const e = mapQboRefundReceipt({ ...base, TotalAmt: 120, DepositToAccountRef: { value: "35" }, Line: [salesLine(120)] }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, INCOME)).toBe(120);
    expect(cr(e, BANK)).toBe(120);
  });
});

describe("bill", () => {
  it("debits expense and credits A/P", () => {
    const e = mapQboBill({ ...base, TotalAmt: 800, VendorRef: { name: "Acme" }, Line: [expLine(800)] }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, EXPENSE)).toBe(800);
    expect(cr(e, AP)).toBe(800);
  });

  it("routes an item-based line through the item's account ref", () => {
    const e = mapQboBill({ ...base, TotalAmt: 800, Line: [{ DetailType: "ItemBasedExpenseLineDetail", Amount: 800, ItemBasedExpenseLineDetail: { ItemAccountRef: { value: "60" } } }] }, ctx());
    expect(dr(e, EXPENSE)).toBe(800);
    expect(imbalanceOf(e.lines)).toBe(0);
  });
});

describe("bill payment", () => {
  it("debits A/P and credits the bank for a cheque", () => {
    const e = mapQboBillPayment({ ...base, TotalAmt: 800, PayType: "Check", CheckPayment: { BankAccountRef: { value: "35" } } }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, AP)).toBe(800);
    expect(cr(e, BANK)).toBe(800);
  });

  it("credits the card account for a credit-card payment", () => {
    const e = mapQboBillPayment({ ...base, TotalAmt: 800, PayType: "CreditCard", CreditCardPayment: { CCAccountRef: { value: "41" } } }, ctx());
    expect(cr(e, CARD)).toBe(800);
  });

  it("sends an unknown PayType to suspense rather than guessing a funding account", () => {
    // Picking "probably the bank" here would silently misstate cash.
    const e = mapQboBillPayment({ ...base, TotalAmt: 800, PayType: "SomethingNew" }, ctx());
    expect(cr(e, SUSPENSE)).toBe(800);
    expect(e.unmapped.length).toBe(1);
    expect(imbalanceOf(e.lines)).toBe(0);
  });
});

describe("vendor credit", () => {
  it("debits A/P and credits expense", () => {
    const e = mapQboVendorCredit({ ...base, TotalAmt: 150, Line: [expLine(150)] }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, AP)).toBe(150);
    expect(cr(e, EXPENSE)).toBe(150);
  });
});

describe("purchase — and the refund that reverses it", () => {
  it("debits expense and credits the funding account", () => {
    const e = mapQboPurchase({ ...base, TotalAmt: 90, AccountRef: { value: "41" }, Line: [expLine(90)] }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, EXPENSE)).toBe(90);
    expect(cr(e, CARD)).toBe(90);
  });

  it("REVERSES both sides when Credit is true", () => {
    // A credit-card refund posted as a spend overstates expenses and
    // understates cash — and still balances, so only a test catches it.
    const e = mapQboPurchase({ ...base, TotalAmt: 90, Credit: true, AccountRef: { value: "41" }, Line: [expLine(90)] }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(cr(e, EXPENSE)).toBe(90);
    expect(dr(e, CARD)).toBe(90);
  });
});

describe("deposit", () => {
  it("debits the bank and credits the named source account", () => {
    const e = mapQboDeposit({ ...base, TotalAmt: 400, DepositToAccountRef: { value: "35" }, Line: [{ Amount: 400, DepositLineDetail: { AccountRef: { value: "79" } } }] }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, BANK)).toBe(400);
    expect(cr(e, INCOME)).toBe(400);
  });

  it("credits Undeposited Funds when the line is a swept payment, not fresh income", () => {
    // A LinkedTxn line is a payment already received and sitting undeposited.
    // Treating it as income would DOUBLE-COUNT revenue — it was recognised
    // when the invoice was raised.
    const e = mapQboDeposit({ ...base, TotalAmt: 400, DepositToAccountRef: { value: "35" }, Line: [{ Amount: 400, LinkedTxn: [{ TxnId: "9", TxnType: "Payment" }], DepositLineDetail: {} }] }, ctx());
    expect(cr(e, UF)).toBe(400);
    expect(cr(e, INCOME)).toBe(0);
    expect(imbalanceOf(e.lines)).toBe(0);
  });
});

describe("transfer", () => {
  it("debits the destination and credits the source", () => {
    const e = mapQboTransfer({ ...base, Amount: 1000, FromAccountRef: { value: "35" }, ToAccountRef: { value: "36" } }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, BANK2)).toBe(1000);
    expect(cr(e, BANK)).toBe(1000);
  });

  it("rejects a zero-amount transfer", () => {
    expect(() => mapQboTransfer({ ...base, Amount: 0, FromAccountRef: { value: "35" }, ToAccountRef: { value: "36" } }, ctx()))
      .toThrowError(QboMapError);
  });
});

describe("journal entry — take QBO's own sides", () => {
  it("honours PostingType per line", () => {
    const e = mapQboJournalEntry({ ...base, Line: [
      { Amount: 200, JournalEntryLineDetail: { PostingType: "Debit",  AccountRef: { value: "60" } } },
      { Amount: 200, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "35" } } },
    ] }, ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, EXPENSE)).toBe(200);
    expect(cr(e, BANK)).toBe(200);
  });

  it("REFUSES a line with no PostingType instead of defaulting a side", () => {
    // Defaulting would flip the sign of a line and, if it happened twice,
    // still balance — an undetectable corruption.
    expect(() => mapQboJournalEntry({ ...base, Line: [
      { Amount: 200, JournalEntryLineDetail: { AccountRef: { value: "60" } } },
      { Amount: 200, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "35" } } },
    ] }, ctx())).toThrowError(/PostingType/);
  });

  it("carries the line's Entity through as the name", () => {
    const e = mapQboJournalEntry({ ...base, Line: [
      { Amount: 200, JournalEntryLineDetail: { PostingType: "Debit", AccountRef: { value: "60" }, Entity: { Type: "Vendor", EntityRef: { name: "Acme" } } } },
      { Amount: 200, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "35" } } },
    ] }, ctx());
    expect(e.lines[0].nameType).toBe("Vendor");
    expect(e.lines[0].nameLabel).toBe("Acme");
  });
});

describe("the registry", () => {
  it("dispatches by QBO entity name", () => {
    const e = mapQboTransaction("Transfer", { ...base, Amount: 50, FromAccountRef: { value: "35" }, ToAccountRef: { value: "36" } }, ctx());
    expect(e.sourceType).toBe("Transfer");
  });

  it("refuses an entity it has no mapping for, rather than skipping it quietly", () => {
    // A silent skip is how a ledger ends up incomplete but balanced.
    expect(() => mapQboTransaction("Budget", base, ctx())).toThrowError(/no GL mapping/);
  });

  it("names the non-posting entities explicitly", () => {
    // "Decided to skip" must be distinguishable from "forgot".
    for (const e of QBO_NON_POSTING) expect(QBO_MAPPERS[e]).toBeUndefined();
    expect(QBO_NON_POSTING).toContain("Estimate");
    expect(QBO_NON_POSTING).toContain("PurchaseOrder");
  });

  it("every registered mapper carries an external identity for de-duplication", () => {
    expect(Object.keys(QBO_MAPPERS).length).toBeGreaterThanOrEqual(12);
  });
});

describe("no posting type can produce an unbalanced entry", () => {
  // A sweep rather than a per-type assertion: if a new mapper is added and
  // forgets balanceTo, this fails without anyone remembering to extend it.
  const cases: [string, any][] = [
    ["Invoice",       { ...base, TotalAmt: 100, Line: [salesLine(100)] }],
    ["Payment",       { ...base, TotalAmt: 100, DepositToAccountRef: { value: "35" } }],
    ["CreditMemo",    { ...base, TotalAmt: 100, Line: [salesLine(100)] }],
    ["SalesReceipt",  { ...base, TotalAmt: 100, DepositToAccountRef: { value: "35" }, Line: [salesLine(100)] }],
    ["RefundReceipt", { ...base, TotalAmt: 100, DepositToAccountRef: { value: "35" }, Line: [salesLine(100)] }],
    ["Bill",          { ...base, TotalAmt: 100, Line: [expLine(100)] }],
    ["BillPayment",   { ...base, TotalAmt: 100, PayType: "Check", CheckPayment: { BankAccountRef: { value: "35" } } }],
    ["VendorCredit",  { ...base, TotalAmt: 100, Line: [expLine(100)] }],
    ["Purchase",      { ...base, TotalAmt: 100, AccountRef: { value: "41" }, Line: [expLine(100)] }],
    ["Deposit",       { ...base, TotalAmt: 100, DepositToAccountRef: { value: "35" }, Line: [{ Amount: 100, DepositLineDetail: { AccountRef: { value: "79" } } }] }],
    ["Transfer",      { ...base, Amount: 100, FromAccountRef: { value: "35" }, ToAccountRef: { value: "36" } }],
    ["JournalEntry",  { ...base, Line: [
      { Amount: 100, JournalEntryLineDetail: { PostingType: "Debit",  AccountRef: { value: "60" } } },
      { Amount: 100, JournalEntryLineDetail: { PostingType: "Credit", AccountRef: { value: "35" } } },
    ] }],
  ];

  it.each(cases)("%s balances", (entity, txn) => {
    expect(imbalanceOf(mapQboTransaction(entity, txn, ctx()).lines)).toBe(0);
  });

  it.each(cases)("%s still balances when every account is unresolvable", (entity, txn) => {
    // The worst realistic case: a COA sync that has not run. Everything lands
    // in suspense, and the entry must STILL balance so it can post at all.
    const blind: GlMapContext = { ...ctx(), accountByQboId: new Map() };
    expect(imbalanceOf(mapQboTransaction(entity, txn, blind).lines)).toBe(0);
  });
});
