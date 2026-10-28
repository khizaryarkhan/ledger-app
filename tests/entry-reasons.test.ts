import { describe, it, expect } from "vitest";
import { checkReason, checkReceivedDate, captureLagDays, reasonsFor, reasonLabel, CREDIT_REASONS, JOURNAL_REASONS } from "@/lib/accounting/entry-reasons";

describe("checkReason", () => {
  it("picks the list by document type", () => {
    expect(reasonsFor("CreditNote")).toBe(CREDIT_REASONS);
    expect(reasonsFor("VendorCredit")).toBe(CREDIT_REASONS);
    expect(reasonsFor("Manual")).toBe(JOURNAL_REASONS);
    expect(reasonsFor("Invoice")).toBeNull();
  });
  it("requires a reason on a credit only when asked to (system callers are not forced)", () => {
    expect(() => checkReason("CreditNote", undefined, { required: true })).toThrow(/why this credit/);
    expect(checkReason("CreditNote", undefined)).toBeNull();
    expect(() => checkReason("Manual", "", { required: true })).toThrow(/what this journal is for/);
  });
  it("refuses a code from the wrong list", () => {
    expect(() => checkReason("CreditNote", "accrual")).toThrow();
    expect(checkReason("Manual", "accrual")).toBe("accrual");
  });
  it("ignores a reason on a type that takes none", () => {
    expect(checkReason("Invoice", "goodwill", { required: true })).toBeNull();
  });
  it("labels unrecorded and known codes", () => {
    expect(reasonLabel("CreditNote", null)).toBe("Not recorded");
    expect(reasonLabel("CreditNote", "goodwill")).toBe("Goodwill");
  });
});

describe("checkReceivedDate", () => {
  it("only applies to purchase documents", () => {
    expect(checkReceivedDate("Invoice", "2026-10-05", "2026-10-01", "2026-10-28")).toBeNull();
  });
  it("accepts a date between the bill date and today", () => {
    expect(checkReceivedDate("Bill", "2026-10-05", "2026-10-01", "2026-10-28")).toBe("2026-10-05");
  });
  it("refuses a date before the bill's own date or in the future", () => {
    expect(() => checkReceivedDate("Bill", "2026-09-30", "2026-10-01", "2026-10-28")).toThrow(/before its own date/);
    expect(() => checkReceivedDate("Bill", "2026-11-01", "2026-10-01", "2026-10-28")).toThrow(/future/);
    expect(() => checkReceivedDate("Bill", "01/10/2026", "2026-10-01", "2026-10-28")).toThrow();
  });
  it("blank is allowed", () => {
    expect(checkReceivedDate("Expense", "", "2026-10-01", "2026-10-28")).toBeNull();
  });
});

describe("captureLagDays", () => {
  it("counts days from bill date to arrival", () => {
    expect(captureLagDays("2026-10-01", "2026-10-09")).toBe(8);
    expect(captureLagDays("2026-10-01", null)).toBeNull();
  });
});
