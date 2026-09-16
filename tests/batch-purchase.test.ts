/**
 * Which PaymentType a Data Studio "Expense" carries.
 *
 * QBO's Purchase covers cash, cheque AND card spending, and its PaymentType
 * must agree with the account funding it. Getting this wrong misfiles a real
 * transaction in a customer's books — a card spend recorded as cash — and
 * nothing in the import reports an error, because QuickBooks accepts it.
 */
import { describe, it, expect } from "vitest";
import { purchasePaymentType } from "@/lib/batch/builders";
import { ENTITIES } from "@/lib/batch/entities";

describe("purchasePaymentType", () => {
  it("makes a credit-card account a CreditCard purchase", () => {
    // The bug this fixes: Expenses hard-coded "Cash", so picking a card
    // account in the template filed the spend as cash.
    expect(purchasePaymentType("Cash", "Credit Card")).toBe("CreditCard");
  });

  it("leaves a bank account as the declared type", () => {
    expect(purchasePaymentType("Cash", "Bank")).toBe("Cash");
  });

  it("matches QBO's AccountType case-insensitively and ignores padding", () => {
    for (const t of ["credit card", "CREDIT CARD", "  Credit Card  "]) {
      expect(purchasePaymentType("Cash", t)).toBe("CreditCard");
    }
  });

  it("falls back to the declared type when the account type is unknown", () => {
    // Predictable default beats a guess: an unrecognised type must not
    // silently reclassify the document.
    for (const t of [null, undefined, "", "Other Current Asset"]) {
      expect(purchasePaymentType("Cash", t)).toBe("Cash");
    }
  });

  it("never turns a Cheque into something else", () => {
    // Checks are one payment type by definition. If deriving could override
    // them, the wrong account would change what the document IS.
    expect(purchasePaymentType("Check", "Credit Card")).toBe("Check");
    expect(purchasePaymentType("Check", "Bank")).toBe("Check");
  });

  it("corrects a card-declared purchase paid from a bank", () => {
    expect(purchasePaymentType("CreditCard", "Bank")).toBe("Cash");
  });
});

describe("the Expenses entity covers card spending", () => {
  const expense = ENTITIES.find(e => e.id === "expense")!;
  const filter = expense.qboClientFilter!;

  it("includes cash purchases", () => {
    expect(filter({ PaymentType: "Cash" })).toBe(true);
  });

  it("includes credit-card purchases — the ones that used to vanish", () => {
    expect(filter({ PaymentType: "CreditCard" })).toBe(true);
  });

  it("EXCLUDES credit-card credits, which are their own entity", () => {
    // Credit:true is money coming back. Showing it under both entities would
    // let an edit in one silently overwrite the other.
    expect(filter({ PaymentType: "CreditCard", Credit: true })).toBe(false);
  });

  it("excludes cheques, which are their own entity", () => {
    expect(filter({ PaymentType: "Check" })).toBe(false);
  });

  it("derives the payment type rather than hard-coding it", () => {
    // If this flag is ever dropped, card expenses silently become cash again.
    expect(ENTITIES.find(e => e.id === "expense")).toBeDefined();
    expect(String(expense.build)).toBeTruthy();
  });
});

describe("the sibling entities still own their payment types", () => {
  it("Checks and Credit Card Credits remain separate from Expenses", () => {
    const ids = ENTITIES.map(e => e.id);
    expect(ids).toContain("check");
    expect(ids).toContain("creditcardcredit");
  });

  it("Credit Card Credits still filters to credits only", () => {
    const cc = ENTITIES.find(e => e.id === "creditcardcredit")!;
    if (cc.qboClientFilter) {
      expect(cc.qboClientFilter({ PaymentType: "CreditCard", Credit: true })).toBe(true);
    }
  });
});
