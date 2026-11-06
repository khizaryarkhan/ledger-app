import { describe, it, expect } from "vitest";
import {
  buildLines, lineIsEditable, lineAcceptsNewHours, planLineAction, actionAppliesTo,
  copyableRows, copyPlan, summariseAction, type LineEntry,
} from "@/lib/resources/timesheet-lines";
import { readFileSync } from "node:fs";

const WK = "2026-11-02"; // a Monday (verified: 2 Nov 2026 is a Monday)
const e = (id: string, date: string, status: string, over: Partial<LineEntry> = {}): LineEntry => ({
  id, date, hours: "8", timesheetTypeId: "work", assignableType: "project", assignableId: "p1", status, ...over,
});

describe("buildLines — a line splits by status", () => {
  it("one booking, all draft, is one Draft line", () => {
    const lines = buildLines([e("a", "2026-11-02", "draft"), e("b", "2026-11-03", "draft")]);
    expect(lines).toHaveLength(1);
    expect(lines[0].status).toBe("draft");
    expect(lines[0].entries.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("part approved, part returned, part left undecided -> three lines for the same booking", () => {
    const lines = buildLines([
      e("mon", "2026-11-02", "approved"), e("tue", "2026-11-03", "approved"),
      e("wed", "2026-11-04", "rejected", { rejectedReason: "wrong project" }),
      e("thu", "2026-11-05", "submitted"),
    ]);
    expect(lines.map((l) => l.status)).toEqual(["rejected", "submitted", "approved"]);
    expect(new Set(lines.map((l) => l.bookingKey)).size).toBe(1);
    expect(lines.find((l) => l.status === "approved")!.entries.map((x) => x.id)).toEqual(["mon", "tue"]);
    // Never a single "mixed" line.
    expect(lines.some((l) => l.status === "mixed")).toBe(false);
  });

  it("different bookings stay apart even in the same status", () => {
    const lines = buildLines([e("a", "2026-11-02", "draft"), e("b", "2026-11-02", "draft", { assignableId: "p2" })]);
    expect(lines).toHaveLength(2);
  });

  it("an added line with no hours shows as New, unless that booking already has a Draft line", () => {
    const b = { typeId: "work", aType: "project", aId: "p9" };
    expect(buildLines([], [b])[0].status).toBe("new");
    const withDraft = buildLines([e("a", "2026-11-02", "draft", { assignableId: "p9" })], [b]);
    expect(withDraft.map((l) => l.status)).toEqual(["draft"]);
    // An approved line on the same booking does not stop a fresh Draft line being added.
    const withApproved = buildLines([e("a", "2026-11-02", "approved", { assignableId: "p9" })], [b]);
    expect(withApproved.map((l) => l.status)).toEqual(["new", "approved"]);
  });

  it("only Draft/New lines take new hours; Rejected cells stay correctable", () => {
    expect(lineAcceptsNewHours({ status: "draft" })).toBe(true);
    expect(lineAcceptsNewHours({ status: "rejected" })).toBe(false);
    expect(lineIsEditable({ status: "rejected" })).toBe(true);
    expect(lineIsEditable({ status: "submitted" })).toBe(false);
    expect(lineIsEditable({ status: "approved" })).toBe(false);
  });
});

describe("line actions", () => {
  const rows = [
    { id: "d", status: "draft", resourceId: "me" },
    { id: "r", status: "rejected", resourceId: "me" },
    { id: "s", status: "submitted", resourceId: "me" },
    { id: "a", status: "approved", resourceId: "me" },
    { id: "x", status: "draft", resourceId: "someone-else" },
  ];
  it("submit takes Draft and Rejected, skips the rest", () => {
    const p = planLineAction("submit", rows, "me");
    expect(p.apply.map((x) => x.id)).toEqual(["d", "r"]);
    expect(p.skipped).toBe(3);
  });
  it("recall takes only Submitted — an approved line is never recalled", () => {
    expect(planLineAction("recall", rows, "me").apply.map((x) => x.id)).toEqual(["s"]);
    expect(actionAppliesTo("recall", "approved")).toBe(false);
  });
  it("delete never touches submitted, approved or posted time", () => {
    expect(planLineAction("delete", rows, "me").apply.map((x) => x.id)).toEqual(["d", "r"]);
    expect(actionAppliesTo("delete", "posted")).toBe(false);
  });
  it("someone else's entry is skipped, never acted on", () => {
    expect(planLineAction("submit", rows, "me").apply.some((x) => x.id === "x")).toBe(false);
  });
  it("summary reads plainly", () => {
    expect(summariseAction("recall", 2, 1, 0)).toBe("2 entries recalled to Draft, 1 skipped (not in a state that allows it)");
  });
});

describe("Copy Week", () => {
  const types = [
    { id: "work", category: "work", status: "active" },
    { id: "hol", category: "leave", status: "active" },
    { id: "old", category: "work", status: "inactive" },
  ];
  const src = [
    e("1", "2026-10-26", "approved"), e("2", "2026-10-27", "submitted", { hours: "4.5" }),
    e("3", "2026-10-28", "rejected"),
    e("4", "2026-10-29", "approved", { timesheetTypeId: "hol", assignableType: null, assignableId: null }),
    e("5", "2026-10-30", "draft", { timesheetTypeId: "old" }),
  ];
  it("offers one row per booking with hours per weekday; leave, retired types and returned lines do not copy", () => {
    const rows = copyableRows(src, "2026-10-26", types);
    expect(rows).toHaveLength(1);
    expect(rows[0].days).toEqual([8, 4.5, 0, 0, 0, 0, 0]);
    expect(rows[0].hours).toBe(12.5);
  });
  it("copies onto the same weekday, skipping days already holding time on that booking", () => {
    const rows = copyableRows(src, "2026-10-26", types);
    const plan = copyPlan(rows, [rows[0].key], WK, [e("x", "2026-11-03", "draft")]);
    expect(plan.create.map((c) => [c.date, c.hours])).toEqual([["2026-11-02", 8]]);
    expect(plan.skipped).toBe(1);
  });
  it("copies nothing that was not ticked", () => {
    const rows = copyableRows(src, "2026-10-26", types);
    expect(copyPlan(rows, [], WK, []).create).toHaveLength(0);
  });
});

describe("the grid uses the line rules", () => {
  it("my-timesheet groups by line (booking + status), not one row per booking", () => {
    const src = readFileSync("components/my-timesheet.tsx", "utf8");
    expect(src).toMatch(/buildLines\(/);
    expect(src).not.toMatch(/"mixed"/);
  });
  it("the self-service routes act only on the caller's own entries", () => {
    const srv = readFileSync("lib/resources/timesheet-lines-server.ts", "utf8");
    expect(srv).toMatch(/eq\(timeEntries\.resourceId, me\)/);
  });
});
