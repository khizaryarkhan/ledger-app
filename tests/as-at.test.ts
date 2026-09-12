/**
 * The "as at" report date — what counts as receivable on a given day.
 *
 * A paying client raises invoices ahead of time to track their collection
 * schedule. The dashboard counted every one of them as receivable today, so
 * ~$2.6m of not-yet-issued invoices buried the ~$700 actually owed and the
 * headline number was meaningless. The rule these tests pin down is the one
 * lib/ar-aging.ts has always applied to historical dates — a receivable exists
 * from the day it is invoiced — now applied on the live path too.
 */
import { describe, it, expect } from "vitest";
import { isWithinAsAt, localToday, ymd } from "@/lib/format";

const AS_AT = "2026-09-12";

describe("isWithinAsAt", () => {
  it("includes an invoice dated before the report date", () => {
    expect(isWithinAsAt("2026-08-04", AS_AT)).toBe(true);
  });

  it("includes an invoice dated ON the report date — as at means up to and including", () => {
    expect(isWithinAsAt(AS_AT, AS_AT)).toBe(true);
  });

  it("excludes an invoice dated after the report date — it isn't issued yet", () => {
    expect(isWithinAsAt("2026-09-13", AS_AT)).toBe(false);
    expect(isWithinAsAt("2027-01-01", AS_AT)).toBe(false);
  });

  it("keeps a row with no invoice date rather than dropping real debt", () => {
    // Absence of a date is not evidence the document is post-dated. Excluding
    // these would under-count genuine receivables, which is the failure mode
    // that caused the filter to be removed in the first place.
    expect(isWithinAsAt(null, AS_AT)).toBe(true);
    expect(isWithinAsAt(undefined, AS_AT)).toBe(true);
    expect(isWithinAsAt("", AS_AT)).toBe(true);
  });

  it("compares the date portion only, so a timestamp is safe", () => {
    // Provider syncs have written both plain dates and full timestamps here.
    expect(isWithinAsAt("2026-09-12T23:59:59.000Z", AS_AT)).toBe(true);
    expect(isWithinAsAt("2026-09-13T00:00:00.000Z", AS_AT)).toBe(false);
  });

  it("orders correctly across month and year ends — string compare, not Date maths", () => {
    expect(isWithinAsAt("2026-09-30", "2026-10-01")).toBe(true);
    expect(isWithinAsAt("2027-01-01", "2026-12-31")).toBe(false);
    expect(isWithinAsAt("2026-12-31", "2027-01-01")).toBe(true);
  });

  it("brings future invoices into scope when the user moves the date forward", () => {
    // This is the whole affordance: there is no separate 'show future' control
    // on the dashboard — setting As at forward is how you see them.
    const future = "2026-12-01";
    expect(isWithinAsAt(future, AS_AT)).toBe(false);
    expect(isWithinAsAt(future, "2026-12-31")).toBe(true);
  });
});

describe("localToday", () => {
  it("returns a plain YYYY-MM-DD", () => {
    expect(localToday()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("agrees with the machine's LOCAL calendar date, not the UTC one", () => {
    // The bug this prevents: new Date().toISOString().slice(0,10) is UTC, so
    // west of Greenwich it reads a day behind for much of the evening. Compared
    // against an invoice date that shifts real invoices out of scope.
    const now = new Date();
    expect(localToday()).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`,
    );
  });

  it("an invoice dated today is in scope as at today", () => {
    expect(isWithinAsAt(localToday(), localToday())).toBe(true);
  });

  it("ymd never rolls the day over, at either end of the day", () => {
    expect(ymd(new Date(2026, 8, 12, 0, 0, 0))).toBe("2026-09-12");   // month is 0-based
    expect(ymd(new Date(2026, 8, 12, 23, 59, 59))).toBe("2026-09-12");
    expect(ymd(new Date(2026, 0, 1))).toBe("2026-01-01");             // zero-padding
  });
});
