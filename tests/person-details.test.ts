import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { fromDaily, toDaily } from "@/lib/resources/capacity-unit";
import { maskSecret, parseDetailsPatch, datesOutOfOrder, SELF_LOCKED_FIELDS, PLAIN_FIELDS } from "@/lib/resources/personal-details";
import { checkApiPath } from "@/lib/mcp/policy";

const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");
const MON_FRI = [1, 2, 3, 4, 5];

describe("capacity unit — storage stays hours per day", () => {
  it("shows 8h/day as 40h/week on a five-day week", () => {
    expect(fromDaily(8, "week", MON_FRI)).toBe(40);
  });
  it("follows the person's own pattern: four days at 8h is 32h/week, not 40", () => {
    expect(fromDaily(8, "week", [1, 2, 3, 4])).toBe(32);
    expect(toDaily(32, "week", [1, 2, 3, 4])).toBe(8);
  });
  it("a month is 52/12 weeks", () => {
    expect(fromDaily(8, "month", MON_FRI)).toBeCloseTo(173.3, 1);
    expect(toDaily(173.333333, "month", MON_FRI)).toBeCloseTo(8, 4);
  });
  it("round-trips a figure that does not divide evenly", () => {
    const daily = toDaily(40, "week", [1, 2, 3]); // 13.333…
    const stored = Math.round(daily * 100) / 100; // daily_capacity is numeric(6,2)
    expect(fromDaily(stored, "week", [1, 2, 3])).toBe(40);
  });
  it("per day is unchanged, and no working days falls back to five", () => {
    expect(fromDaily(7.5, "day", MON_FRI)).toBe(7.5);
    expect(fromDaily(8, "week", [])).toBe(40);
  });
});

describe("personal details — secrets are never returned", () => {
  it("masks to the last four, and reveals nothing for short values", () => {
    expect(maskSecret("GB29 NWBK 6016 1331 9268 19")).toEqual({ set: true, last4: "6819" });
    expect(maskSecret("12-34")).toEqual({ set: true, last4: null });
    expect(maskSecret("")).toEqual({ set: false, last4: null });
  });
});

describe("parseDetailsPatch", () => {
  const today = "2026-11-06";
  it("keeps only known fields; empty clears", () => {
    const r = parseDetailsPatch({ jobTitle: " Engineer ", city: "", hacker: "x" }, today);
    expect("patch" in r && r.patch).toEqual({ jobTitle: "Engineer", city: null });
  });
  it("refuses bad dates, emails, types and a future birth date", () => {
    expect(parseDetailsPatch({ dateOfBirth: "06/11/1990" }, today)).toHaveProperty("error");
    expect(parseDetailsPatch({ personalEmail: "not-an-email" }, today)).toHaveProperty("error");
    expect(parseDetailsPatch({ employmentType: "volunteer" }, today)).toHaveProperty("error");
    expect(parseDetailsPatch({ dateOfBirth: "2030-01-01" }, today)).toHaveProperty("error");
    expect(parseDetailsPatch({ jobTitle: 42 } as any, today)).toHaveProperty("error");
  });
  it("end before start is out of order", () => {
    expect(datesOutOfOrder("2026-01-10", "2026-01-09")).toBe(true);
    expect(datesOutOfOrder("2026-01-10", null)).toBe(false);
  });
});

describe("wiring", () => {
  const route = src("app/api/resources/[id]/personal-details/route.ts");
  const shared = src("lib/resources/personal-details-server.ts");
  it("is admin-only and only ever returns masked secrets", () => {
    expect(route).toMatch(/isAdminRole\(ctx\.role\)/);
    expect(shared).toMatch(/maskSecret\(decryptSecret/);
    expect(shared).toMatch(/encryptSecret\(v\)/);
  });
  it("the audit row names the fields, never their values", () => {
    expect(shared).toMatch(/fields: changed/);
  });
  it("AI connections cannot reach it", () => {
    expect(checkApiPath("/api/resources/abc/personal-details").ok).toBe(false);
  });
});

describe("self-service", () => {
  const self = src("app/api/resources/me/personal-details/route.ts");
  const shared = src("lib/resources/personal-details-server.ts");
  it("finds the person from the session, never from the request", () => {
    expect(self).toMatch(/eq\(resources\.userId, userId\)/);
    expect(self).not.toMatch(/params/);
    expect(self).toMatch(/allowEmployee: true/);
  });
  it("saves through the same code as the admin route, marked as self", () => {
    expect(self).toMatch(/self: true/);
    expect(src("app/api/resources/[id]/personal-details/route.ts")).toMatch(/self: false/);
  });
  it("refuses — not ignores — a change to an employment field", () => {
    expect(shared).toMatch(/opts\.self && \(SELF_LOCKED_FIELDS/);
    expect(SELF_LOCKED_FIELDS).toEqual(["employeeNumber", "jobTitle", "employmentType", "startDate", "endDate"]);
    for (const f of SELF_LOCKED_FIELDS) expect(PLAIN_FIELDS as readonly string[]).toContain(f);
  });
  it("AI connections cannot reach it either", () => {
    expect(checkApiPath("/api/resources/me/personal-details").ok).toBe(false);
  });
});
