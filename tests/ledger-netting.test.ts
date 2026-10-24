/**
 * postJournalEntry nets lines that share the same account + every posting
 * dimension into one row before posting — matching how SAP (FI document
 * summarization), NetSuite (GL Impact) and Oracle (Subledger Accounting) all
 * post one GL line per account+dimension combination per document, instead of
 * one line per source item. See lib/ledger.ts's netLines doc comment and
 * CLAUDE.md's "Add to Bill" section for why this exists: billFromReceipts was
 * posting one GR/IR debit line PER RECEIPT LINE, so a three-line Bill against
 * one Goods Receipt showed three separate debits to the same clearing
 * account, with no way to tell from the GL alone that it was one document.
 *
 * netLines is pure (no db) — proven here directly, the same pattern this
 * codebase already uses for account-roles.ts / sourcing.ts.
 */
import { describe, it, expect } from "vitest";
import { netLines, lineGroupKey } from "@/lib/ledger";

const ACC_A = "00000000-0000-0000-0000-0000000000aa";
const ACC_B = "00000000-0000-0000-0000-0000000000bb";

describe("netLines — collapsing same-account lines", () => {
  it("merges two debit lines on the same account into one, summing the amount", () => {
    const out = netLines(
      [
        { accountId: ACC_A, debit: 960, description: "Chicken" },
        { accountId: ACC_A, debit: 256, description: "Chicken" },
        { accountId: ACC_A, debit: 500, description: "Salt" },
        { accountId: ACC_B, credit: 1716 },
      ],
      "Bill for goods received (GRN-0003)",
    );
    const grni = out.filter(l => l.accountId === ACC_A);
    expect(grni).toHaveLength(1);
    expect(grni[0].debit).toBe(1716);
    expect(grni[0].credit).toBe(0);
  });

  it("uses the document's own memo as the netted line's description, not an item name", () => {
    const out = netLines(
      [
        { accountId: ACC_A, debit: 100, description: "Chicken" },
        { accountId: ACC_A, debit: 50, description: "Salt" },
        { accountId: ACC_B, credit: 150 },
      ],
      "Bill for goods received (GRN-0003)",
    );
    const grni = out.find(l => l.accountId === ACC_A)!;
    expect(grni.description).toBe("Bill for goods received (GRN-0003)");
  });

  it("leaves a document with no repeated account completely untouched (the common case)", () => {
    const input = [
      { accountId: ACC_A, debit: 100, description: "Expense" },
      { accountId: ACC_B, credit: 100, description: "Bank" },
    ];
    expect(netLines(input, "Expense EXP-0001")).toEqual(input);
  });

  it("nets a debit and a credit on the same account+dimensions into one net line", () => {
    const out = netLines(
      [
        { accountId: ACC_A, debit: 100 },
        { accountId: ACC_A, credit: 40 },
        { accountId: ACC_B, credit: 60 },
      ],
      null,
    );
    const a = out.find(l => l.accountId === ACC_A)!;
    expect(a.debit).toBe(60);
    expect(a.credit).toBe(0);
  });

  it("drops a group that fully cancels out within the same document", () => {
    const out = netLines(
      [
        { accountId: ACC_A, debit: 100 },
        { accountId: ACC_A, credit: 100 },
        { accountId: ACC_B, debit: 50 },
        { accountId: ACC_B, credit: 50 },
      ],
      null,
    );
    expect(out).toHaveLength(0);
  });

  it("does NOT merge lines on the same account with a different class", () => {
    const out = netLines(
      [
        { accountId: ACC_A, debit: 100, classId: "class-1" },
        { accountId: ACC_A, debit: 50, classId: "class-2" },
        { accountId: ACC_B, credit: 150 },
      ],
      null,
    );
    expect(out.filter(l => l.accountId === ACC_A)).toHaveLength(2);
  });

  it("does NOT merge lines on the same account with a different location, cost centre, project or name", () => {
    const base = { accountId: ACC_A, debit: 10 };
    const variants: [any, any][] = [
      [{ ...base, locationId: "loc-1" }, { ...base, locationId: "loc-2" }],
      [{ ...base, costCentreId: "cc-1" }, { ...base, costCentreId: "cc-2" }],
      [{ ...base, projectId: "proj-1" }, { ...base, projectId: "proj-2" }],
      [{ ...base, nameType: "Customer", nameId: "cust-1" }, { ...base, nameType: "Customer", nameId: "cust-2" }],
    ];
    for (const [l1, l2] of variants) {
      const out = netLines([l1, l2, { accountId: ACC_B, credit: 20 }], null);
      expect(out.filter(l => l.accountId === ACC_A)).toHaveLength(2);
    }
  });

  it("does NOT merge foreign-currency lines posted at a different exchange rate", () => {
    const out = netLines(
      [
        { accountId: ACC_A, debit: 100, currency: "USD", exchangeRate: 1.1 },
        { accountId: ACC_A, debit: 50, currency: "USD", exchangeRate: 1.2 },
        { accountId: ACC_B, credit: 150 },
      ],
      null,
    );
    expect(out.filter(l => l.accountId === ACC_A)).toHaveLength(2);
  });

  it("sums the foreign-currency (fx) amount alongside the home-currency amount when merging", () => {
    const out = netLines(
      [
        { accountId: ACC_A, debit: 110, currency: "USD", exchangeRate: 1.1, fxDebit: 100 },
        { accountId: ACC_A, debit: 55, currency: "USD", exchangeRate: 1.1, fxDebit: 50 },
        { accountId: ACC_B, credit: 165 },
      ],
      null,
    );
    const a = out.find(l => l.accountId === ACC_A)!;
    expect(a.debit).toBe(165);
    expect(a.fxDebit).toBe(150);
  });

  it("falls back to the first line's own description when no document memo is given", () => {
    const out = netLines(
      [
        { accountId: ACC_A, debit: 10, description: "First line" },
        { accountId: ACC_A, debit: 5 },
        { accountId: ACC_B, credit: 15 },
      ],
      null,
    );
    expect(out.find(l => l.accountId === ACC_A)!.description).toBe("First line");
  });
});

describe("lineGroupKey", () => {
  it("is identical for two lines that differ only in debit/credit amount and description", () => {
    const a = { accountId: ACC_A, debit: 100, description: "Chicken" } as any;
    const b = { accountId: ACC_A, debit: 50, description: "Salt" } as any;
    expect(lineGroupKey(a)).toBe(lineGroupKey(b));
  });
});
