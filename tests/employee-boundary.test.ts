/**
 * The "employee" login (a person who only fills their own timesheet) must stay
 * confined to /api/resources/me/**. The confinement is an explicit opt-in on
 * requireOrg() — NOT a path read from the x-app-path header, which middleware
 * leaves unstamped on its cron/public branches and which a client could spoof
 * (found in review, 2026-11-01).
 */

import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(__dirname, "..");
const API = join(ROOT, "app", "api");
const ME = join(API, "resources", "me");

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (/^route\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

const rel = (p: string) => relative(ROOT, p).split(sep).join("/");
const src = (p: string) => readFileSync(p, "utf8");

describe("employee boundary", () => {
  it("requireOrg denies the employee role unless the handler opts in — never by header", () => {
    const api = src(join(ROOT, "lib", "api.ts"));
    expect(api).toMatch(/role === "employee" && !opts\.allowEmployee/);
    // The old gate read the path out of x-app-path; that is the spoofable form.
    expect(api).not.toMatch(/startsWith\(["']\/api\/resources\/me/);
    expect(api).not.toMatch(/appPath === ["']\/api\/resources\/me/);
  });

  it("only /api/resources/me/** handlers opt in", () => {
    const offenders = routeFiles(API)
      .filter((f) => !f.startsWith(ME))
      .filter((f) => src(f).includes("allowEmployee"))
      .map(rel);
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("every requireOrg call under /api/resources/me opts in, so an employee can actually use it", () => {
    const bad: string[] = [];
    for (const f of routeFiles(ME)) {
      const s = src(f);
      const calls = (s.match(/requireOrg\(/g) ?? []).length;
      const optedIn = (s.match(/requireOrg\(\{ allowEmployee: true \}\)/g) ?? []).length;
      if (calls === 0 || calls !== optedIn) bad.push(`${rel(f)} (${optedIn}/${calls} opted in)`);
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });

  it("the login route only resets or removes accounts this org alone owns", () => {
    const login = src(join(API, "resources", "[id]", "login", "route.ts"));
    expect(login).toMatch(/memberships\.length !== 1/);
    expect(login).toMatch(/u\.orgId !== orgId/);
    // A password reset must never re-enable a deactivated account.
    expect(login).not.toMatch(/set\(\{ passwordHash, status/);
  });

  it("pay rates reach only org admins", () => {
    for (const f of ["project", "employee"]) {
      const s = src(join(ME, "reports", f, "route.ts"));
      expect(s, f).toMatch(/const canSeeCost = actor\.isOrgAdmin;/);
    }
    const cost = src(join(API, "resources", "cost-report", "route.ts"));
    // Every grouping, not only per-person: cost / hours on a one-person project is a pay rate too.
    expect(cost).toMatch(/if \(!isAdminRole\(role\)\) return bad\("Only organisation admins can see labour cost", 403\)/);
  });
});
