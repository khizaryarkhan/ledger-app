import { describe, it, expect } from "vitest";
import {
  isRealDate, weekdayIndex, weekStartOf, weekDates, isEditableStatus, isSubmittableStatus,
  isDecidableStatus, parseHours, exceedsDay, parseReason, decideEntry,
} from "@/lib/resources/time-entry-rules";
import { buildActor, type PersonNode } from "@/lib/resources/access";

// boss <- lead <- dev ; peer reports to boss
const people: PersonNode[] = [
  { id: "boss", managerId: null },
  { id: "lead", managerId: "boss" },
  { id: "dev", managerId: "lead" },
  { id: "peer", managerId: "boss" },
];

describe("dates", () => {
  it("refuses impossible calendar dates", () => {
    expect(isRealDate("2026-02-31")).toBe(false);
    expect(isRealDate("2026-13-01")).toBe(false);
    expect(isRealDate("2026-2-3")).toBe(false);
    expect(isRealDate("2028-02-29")).toBe(true);
    expect(isRealDate("2026-02-29")).toBe(false);
  });
  it("finds Monday-start weeks by string arithmetic", () => {
    expect(weekdayIndex("2026-11-02")).toBe(0); // Monday
    expect(weekdayIndex("2026-11-01")).toBe(6); // Sunday
    expect(weekStartOf("2026-11-01")).toBe("2026-10-26");
    expect(weekStartOf("2026-11-04")).toBe("2026-11-02");
    expect(weekDates("2026-12-31")).toEqual(["2026-12-28", "2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03"]);
  });
});

describe("status machine", () => {
  it("lets the owner change only draft or rejected", () => {
    expect(isEditableStatus("draft")).toBe(true);
    expect(isEditableStatus("rejected")).toBe(true);
    for (const s of ["submitted", "approved", "posted"]) expect(isEditableStatus(s)).toBe(false);
  });
  it("submits draft or rejected; decides only submitted", () => {
    expect(isSubmittableStatus("rejected")).toBe(true);
    expect(isSubmittableStatus("approved")).toBe(false);
    expect(isDecidableStatus("submitted")).toBe(true);
    expect(isDecidableStatus("approved")).toBe(false);
    expect(isDecidableStatus("posted")).toBe(false);
  });
});

describe("input", () => {
  it("parses hours", () => {
    expect(parseHours("7.5")).toEqual({ ok: true, hours: 7.5 });
    expect(parseHours(8.256)).toEqual({ ok: true, hours: 8.26 });
    expect(parseHours(0).ok).toBe(false);
    expect(parseHours(-1).ok).toBe(false);
    expect(parseHours("").ok).toBe(false);
    expect(parseHours("abc").ok).toBe(false);
    expect(parseHours(25).ok).toBe(false);
  });
  it("caps a day at 24 hours", () => {
    expect(exceedsDay(16, 8)).toBe(false);
    expect(exceedsDay(16, 8.01)).toBe(true);
  });
  it("requires a reason to reject", () => {
    expect(parseReason("  ").ok).toBe(false);
    expect(parseReason(undefined).ok).toBe(false);
    expect(parseReason(" wrong project ")).toEqual({ ok: true, reason: "wrong project" });
  });
});

describe("approval decisions", () => {
  const entry = (resourceId: string, status = "submitted") => ({ resourceId, status });

  it("lets a manager approve down the chain, not sideways or up", () => {
    const lead = buildActor("company_user", "lead", "team");
    expect(decideEntry(lead, entry("dev"), people).ok).toBe(true);
    expect(decideEntry(lead, entry("peer"), people).ok).toBe(false);
    expect(decideEntry(lead, entry("boss"), people).ok).toBe(false);
  });
  it("never lets a non-admin approve their own time", () => {
    const boss = buildActor("company_user", "boss", "all");
    const d = decideEntry(boss, entry("boss"), people);
    expect(d.ok).toBe(false);
    if ("error" in d) expect(d.status).toBe(403);
  });
  it("lets an org-wide approver act for anyone else", () => {
    const hr = buildActor("company_user", "peer", "all");
    expect(decideEntry(hr, entry("dev"), people).ok).toBe(true);
  });
  it("refuses self-level people and logins with no person", () => {
    expect(decideEntry(buildActor("company_user", "dev", "self"), entry("lead"), people).ok).toBe(false);
    expect(decideEntry(buildActor("company_user", null, "all"), entry("dev"), people).ok).toBe(false);
  });
  it("lets an org admin decide anything submitted, including their own", () => {
    const admin = buildActor("company_admin", "boss", "self");
    expect(decideEntry(admin, entry("boss"), people).ok).toBe(true);
    expect(decideEntry(admin, entry("dev"), people).ok).toBe(true);
  });
  it("treats approved and posted as immutable", () => {
    const admin = buildActor("company_admin", null, null);
    for (const s of ["approved", "posted", "draft", "rejected"]) {
      const d = decideEntry(admin, entry("dev", s), people);
      expect(d.ok).toBe(false);
      if ("error" in d) expect(d.status).toBe(409);
    }
  });
});
