/**
 * QBO transaction → general-ledger entry.
 *
 * This is money-path accounting for a live client's books, so the properties
 * below are the ones that must hold for EVERY transaction, not just the happy
 * path: the entry balances, no line is ever dropped, and nothing unmappable is
 * allowed to quietly become revenue.
 */
import { describe, it, expect } from "vitest";
import { mapQboInvoice, balanceTo, imbalanceOf, ingestDecision, QboMapError, type GlMapContext } from "@/lib/accounting/qbo-gl";

const AR = "acc-ar", TAX = "acc-tax", SUSPENSE = "acc-suspense";
const INCOME = "acc-income", OTHER_INCOME = "acc-other-income", DISCOUNT = "acc-discount";

const ctx = (): GlMapContext => ({
  accountByQboId: new Map([["79", INCOME], ["82", OTHER_INCOME], ["86", DISCOUNT]]),
  suspenseAccountId: SUSPENSE,
  arAccountId: AR,
  taxPayableAccountId: TAX,
});

const salesLine = (amount: number, acct = "79", description?: string) => ({
  DetailType: "SalesItemLineDetail", Amount: amount, Description: description ?? null,
  SalesItemLineDetail: { ItemAccountRef: { value: acct } },
});

const invoice = (over: any = {}) => ({
  Id: "1042", SyncToken: "3", TxnDate: "2026-09-12", DueDate: "2026-10-12",
  DocNumber: "219", TotalAmt: 1000, CustomerRef: { value: "58", name: "A Continuous Charity" },
  Line: [salesLine(1000)],
  ...over,
});

const dr = (e: any, acct: string) => e.lines.filter((l: any) => l.accountId === acct).reduce((s: number, l: any) => s + (l.debit ?? 0), 0);
const cr = (e: any, acct: string) => e.lines.filter((l: any) => l.accountId === acct).reduce((s: number, l: any) => s + (l.credit ?? 0), 0);

describe("every mapped entry balances", () => {
  it("posts Dr A/R against Cr income for a simple invoice", () => {
    const e = mapQboInvoice(invoice(), ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, AR)).toBe(1000);
    expect(cr(e, INCOME)).toBe(1000);
  });

  it("splits multiple income lines to their own accounts", () => {
    const e = mapQboInvoice(invoice({ TotalAmt: 1500, Line: [salesLine(1000, "79"), salesLine(500, "82")] }), ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(cr(e, INCOME)).toBe(1000);
    expect(cr(e, OTHER_INCOME)).toBe(500);
  });

  it("credits sales tax to the tax control account, not to revenue", () => {
    const e = mapQboInvoice(invoice({ TotalAmt: 1130, TxnTaxDetail: { TotalTax: 130 } }), ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, AR)).toBe(1130);
    expect(cr(e, INCOME)).toBe(1000);
    expect(cr(e, TAX)).toBe(130);
  });

  it("treats a discount as a DEBIT, so it reduces revenue rather than inflating it", () => {
    const e = mapQboInvoice(invoice({
      TotalAmt: 900,
      Line: [salesLine(1000, "79"), { DetailType: "DiscountLineDetail", Amount: 100, DiscountLineDetail: { DiscountAccountRef: { value: "86" } } }],
    }), ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(dr(e, DISCOUNT)).toBe(100);
    expect(cr(e, INCOME)).toBe(1000);
    expect(dr(e, AR)).toBe(900);
  });
});

describe("display-only lines must not become money", () => {
  it("ignores SubTotal and DescriptionOnly lines", () => {
    // Summing a SubTotal line would double the invoice — it restates lines
    // already counted.
    const e = mapQboInvoice(invoice({
      Line: [salesLine(1000), { DetailType: "SubTotalLineDetail", Amount: 1000 }, { DetailType: "DescriptionOnly", Description: "Thanks!" }],
    }), ctx());
    expect(cr(e, INCOME)).toBe(1000);
    expect(imbalanceOf(e.lines)).toBe(0);
  });

  it("skips zero-amount lines without unbalancing anything", () => {
    const e = mapQboInvoice(invoice({ Line: [salesLine(1000), salesLine(0, "82")] }), ctx());
    expect(e.lines.some((l: any) => l.accountId === OTHER_INCOME)).toBe(false);
    expect(imbalanceOf(e.lines)).toBe(0);
  });
});

