import { describe, it, expect } from "vitest";
import { xeroAccountType } from "@/lib/xero-ap-sync";
import { ACCOUNT_TYPE_NAMES } from "@/lib/accounting/account-types";

// Posting roles validate against the app's (QBO-style) account types; a Xero
// chart stored in Xero's own codes could never be mapped to a role.
describe("Xero account types", () => {
  it("map onto the app's account types", () => {
    for (const t of ["BANK", "CURRENT", "INVENTORY", "PREPAYMENT", "FIXED", "NONCURRENT", "CURRLIAB", "LIABILITY", "PAYGLIAB", "TERMLIAB", "EQUITY", "REVENUE", "SALES", "OTHERINCOME", "DIRECTCOSTS", "EXPENSE", "OVERHEADS", "DEPRECIATN"]) {
      expect(ACCOUNT_TYPE_NAMES).toContain(xeroAccountType({ Type: t }));
    }
    expect(xeroAccountType({ Type: "INVENTORY" })).toBe("Other Current Asset");
    expect(xeroAccountType({ Type: "DIRECTCOSTS" })).toBe("Cost of Goods Sold");
  });
  it("the receivable and payable control accounts are decided by SystemAccount", () => {
    expect(xeroAccountType({ Type: "CURRENT", SystemAccount: "DEBTORS" })).toBe("Accounts Receivable");
    expect(xeroAccountType({ Type: "CURRLIAB", SystemAccount: "CREDITORS" })).toBe("Accounts Payable");
  });
});
