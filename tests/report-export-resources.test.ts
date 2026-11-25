import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildProjectHoursModel, buildEmployeeHoursModel, buildMyHoursModel } from "@/lib/reports/builders/resources";
import { weekEnd } from "@/lib/resources/reports";

const base = { entity: "Acme Ltd", currency: "EUR", periodLine: "For the period 01 Nov 2026 to 30 Nov 2026", from: "2026-11-01", to: "2026-11-30" };
const lines = (m: any) => m.sections[0].rows;

const projects: any[] = [
  { label: "Alpha", assignableType: "project", planned: 40, actual: 50, pending: 4, draft: 0, variance: 10, percentUsed: 125, cost: 1250.5,
    people: [{ name: "Sam", designation: "Engineer", planned: 40, actual: 50, pending: 4, draft: 0, variance: 10, percentUsed: 125, cost: 1250.5 }] },
  { label: "MO-1", assignableType: "manufacturing_order", planned: 0, actual: 8, pending: 0, draft: 2, variance: 8, percentUsed: null, cost: undefined, people: [] },
];

describe("Resources report exports", () => {
  it("project hours: every row has one cell per column, over-plan is flagged, unplanned has no percent", () => {
    const m = buildProjectHoursModel(projects, { ...base, canSeeCost: true });
    const cols = m.sections[0].columns.length;
    for (const r of lines(m)) expect(r.cells).toHaveLength(cols);
    expect(lines(m)[0].cells.slice(0, 2)).toEqual(["Alpha", "Project"]);
    expect(lines(m)[0].flags?.[6]).toBe(true); // variance
    expect(lines(m)[1].cells[0]).toBe("Sam (Engineer)");
    expect(lines(m)[1].indent).toBe(1);
    expect(lines(m)[2].cells[7]).toBeNull(); // no percent without a plan
    expect(lines(m)[2].flags).toBeUndefined();
    expect(lines(m)[2].cells[1]).toBe("Manufacturing order");
    expect(m.fileBase).toBe("Project-hours-2026-11-01-2026-11-30");
  });

  it("cost is never exported to someone who cannot see it", () => {
    const hidden = buildProjectHoursModel(projects, { ...base, canSeeCost: false });
    expect(hidden.sections[0].columns.some((c) => c.key === "cost")).toBe(false);
    expect(hidden.currency).toBeNull();
    expect(JSON.stringify(hidden)).not.toContain("1250.5");
    const shown = buildProjectHoursModel(projects, { ...base, canSeeCost: true });
    expect(shown.sections[0].columns.at(-1)?.key).toBe("cost");
    expect(lines(shown)[0].cells.at(-1)).toBe(1250.5);
    expect(lines(shown)[2].cells.at(-1)).toBeNull();
  });

  const employees: any[] = [{
    name: "Sam", designation: null, managerName: "Pat", capacity: 160, planned: 150, actual: 170, pending: 0, draft: 0, utilizationPercent: 106.25, cost: 900,
    weeks: [
      { weekStart: "2026-11-02", planned: 40, capacity: 40, actual: 10, pending: 0, draft: 0 },   // finished, under-logged
      { weekStart: "2026-11-23", planned: 40, capacity: 40, actual: 10, pending: 0, draft: 0 },   // not finished yet
    ],
  }];

  it("employee hours: over-capacity and under-logged finished weeks are flagged, open weeks are not", () => {
    const m = buildEmployeeHoursModel(employees, { ...base, canSeeCost: false, today: "2026-11-25", weekEnd });
    const cols = m.sections[0].columns.length;
    for (const r of lines(m)) expect(r.cells).toHaveLength(cols);
    const note = cols - 1;
    expect(lines(m)[0].cells[note]).toBe("Over capacity");
    expect(lines(m)[0].flags?.[8]).toBe(true);
    expect(lines(m)[1].cells[note]).toBe("Under-logged");
    expect(lines(m)[1].cells[0]).toBe("Week of 02 Nov 2026");
    expect(lines(m)[2].cells[note]).toBeNull();
    expect(JSON.stringify(m)).not.toContain("900");
  });

  const mine: any = {
    resource: { name: "Sam" },
    past: {
      weeks: ["2026-11-02", "2026-11-09"],
      rows: [{ label: "Alpha", weeks: [{ actual: 10, pending: 0, draft: 0 }, { actual: 0, pending: 5, draft: 0 }], total: { actual: 10, pending: 5, draft: 0 } }],
      totals: [{ actual: 10, pending: 0, draft: 0 }, { actual: 0, pending: 5, draft: 0 }], capacity: [40, 40], loggedHours: 15,
    },
    thisWeek: {
      weekStart: "2026-11-23", capacity: 40, planned: 30, logged: { actual: 9, pending: 0, draft: 0 },
      days: [
        { date: "2026-11-23", weekday: 1, capacity: 8, planned: 6, isHoliday: false, actual: 9, pending: 0, draft: 0 },
        { date: "2026-11-24", weekday: 2, capacity: 0, planned: 0, isHoliday: true, actual: 0, pending: 0, draft: 0 },
      ],
    },
    upcoming: { weeks: ["2026-11-30"], rows: [{ label: "Alpha", weeks: [50], total: 50 }], capacity: [40], planned: [50] },
  };

  it("my hours: three sections, approved per week with pending apart, flags where the screen colours", () => {
    const m = buildMyHoursModel(mine, { entity: "Acme Ltd", currency: null, today: "2026-11-25" })!;
    expect(m.sections.map((s) => s.heading)).toEqual(["Where my hours went", "This week — week of 23 Nov 2026", "Coming up"]);
    for (const s of m.sections) for (const r of s.rows) expect(r.cells).toHaveLength(s.columns.length);
    const past = m.sections[0].rows;
    expect(past[0].cells).toEqual(["Alpha", 10, null, 10, 5, null]);
    expect(past.at(-1)!.flags?.[1]).toBe(true); // 10 of 40 logged is under 80%
    const week = m.sections[1];
    expect(week.rows[2].flags?.[1]).toBe(true); // 9 logged against 8 capacity
    expect(week.rows[0].cells[2]).toBeNull();   // holiday has no capacity
    expect(week.rows.at(-1)!.cells[0]).toBe("Holiday: Tue 24 Nov 2026");
    expect(m.sections[2].rows.at(-1)!.flags?.[1]).toBe(true); // 50 planned over 40
  });

  it("my hours: nothing to export without a linked person", () => {
    expect(buildMyHoursModel({ resource: null }, { entity: "", currency: null, today: "2026-11-25" })).toBeNull();
  });
});

describe("Resources report wiring", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  it("both screens hand the shell an export model, and the team one holds it to the period it was fetched for", () => {
    expect(read("components/team-reports.tsx")).toMatch(/exportModel=\{exportModel\}/);
    expect(read("components/team-reports.tsx")).toMatch(/state\.key !== `\$\{from\}\|\$\{to\}`/);
    expect(read("components/my-reports.tsx")).toMatch(/exportModel=\{exportModel\}/);
  });
});
