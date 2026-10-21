import { describe, it, expect } from "vitest";
import { xeroAccountType } from "@/lib/xero-ap-sync";
import { ACCOUNT_TYPE_NAMES } from "@/lib/accounting/account-types";

// Posting roles validate against the app's (QBO-style) account types; a Xero
// chart stored in Xero's own codes could never be mapped to a role.
describe("Xero account types", () => {
  it("map onto the app's account types", () => {
    for (const t of ["BANK", "CURRENT", "INVENTORY", "PREPAYMENT", "FIXED", "NONCURRENT", "CURRLIAB", "LIABILITY", "PAYGLIABILITY", "PAYG", "SUPERANNUATIONLIABILITY", "TERMLIAB", "EQUITY", "REVENUE", "SALES", "OTHERINCOME", "DIRECTCOSTS", "EXPENSE", "OVERHEADS", "DEPRECIATN", "SUPERANNUATIONEXPENSE", "WAGESEXPENSE"]) {
      expect(ACCOUNT_TYPE_NAMES).toContain(xeroAccountType({ Type: t }));
    }
    expect(xeroAccountType({ Type: "INVENTORY" })).toBe("Other Current Asset");
    expect(xeroAccountType({ Type: "DIRECTCOSTS" })).toBe("Cost of Goods Sold");
  });
  it("the receivable and payable control accounts are decided by SystemAccount", () => {
    expect(xeroAccountType({ Type: "CURRENT", SystemAccount: "DEBTORS" })).toBe("Accounts Receivable");
    expect(xeroAccountType({ Type: "CURRLIAB", SystemAccount: "CREDITORS" })).toBe("Accounts Payable");
  });
  it("regression: PAYGLIAB was never a real Xero AccountType — PAYGLIABILITY and bare PAYG are", () => {
    // The old map keyed on "PAYGLIAB", which Xero's API never actually sends,
    // so it silently fell through to the raw string — unrecognized by this
    // app's taxonomy, misclassified as a debit-normal Current Asset in
    // financials.ts's place(). Confirmed against Xero's documented
    // AccountType enum (2026-10-21).
    expect(xeroAccountType({ Type: "PAYGLIABILITY" })).toBe("Other Current Liability");
    expect(xeroAccountType({ Type: "PAYG" })).toBe("Other Current Liability");
    expect(xeroAccountType({ Type: "PAYGLIAB" })).not.toBe("Other Current Liability"); // not a real Xero value — must NOT silently "work"
  });
  it("regression: SUPERANNUATIONLIABILITY was entirely unmapped", () => {
    expect(xeroAccountType({ Type: "SUPERANNUATIONLIABILITY" })).toBe("Other Current Liability");
  });
});
