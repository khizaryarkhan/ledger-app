import { describe, it, expect } from "vitest";
import { suggestNextPeriod, type PayrollSettings } from "@/lib/payroll/pay-periods";

const base: PayrollSettings = {
  payrollFrequency: null,
  payrollWeekEndDay: null,
  payrollBiweeklyAnchor: null,
  payrollSemimonthlyCutoff: null,
  payrollMonthCutoff: null,
};

describe("suggestNextPeriod — weekly", () => {
  it("suggests the 7 days ending on the configured week-end day, with no prior batch", () => {
    // 2026-10-02 is a Friday. Weeks end Friday.
    const p = suggestNextPeriod({ ...base, payrollFrequency: "weekly", payrollWeekEndDay: 5 }, null, "2026-10-02");
    expect(p).toEqual({ start: "2026-09-26", end: "2026-10-02" });
  });

  it("a Sunday-ending org mid-week finds last Sunday, not this Friday", () => {
    const p = suggestNextPeriod({ ...base, payrollFrequency: "weekly", payrollWeekEndDay: 7 }, null, "2026-10-02");
    expect(p).toEqual({ start: "2026-09-21", end: "2026-09-27" });
  });

  it("continues strictly after the last posted period, regardless of today", () => {
    const p = suggestNextPeriod({ ...base, payrollFrequency: "weekly", payrollWeekEndDay: 5 }, "2026-09-25", "2026-12-01");
    expect(p).toEqual({ start: "2026-09-26", end: "2026-10-02" });
  });
});

describe("suggestNextPeriod — biweekly", () => {
  it("uses the anchor to fix which alternating Friday starts a fortnight", () => {
    // Anchor fortnight ends 2026-09-18 (a Friday); the next one ends 2026-10-02,
    // and today falling exactly on that end day resolves to the just-completed one.
    const org: PayrollSettings = { ...base, payrollFrequency: "biweekly", payrollWeekEndDay: 5, payrollBiweeklyAnchor: "2026-09-18" };
    const p = suggestNextPeriod(org, null, "2026-10-02");
    expect(p).toEqual({ start: "2026-09-19", end: "2026-10-02" });
  });

  it("a date mid-fortnight resolves to the most recently COMPLETED fortnight, not the one in progress", () => {
    // Same rule weekly uses: a period is suggested once it's over, never early.
    const org: PayrollSettings = { ...base, payrollFrequency: "biweekly", payrollWeekEndDay: 5, payrollBiweeklyAnchor: "2026-09-18" };
    const p = suggestNextPeriod(org, null, "2026-09-25"); // mid-way through the Sep19-Oct2 fortnight
    expect(p).toEqual({ start: "2026-09-05", end: "2026-09-18" });
  });

  it("falls back to a single week when no anchor is configured yet", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "biweekly", payrollWeekEndDay: 5, payrollBiweeklyAnchor: null };
    const p = suggestNextPeriod(org, null, "2026-10-02");
    expect(p).toEqual({ start: "2026-09-26", end: "2026-10-02" });
  });
});

describe("suggestNextPeriod — semi-monthly", () => {
  it("first half (1st–cutoff) when today falls before the cutoff", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "semi_monthly", payrollSemimonthlyCutoff: 15 };
    expect(suggestNextPeriod(org, null, "2026-10-10")).toEqual({ start: "2026-10-01", end: "2026-10-15" });
  });

  it("second half (cutoff+1–month end) when today falls after the cutoff", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "semi_monthly", payrollSemimonthlyCutoff: 15 };
    expect(suggestNextPeriod(org, null, "2026-10-20")).toEqual({ start: "2026-10-16", end: "2026-10-31" });
  });

  it("rolls from a second-half close into next month's first half", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "semi_monthly", payrollSemimonthlyCutoff: 15 };
    expect(suggestNextPeriod(org, "2026-10-31", "2026-12-01")).toEqual({ start: "2026-11-01", end: "2026-11-15" });
  });

  it("handles a February month-end correctly (non-leap year)", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "semi_monthly", payrollSemimonthlyCutoff: 15 };
    expect(suggestNextPeriod(org, "2027-02-15", "2027-03-01")).toEqual({ start: "2027-02-16", end: "2027-02-28" });
  });
});

describe("suggestNextPeriod — monthly", () => {
  it("calendar month (1st–month end) when no cutoff is configured", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "monthly", payrollMonthCutoff: null };
    expect(suggestNextPeriod(org, null, "2026-02-10")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
  });

  it("a custom cutoff (e.g. 25th) before the cutoff resolves to the in-progress period", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "monthly", payrollMonthCutoff: 25 };
    expect(suggestNextPeriod(org, null, "2026-10-10")).toEqual({ start: "2026-09-26", end: "2026-10-25" });
  });

  it("a custom cutoff after the cutoff rolls into next month's period", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "monthly", payrollMonthCutoff: 25 };
    expect(suggestNextPeriod(org, null, "2026-10-28")).toEqual({ start: "2026-10-26", end: "2026-11-25" });
  });

  it("clamps a cutoff beyond a short month's length to that month's last day", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "monthly", payrollMonthCutoff: 31 };
    // Previous period ends Jan 31; next period's cutoff (31) doesn't exist in
    // Feb (non-leap), so it clamps to Feb 28.
    expect(suggestNextPeriod(org, "2027-01-31", "2027-03-01")).toEqual({ start: "2027-02-01", end: "2027-02-28" });
  });

  it("continues strictly after the last posted period", () => {
    const org: PayrollSettings = { ...base, payrollFrequency: "monthly", payrollMonthCutoff: null };
    expect(suggestNextPeriod(org, "2026-09-30", "2027-01-01")).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });
});
