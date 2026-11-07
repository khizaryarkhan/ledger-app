import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { RESOURCE_NAV, resourceNavFor, portalNavFor, SELF_ONLY_CAPS, type ResourceCaps } from "@/lib/resources/nav";

const root = process.cwd();
const src = (p: string) => readFileSync(join(root, p), "utf8");
const hrefs = (caps: ResourceCaps) => resourceNavFor(caps).flatMap((s) => s.items.map((i) => i.href));
const headings = (caps: ResourceCaps) => resourceNavFor(caps).map((s) => s.label);

const self: ResourceCaps = { ...SELF_ONLY_CAPS, modules: ["resources"] };
const approver: ResourceCaps = { approve: true, team: false, admin: false, modules: ["resources"] };
const lead: ResourceCaps = { approve: true, team: true, admin: false, modules: ["resources"] };
const admin: ResourceCaps = { approve: true, team: true, admin: true, modules: ["resources", "manufacturing"] };

describe("Resources menu is capability-driven", () => {
  it("someone with only their own records sees only their own links, and empty headings vanish", () => {
    expect(hrefs(self)).toEqual(["/resources/my-dashboard", "/resources/my-time", "/resources/notifications", "/resources/my-details", "/resources/my-reports"]);
    expect(headings(self)).toEqual(["", "Operations", "My Pulse", "Insights"]);
  });
  it("approving time adds approval and hours-over-plan, nothing team-wide", () => {
    expect(hrefs(approver)).toContain("/resources/approvals");
    expect(hrefs(approver)).toContain("/resources/enquiries");
    expect(hrefs(approver)).not.toContain("/resources/board");
  });
  it("a team scope adds planning and team reports, never setup, posting or cost", () => {
    const h = hrefs(lead);
    for (const p of ["/resources/board", "/resources/utilization", "/resources/reports", "/resources/compliance", "/resources/equipment"]) expect(h).toContain(p);
    for (const p of ["/resources/timesheets", "/resources/cost", "/resources/people", "/resources/payroll-settings"]) expect(h).not.toContain(p);
    expect(headings(lead)).not.toContain("Setup");
  });
  it("machine usage needs the manufacturing module, whatever the role", () => {
    expect(hrefs(lead)).not.toContain("/resources/machines");
    expect(hrefs({ ...lead, modules: ["resources", "manufacturing"] })).toContain("/resources/machines");
  });
  it("an org admin sees every link", () => {
    expect(hrefs(admin).length).toBe(RESOURCE_NAV.flatMap((s) => s.items).length);
  });
  it("every link points at a page that exists", () => {
    for (const i of RESOURCE_NAV.flatMap((s) => s.items)) {
      expect(existsSync(join(root, "app/(app)", i.href, "page.tsx")), i.href).toBe(true);
    }
  });
  it("names no organisation's job titles — the product fits any org", () => {
    const text = JSON.stringify(RESOURCE_NAV);
    for (const t of ["EDC", "Director", "Project Lead", "Associate", "Regional", "CEO"]) expect(text).not.toContain(t);
  });
});

describe("pages enforce what the menu promises", () => {
  it("the sidebar renders the menu from the shared definition", () => {
    expect(src("components/sidebar.tsx")).toMatch(/resourceNavFor\(/);
  });
  it("the planning board, bookings and machine report check the same team capability", () => {
    expect(src("app/api/resources/assignments/route.ts")).toMatch(/if \(!access\.allowed\) return bad\(/);
    expect(src("app/api/resources/assignments/route.ts")).toMatch(/canPlanResource\(access, resource\)/);
    expect(src("app/api/resources/assignments/[id]/route.ts")).toMatch(/mayChange\(orgId!, session, role, existing\.resourceId\)/g);
    expect(src("app/api/resources/machines/report/route.ts")).toMatch(/planningAccess\(orgId!, session, role\)\)\.allowed/);
  });
  it("the board never returns a login id, nor a pay rate to a non-admin", () => {
    expect(src("app/api/resources/assignments/route.ts")).toMatch(/boardSafeResource\(r, access\.ctx\.actor\.isOrgAdmin\)/);
  });
});

describe("the employee portal uses the same menu", () => {
  const portal = (caps: ResourceCaps, person = true) => portalNavFor(caps, person);
  it("a plain employee gets the same groups and labels as the app, on portal pages", () => {
    const p = portal(self);
    expect(p.map((s) => s.label)).toEqual(["", "Operations", "My Pulse", "Insights"]);
    expect(p.flatMap((s) => s.items.map((i) => i.label))).toEqual(["Dashboard", "My Timesheet", "Notifications", "My Details", "My Reports"]);
    expect(p.flatMap((s) => s.items.map((i) => i.href))).toEqual(["/my-time/dashboard", "/my-time", "/my-time/notifications", "/my-time/details", "/my-time/reports"]);
  });
  it("a lead's portal adds approval and team reports, and never a page the portal does not have", () => {
    const h = portal(lead).flatMap((s) => s.items.map((i) => i.href));
    expect(h).toContain("/my-time/approvals");
    expect(h).toContain("/my-time/team");
    for (const x of h) expect(x.startsWith("/my-time")).toBe(true);
  });
  it("every portal link has a portal page", () => {
    for (const i of portal(admin).flatMap((s) => s.items)) {
      const page = i.href === "/my-time" ? "app/(portal)/my-time/page.tsx" : `app/(portal)${i.href}/page.tsx`;
      expect(existsSync(join(root, page)), i.href).toBe(true);
    }
  });
  it("hides My Details for a login with no person record", () => {
    expect(portal(self, false).flatMap((s) => s.items.map((i) => i.href))).not.toContain("/my-time/details");
  });
  it("the portal shell renders from the shared definition, not its own tab list", () => {
    const shell = src("app/(portal)/my-time/layout.tsx");
    expect(shell).toMatch(/portalNavFor\(/);
    expect(shell).not.toMatch(/const tabs = \[/);
  });
});