describe("an unmappable account goes to suspense — never dropped, never revenue", () => {
  it("routes an unknown QBO account to suspense and still balances", () => {
    // Dropping the line would unbalance the entry and the whole transaction
    // would fail to post, leaving a hole in the ledger.
    const e = mapQboInvoice(invoice({ Line: [salesLine(1000, "9999")] }), ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(cr(e, SUSPENSE)).toBe(1000);
    expect(e.unmapped).toContain("9999");
  });

  it("routes a line with NO AccountRef to suspense and names the problem", () => {
    const e = mapQboInvoice(invoice({ Line: [{ DetailType: "SalesItemLineDetail", Amount: 1000 }] }), ctx());
    expect(cr(e, SUSPENSE)).toBe(1000);
    expect(e.unmapped).toContain("(missing AccountRef)");
  });

  it("routes an unrecognised DetailType through resolution rather than discarding it", () => {
    const e = mapQboInvoice(invoice({ Line: [{ DetailType: "SomeFutureLineDetail", Amount: 1000 }] }), ctx());
    expect(imbalanceOf(e.lines)).toBe(0);
    expect(cr(e, SUSPENSE)).toBe(1000);
  });

  it("reports nothing unmapped when every account resolves", () => {
    expect(mapQboInvoice(invoice(), ctx()).unmapped).toEqual([]);
  });
});

describe("balanceTo", () => {
  it("plugs a sub-cent residue so the entry can post", () => {
    const lines = [{ accountId: AR, debit: 100.01 }, { accountId: INCOME, credit: 100 }];
    const out = balanceTo(lines, SUSPENSE);
    expect(imbalanceOf(out)).toBe(0);
    expect(cr({ lines: out }, SUSPENSE)).toBe(0.01);
  });

  it("plugs in the other direction too", () => {
    const out = balanceTo([{ accountId: AR, debit: 100 }, { accountId: INCOME, credit: 100.01 }], SUSPENSE);
    expect(imbalanceOf(out)).toBe(0);
    expect(dr({ lines: out }, SUSPENSE)).toBe(0.01);
  });

  it("leaves an already-balanced entry untouched", () => {
    const lines = [{ accountId: AR, debit: 100 }, { accountId: INCOME, credit: 100 }];
    expect(balanceTo(lines, SUSPENSE)).toHaveLength(2);
  });

  it("REFUSES to plug a real imbalance — that would bury a mapping bug", () => {
    // A £40 gap is a defect in the mapping, not a rounding artefact. Silently
    // absorbing it into suspense would make the ledger balance and be wrong.
    expect(() => balanceTo([{ accountId: AR, debit: 140 }, { accountId: INCOME, credit: 100 }], SUSPENSE))
      .toThrowError(QboMapError);
  });
});

describe("refuses to post nonsense rather than corrupting the ledger", () => {
  it("rejects a transaction with no Id — it could never be de-duplicated", () => {
    expect(() => mapQboInvoice(invoice({ Id: undefined }), ctx())).toThrowError(QboMapError);
  });

  it("rejects an invalid or missing TxnDate", () => {
    expect(() => mapQboInvoice(invoice({ TxnDate: "not-a-date" }), ctx())).toThrowError(/valid date/i);
    expect(() => mapQboInvoice(invoice({ TxnDate: undefined }), ctx())).toThrowError(/valid date/i);
  });

  it("rejects a zero-total invoice instead of posting an empty entry", () => {
    expect(() => mapQboInvoice(invoice({ TotalAmt: 0, Line: [] }), ctx())).toThrowError(QboMapError);
  });

  it("rejects an invoice whose lines produced nothing", () => {
    expect(() => mapQboInvoice(invoice({ Line: [{ DetailType: "SubTotalLineDetail", Amount: 1000 }] }), ctx()))
      .toThrowError(QboMapError);
  });
});

describe("identity carried onto the entry", () => {
  it("keeps QBO's id, source and SyncToken so the entry can be matched and replaced", () => {
    const e = mapQboInvoice(invoice(), ctx());
    expect(e.externalId).toBe("1042");
    expect(e.externalSource).toBe("qbo");
    expect(e.externalSyncToken).toBe("3");
    expect(e.entryDate).toBe("2026-09-12");
    expect(e.dueDate).toBe("2026-10-12");
    expect(e.docNumber).toBe("219");
    expect(e.sourceType).toBe("Invoice");
  });
});

describe("ingestDecision — what an incremental re-sync does", () => {
  it("posts a transaction we have never seen", () => {
    expect(ingestDecision(null, { SyncToken: "0" })).toBe("post");
  });

  it("skips an unchanged transaction — this is what makes re-sync cheap", () => {
    expect(ingestDecision({ externalSyncToken: "3" }, { SyncToken: "3" })).toBe("skip");
  });

  it("replaces when QBO has bumped the SyncToken", () => {
    // Replace, not reverse-and-repost: QBO is the book of record for a mirrored
    // entry, so five edits there must not become eleven entries here.
    expect(ingestDecision({ externalSyncToken: "3" }, { SyncToken: "4" })).toBe("replace");
  });

  it("replaces when either side's token is unknown rather than assuming unchanged", () => {
    expect(ingestDecision({ externalSyncToken: null }, { SyncToken: "4" })).toBe("replace");
    expect(ingestDecision({ externalSyncToken: "3" }, {})).toBe("replace");
  });

  it("compares tokens as strings, so a numeric payload still matches", () => {
    expect(ingestDecision({ externalSyncToken: "3" }, { SyncToken: 3 as any })).toBe("skip");
  });
});
