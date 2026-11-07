/**
 * The Resources menu, as data — pure, client-safe.
 *
 * Every link names the CAPABILITY its page enforces, never a role. Capabilities
 * come from whatever the organisation has set up — its own designations
 * (self/team/department/all), its own custom roles (Settings → Roles), who it
 * has named as a project's lead, and which modules it has bought — so the same
 * menu fits a five-person workshop and a multi-office engineering firm without
 * a single organisation's job titles being written into the product.
 *
 * Rules (pinned in tests/resource-nav.test.ts):
 * - A heading with no visible link disappears entirely.
 * - A link is shown only to someone its page will actually serve; the page
 *   still enforces the same rule server-side — hiding is never the control.
 * - Capabilities widen the menu, never narrow it: anyone who can approve can
 *   also see their own things.
 */

import { portalHref } from "@/lib/notifications/rules";

export type ResourceCapability =
  /** Everyone with Resources: their own dashboard, timesheet, reports, details. */
  | "self"
  /** May approve someone's time: a manager with reports, a project lead, an org-wide approver. */
  | "approve"
  /** May read beyond themselves: team, department, org-wide, or a project they lead. */
  | "team"
  /** Organisation admin: setup, posting to the ledger, labour cost (cost ÷ hours = pay). */
  | "admin";

export interface ResourceCaps {
  approve: boolean;
  team: boolean;
  admin: boolean;
  /** Modules the organisation has (and the viewer's role allows). */
  modules: readonly string[];
}

export type ResourceNavIcon =
  | "dashboard" | "notifications" | "reports" | "details" | "timesheet" | "approve" | "compliance"
  | "enquiry" | "post" | "planning" | "utilisation" | "team" | "cost"
  | "equipment" | "machine" | "people" | "designation" | "types" | "leave"
  | "calendar" | "payroll";

export interface ResourceNavItem {
  href: string;
  label: string;
  icon: ResourceNavIcon;
  requires: ResourceCapability;
  /** A further module the page depends on (e.g. machine usage reads production runs). */
  module?: string;
}

export interface ResourceNavSection {
  label: string;
  collapsible?: boolean;
  items: ResourceNavItem[];
}

export const RESOURCE_NAV: readonly ResourceNavSection[] = [
  {
    label: "",
    items: [
      { href: "/resources/my-dashboard", label: "Dashboard", icon: "dashboard", requires: "self" },
    ],
  },
  {
    label: "Operations",
    items: [
      { href: "/resources/my-time", label: "My Timesheet", icon: "timesheet", requires: "self" },
      { href: "/resources/approvals", label: "Timesheet Approval", icon: "approve", requires: "approve" },
      { href: "/resources/enquiries", label: "Hours Over Plan", icon: "enquiry", requires: "approve" },
      { href: "/resources/board", label: "Resource Planning", icon: "planning", requires: "team" },
      { href: "/resources/timesheets", label: "Post Timesheets", icon: "post", requires: "admin" },
    ],
  },
  {
    label: "My Pulse",
    items: [
      { href: "/resources/notifications", label: "Notifications", icon: "notifications", requires: "self" },
      { href: "/resources/my-details", label: "My Details", icon: "details", requires: "self" },
    ],
  },
  {
    label: "Machinery",
    items: [
      { href: "/resources/equipment", label: "Equipment", icon: "equipment", requires: "team" },
    ],
  },
  {
    label: "Insights",
    items: [
      { href: "/resources/my-reports", label: "My Reports", icon: "reports", requires: "self" },
      { href: "/resources/compliance", label: "Timesheet Compliance", icon: "compliance", requires: "team" },
      { href: "/resources/utilization", label: "Utilization", icon: "utilisation", requires: "team" },
      { href: "/resources/reports", label: "Team Reports", icon: "team", requires: "team" },
      { href: "/resources/cost", label: "Resource Cost", icon: "cost", requires: "admin" },
      { href: "/resources/machines", label: "Machine Utilisation", icon: "machine", requires: "team", module: "manufacturing" },
    ],
  },
  {
    label: "Setup",
    collapsible: true,
    items: [
      { href: "/resources/people", label: "People", icon: "people", requires: "admin" },
      { href: "/resources/designations", label: "Designations", icon: "designation", requires: "admin" },
      { href: "/resources/timesheet-types", label: "Timesheet Types", icon: "types", requires: "admin" },
      { href: "/resources/leave-balances", label: "Leave Balances", icon: "leave", requires: "admin" },
      { href: "/resources/holiday-calendars", label: "Holiday Calendars", icon: "calendar", requires: "admin" },
      { href: "/resources/payroll-settings", label: "Payroll Settings", icon: "payroll", requires: "admin" },
    ],
  },
];

/** Does this viewer have the capability? Admin implies everything; approve implies team-level reading of what they approve. */
export function hasCapability(caps: ResourceCaps, need: ResourceCapability): boolean {
  if (caps.admin) return true;
  switch (need) {
    case "self": return true;
    case "approve": return caps.approve;
    case "team": return caps.team;
    case "admin": return false;
  }
}

/** The menu as this viewer may see it; headings left with no links are dropped. */
export function resourceNavFor(caps: ResourceCaps): ResourceNavSection[] {
  const out: ResourceNavSection[] = [];
  for (const sec of RESOURCE_NAV) {
    const items = sec.items.filter((i) =>
      hasCapability(caps, i.requires) && (!i.module || caps.modules.includes(i.module)));
    if (items.length) out.push({ ...sec, items });
  }
  return out;
}

/** What a viewer sees before their capabilities have loaded: only their own things. */
export const SELF_ONLY_CAPS: ResourceCaps = { approve: false, team: false, admin: false, modules: [] };

/**
 * The same menu for the EMPLOYEE PORTAL (/my-time): identical groups, order
 * and labels, so a portal login sees the structure everyone else sees. Each
 * link is mapped to its portal page; a link the portal has no page for is
 * dropped (an employee login is confined to /my-time, so it would only 403),
 * and so is a heading left empty. Mapping lives in one place — `portalHref`.
 */
export function portalNavFor(caps: ResourceCaps, hasPerson = true): ResourceNavSection[] {
  const out: ResourceNavSection[] = [];
  for (const sec of resourceNavFor(caps)) {
    const items = sec.items.flatMap((i) => {
      if (i.href === "/resources/my-details" && !hasPerson) return [];
      const href = portalHref(i.href);
      return href ? [{ ...i, href }] : [];
    });
    if (items.length) out.push({ ...sec, items });
  }
  return out;
}
