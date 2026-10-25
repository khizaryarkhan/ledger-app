/**
 * Pure scheduling math for recurring document templates (QBO form-parity,
 * Phase 6). No db — proven directly, same pattern as report-periods.test.ts.
 */
import { describe, it, expect } from "vitest";
import { nextOccurrence, isTemplateFinished } from "@/lib/accounting/recurring";

describe("nextOccurrence", () => {
  it("advances daily by N days", () => {
    expect(nextOccurrence("2026-10-25", "daily", 1)).toBe("2026-10-26");
    expect(nextOccurrence("2026-10-25", "daily", 5)).toBe("2026-10-30");
  });

  it("advances weekly by N×7 days", () => {
    expect(nextOccurrence("2026-10-25", "weekly", 1)).toBe("2026-11-01");
    expect(nextOccurrence("2026-10-25", "weekly", 2)).toBe("2026-11-08");
  });

  it("advances monthly, clamping to the shorter month's last day", () => {
    expect(nextOccurrence("2026-01-31", "monthly", 1)).toBe("2026-02-28");
    expect(nextOccurrence("2026-01-15", "monthly", 1)).toBe("2026-02-15");
  });

  it("advances yearly, including a leap-day source date", () => {
    expect(nextOccurrence("2024-02-29", "yearly", 1)).toBe("2025-02-28");
    expect(nextOccurrence("2026-06-01", "yearly", 2)).toBe("2028-06-01");
  });

  it("treats a zero or negative interval as 1, never going backwards or stalling", () => {
    expect(nextOccurrence("2026-10-25", "daily", 0)).toBe("2026-10-26");
    expect(nextOccurrence("2026-10-25", "daily", -3)).toBe("2026-10-26");
  });
});

describe("isTemplateFinished", () => {
  it("'never' end type is never finished", () => {
    expect(isTemplateFinished({ endType: "never", occurrencesCreated: 999, nextRunDate: "2099-01-01" })).toBe(false);
  });

  it("'after' N occurrences stops once reached, not before", () => {
    expect(isTemplateFinished({ endType: "after", endAfterCount: 3, occurrencesCreated: 2, nextRunDate: "2026-11-01" })).toBe(false);
    expect(isTemplateFinished({ endType: "after", endAfterCount: 3, occurrencesCreated: 3, nextRunDate: "2026-11-01" })).toBe(true);
  });

  it("'on' a date stops once the NEXT run would fall after it", () => {
    expect(isTemplateFinished({ endType: "on", endOnDate: "2026-12-31", occurrencesCreated: 5, nextRunDate: "2026-12-31" })).toBe(false);
    expect(isTemplateFinished({ endType: "on", endOnDate: "2026-12-31", occurrencesCreated: 5, nextRunDate: "2027-01-01" })).toBe(true);
  });
});
