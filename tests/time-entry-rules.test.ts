import { describe, it, expect } from "vitest";
import {
  isRealDate, weekdayIndex, weekStartOf, weekDates, isEditableStatus, isSubmittableStatus,
  isDecidableStatus, parseHours, exceedsDay, parseReason, decideEntry,
} from "@/lib/resources/time-entry-rules";
import { buildActor, mayApproveAnyone, type PersonNode } from "@/lib/resources/access";

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
    // Rounds before the zero check: 0.004 would otherwise be stored as a 0.00h entry.
    expect(parseHours(0.004).ok).toBe(false);
    expect(parseHours(0.005)).toEqual({ ok: true, hours: 0.01 });
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
  const entry = (resourceId: string, status = "submitted") =>
    ({ resourceId, status, assignableType: null, assignableId: null });
  /** No project anywhere has a named lead — every org on the day this shipped. */
  const NO_LEADS = new Map<string, string>();

  it("lets a manager approve down the chain, not sideways or up", () => {
    const lead = buildActor("company_user", "lead", "team");
    expect(decideEntry(lead, entry("dev"), people, NO_LEADS).ok).toBe(true);
    expect(decideEntry(lead, entry("peer"), people, NO_LEADS).ok).toBe(false);
    expect(decideEntry(lead, entry("boss"), people, NO_LEADS).ok).toBe(false);
  });
  it("never lets a non-admin approve their own time", () => {
    const boss = buildActor("company_user", "boss", "all");
    const d = decideEntry(boss, entry("boss"), people, NO_LEADS);
    expect(d.ok).toBe(false);
    if ("error" in d) expect(d.status).toBe(403);
  });
  it("lets an org-wide approver act for anyone else", () => {
    const hr = buildActor("company_user", "peer", "all");
    expect(decideEntry(hr, entry("dev"), people, NO_LEADS).ok).toBe(true);
  });
  it("refuses self-level people and logins with no person", () => {
    expect(decideEntry(buildActor("company_user", "dev", "self"), entry("lead"), people, NO_LEADS).ok).toBe(false);
    expect(decideEntry(buildActor("company_user", null, "all"), entry("dev"), people, NO_LEADS).ok).toBe(false);
  });
  it("lets an org admin decide anything submitted, including their own", () => {
    const admin = buildActor("company_admin", "boss", "self");
    expect(decideEntry(admin, entry("boss"), people, NO_LEADS).ok).toBe(true);
    expect(decideEntry(admin, entry("dev"), people, NO_LEADS).ok).toBe(true);
  });
  it("treats approved and posted as immutable", () => {
    const admin = buildActor("company_admin", null, null);
    for (const s of ["approved", "posted", "draft", "rejected"]) {
      const d = decideEntry(admin, entry("dev", s), people, NO_LEADS);
      expect(d.ok).toBe(false);
      if ("error" in d) expect(d.status).toBe(409);
    }
  });
});

/**
 * Phase A: time booked to a project is the project lead's to approve.
 *
 * "peer" leads project P and manages nobody; "lead" manages "dev" but does not
 * lead P. That pair is the whole point of the change — before it, `lead`
 * approved everything `dev` logged and `peer` approved nothing.
 */
describe("approval follows the project's lead", () => {
  const P = "project-p";
  const LEADS = new Map<string, string>([[P, "peer"]]);
  const onProject = (resourceId: string, projectId = P, status = "submitted") =>
    ({ resourceId, status, assignableType: "project", assignableId: projectId });
  const noBooking = (resourceId: string) =>
    ({ resourceId, status: "submitted", assignableType: null, assignableId: null });

  it("gives the project's time to its lead, not to the line manager", () => {
    const projectLead = buildActor("company_user", "peer", "self");
    const lineManager = buildActor("company_user", "lead", "team");
    expect(decideEntry(projectLead, onProject("dev"), people, LEADS).ok).toBe(true);
    expect(decideEntry(lineManager, onProject("dev"), people, LEADS).ok).toBe(false);
  });

  it("says WHICH rule refused, so the manager knows where to go", () => {
    const d = decideEntry(buildActor("company_user", "lead", "team"), onProject("dev"), people, LEADS);
    if ("error" in d) expect(d.error).toContain("project's lead");
    else throw new Error("expected a refusal");
  });

  it("leaves non-project time with the line manager", () => {
    const lineManager = buildActor("company_user", "lead", "team");
    expect(decideEntry(lineManager, noBooking("dev"), people, LEADS).ok).toBe(true);
  });

  it("falls back to the line manager for a project with no lead named", () => {
    const lineManager = buildActor("company_user", "lead", "team");
    expect(decideEntry(lineManager, onProject("dev", "unled-project"), people, LEADS).ok).toBe(true);
  });

  it("leaves an MO and a job work order with the line manager", () => {
    const lineManager = buildActor("company_user", "lead", "team");
    for (const t of ["manufacturing_order", "job_work_order"]) {
      const e = { resourceId: "dev", status: "submitted", assignableType: t, assignableId: P };
      expect(decideEntry(lineManager, e, people, LEADS).ok).toBe(true);
    }
  });

  it("lets a lead approve whatever their designation says, but never their own", () => {
    const projectLead = buildActor("company_user", "peer", "self");
    expect(decideEntry(projectLead, onProject("dev"), people, LEADS).ok).toBe(true);
    expect(decideEntry(projectLead, onProject("peer"), people, LEADS).ok).toBe(false);
  });

  it("keeps the org-wide approver and the org admin able to act", () => {
    expect(decideEntry(buildActor("company_user", "boss", "all"), onProject("dev"), people, LEADS).ok).toBe(true);
    expect(decideEntry(buildActor("company_admin", "boss", "self"), onProject("dev"), people, LEADS).ok).toBe(true);
  });

  it("changes nothing while no org has named a lead", () => {
    const lineManager = buildActor("company_user", "lead", "team");
    const empty = new Map<string, string>();
    expect(decideEntry(lineManager, onProject("dev"), people, empty).ok).toBe(true);
  });
});

describe("mayApproveAnyone (drives the Approvals tab)", () => {
  it("offers approvals to a project lead at any tier", () => {
    const a = buildActor("company_user", "dev", "self", { ledPeopleIds: new Set(["peer"]) });
    expect(mayApproveAnyone(a, people)).toBe(true);
  });
  it("offers approvals to a department person who has reports", () => {
    expect(mayApproveAnyone(buildActor("company_user", "lead", "department"), people)).toBe(true);
    expect(mayApproveAnyone(buildActor("company_user", "dev", "department"), people)).toBe(false);
  });
  it("does not offer it to a plain self user", () => {
    expect(mayApproveAnyone(buildActor("company_user", "dev", "self"), people)).toBe(false);
  });
});
