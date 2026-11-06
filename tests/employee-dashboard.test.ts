import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { weekStatus, behindByWeek, behindByProject } from "@/lib/resources/dashboard";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const S = (actual = 0, pending = 0, draft = 0) => ({ actual, pending, draft });

describe("weekStatus — worst first", () => {
  it("an empty week is missing, never approved", () => {
    expect(weekStatus([])).toBe("missing");
  });
  it("returned beats draft beats submitted beats approved", () => {
    expect(weekStatus(["approved", "rejected", "draft"])).toBe("returned");
    expect(weekStatus(["approved", "submitted", "draft"])).toBe("draft");
    expect(weekStatus(["approved", "submitted"])).toBe("submitted");
    expect(weekStatus(["approved", "posted"])).toBe("approved");
  });
});

describe("planned vs logged", () => {
  const weeks = ["2026-10-12", "2026-10-19"];
  const planned = [
    { key: "project:a", assignableType: "project", assignableId: "a", weeks: [20, 10], total: 30 },
    { key: "project:b", assignableType: "project", assignableId: "b", weeks: [5, 0], total: 5 },
  ];
  const logged = [
    { key: "project:a", assignableType: "project", assignableId: "a", timesheetTypeId: null, weeks: [S(18, 2), S(9)], total: S(27, 2) },
    { key: "project:c", assignableType: "project", assignableId: "c", timesheetTypeId: null, weeks: [S(0, 0, 4), S(0)], total: S(0, 0, 4) },
    { key: "type:leave", assignableType: null, assignableId: null, timesheetTypeId: "leave", weeks: [S(8), S(0)], total: S(8) },
  ];

  it("per week sums every booking, logged counting all non-returned lines", () => {
    expect(behindByWeek(weeks, planned, logged)).toEqual([
      { week: "2026-10-12", planned: 25, logged: 32 },
      { week: "2026-10-19", planned: 10, logged: 9 },
    ]);
  });
  it("per project keeps unplanned work, drops leave/internal, sorts by size", () => {
    expect(behindByProject(planned, logged)).toEqual([
      { key: "project:a", planned: 30, logged: 29 },
      { key: "project:b", planned: 5, logged: 0 },
      { key: "project:c", planned: 0, logged: 4 },
    ]);
  });
});

describe("wiring", () => {
  const route = src("app/api/resources/me/dashboard/route.ts");
  it("is the caller's own data only, reachable by employee logins", () => {
    expect(route).toMatch(/requireOrg\(\{ allowEmployee: true \}\)/);
    expect(route).toMatch(/resolveActor\(orgId!, userId, role\)/);
    expect(route).not.toMatch(/searchParams\.get\("resourceId"\)/);
  });
  it("employee logins land on the dashboard", () => {
    expect(src("middleware.ts")).toMatch(/role === "employee" \? "\/my-time\/dashboard"/);
  });
});
