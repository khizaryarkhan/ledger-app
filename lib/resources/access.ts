/**
 * Who may see, enter and approve whose time — the pure rules.
 *
 * Modelled on Dynamics 365 Project Operations: a resource has a line manager
 * (its "resource manager"), a designation (its role), and approvers come from
 * that chain, with an org-wide approver who can act across everyone. Here the
 * designation carries an `accessLevel`:
 *   self = own timesheet and reports only
 *   team = self + everyone reporting to them, directly or indirectly
 *   all  = every person in the organisation
 * An organisation admin (company_admin / super_admin / platform_admin) is
 * always `all`, whatever their designation.
 *
 * Client-safe: no `db` import. The lookup that builds an `Actor` from a
 * session lives in access-server.ts.
 */

export type AccessLevel = "none" | "self" | "team" | "department" | "all";
export type DesignationLevel = "self" | "team" | "department" | "all";

/** Widest last. A level includes everything the ones before it include. */
export const DESIGNATION_LEVELS: DesignationLevel[] = ["self", "team", "department", "all"];

export interface PersonNode {
  id: string;
  managerId: string | null;
  /** Phase E. Optional so every existing construction still type-checks. */
  department?: string | null;
}

export interface Actor {
  /** The caller's own people-resource, or null when none is linked to their login. */
  resourceId: string | null;
  level: AccessLevel;
  isOrgAdmin: boolean;
  /** The actor's own department, for the `department` tier. */
  department?: string | null;
  /**
   * People the actor can see because they LEAD a project those people work
   * on (Phase E). Additive on top of whatever the designation grants, for the
   * same reason leading a project grants approval in Phase A: it is a real
   * responsibility, not a rank, and it does not fit on a linear scale.
   */
  ledPeopleIds?: ReadonlySet<string>;
}

const ADMIN_ROLES = new Set(["company_admin", "super_admin", "platform_admin"]);

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.has(role);
}

export function normaliseDesignationLevel(v: unknown): DesignationLevel {
  return v === "team" || v === "department" || v === "all" ? v : "self";
}

/**
 * The caller's access level. An admin is `all`. Anyone else needs a linked
 * resource: without one they are `none` — a login that belongs to nobody
 * cannot be given anyone's hours.
 */
export function actorLevel(
  orgRole: string | null | undefined,
  linkedResourceId: string | null,
  designationLevel: unknown,
): AccessLevel {
  if (isAdminRole(orgRole)) return "all";
  if (!linkedResourceId) return "none";
  return normaliseDesignationLevel(designationLevel);
}

export function buildActor(
  orgRole: string | null | undefined,
  linkedResourceId: string | null,
  designationLevel: unknown,
  extra: { department?: string | null; ledPeopleIds?: ReadonlySet<string> } = {},
): Actor {
  return {
    resourceId: linkedResourceId,
    level: actorLevel(orgRole, linkedResourceId, designationLevel),
    isOrgAdmin: isAdminRole(orgRole),
    department: extra.department ?? null,
    ledPeopleIds: extra.ledPeopleIds,
  };
}

/** Everyone who reports to `rootId`, directly or indirectly. Excludes the root. Cycle-safe. */
export function reportIds(rootId: string, nodes: readonly PersonNode[]): Set<string> {
  const byManager = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.managerId) continue;
    const list = byManager.get(n.managerId);
    if (list) list.push(n.id); else byManager.set(n.managerId, [n.id]);
  }
  const out = new Set<string>();
  const queue = [rootId];
  while (queue.length) {
    const cur = queue.pop() as string;
    for (const child of byManager.get(cur) ?? []) {
      if (child === rootId || out.has(child)) continue;
      out.add(child);
      queue.push(child);
    }
  }
  return out;
}

/** The line-manager chain above `id`, nearest first. Cycle-safe. */
export function managerChain(id: string, nodes: readonly PersonNode[]): string[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const chain: string[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.managerId ?? null;
  while (cur && !seen.has(cur)) {
    chain.push(cur);
    seen.add(cur);
    cur = byId.get(cur)?.managerId ?? null;
  }
  return chain;
}

/** True when making `newManagerId` the manager of `resourceId` would close a loop. */
export function wouldCreateCycle(resourceId: string, newManagerId: string | null, nodes: readonly PersonNode[]): boolean {
  if (!newManagerId) return false;
  if (newManagerId === resourceId) return true;
  return reportIds(resourceId, nodes).has(newManagerId);
}

/**
 * The resource ids the actor may see: `"all"`, or an explicit set.
 *
 * The set is a UNION of every reason they have to see someone, not a position
 * on a scale. The designation gives a linear tier — self, then their reports,
 * then their department — and leading a project adds the people on it
 * whatever that tier says. Trying to order those two against each other would
 * be inventing a hierarchy that does not exist: a lead's project team and
 * their own reports are different sets, and neither contains the other.
 */
export function visibleResourceIds(actor: Actor, nodes: readonly PersonNode[]): Set<string> | "all" {
  if (actor.level === "all") return "all";
  if (actor.level === "none" || !actor.resourceId) return new Set();

  const seen = new Set<string>([actor.resourceId]);

  if (actor.level === "team" || actor.level === "department") {
    for (const id of reportIds(actor.resourceId, nodes)) seen.add(id);
  }
  if (actor.level === "department" && actor.department) {
    for (const n of nodes) if (n.department && n.department === actor.department) seen.add(n.id);
  }
  // Additive at every tier, including `self`.
  for (const id of actor.ledPeopleIds ?? []) seen.add(id);

  return seen;
}

/**
 * What this page is showing, in the viewer's own terms.
 *
 * A narrowed page must never read as the whole organisation, and a tier that
 * resolves to nothing still says what it tried to show — "your department (no
 * department is set on your record)" beats a page that is empty for no
 * apparent reason.
 */
export function scopeLabel(actor: Actor): string {
  const led = (actor.ledPeopleIds?.size ?? 0) > 0 ? ", plus the projects you lead" : "";
  if (actor.level === "all") return "everyone in the organisation";
  if (actor.level === "none" || !actor.resourceId) return "nobody — your login is not linked to a person";
  if (actor.level === "department") {
    return actor.department
      ? `your department, ${actor.department}${led}`
      : `your department (none is set on your record, so only you and your team resolve)${led}`;
  }
  if (actor.level === "team") return `you and everyone who reports to you${led}`;
  return led ? `you, plus the projects you lead` : "just you";
}

export function canView(actor: Actor, targetId: string, nodes: readonly PersonNode[]): boolean {
  const v = visibleResourceIds(actor, nodes);
  return v === "all" || v.has(targetId);
}

/** Log or edit time for `targetId`: your own, or anyone's if you are an org admin. */
export function canEnterTimeFor(actor: Actor, targetId: string): boolean {
  if (actor.isOrgAdmin) return true;
  return !!actor.resourceId && actor.resourceId === targetId;
}

/**
 * Does this person have ANY time they may be asked to approve? Drives whether
 * the Approvals tab is offered. Must agree with `canApproveEntry`: a project
 * lead approves their project's time at any tier, and a `department` person
 * approves their own reporting chain — both used to be missing, so a lead's
 * queue had entries routed to it that the lead could not open.
 */
export function mayApproveAnyone(actor: Actor, nodes: readonly PersonNode[]): boolean {
  if (actor.isOrgAdmin || actor.level === "all" || actor.level === "team") return true;
  if ((actor.ledPeopleIds?.size ?? 0) > 0) return true;
  if (actor.level === "department" && actor.resourceId) return reportIds(actor.resourceId, nodes).size > 0;
  return false;
}

/**
 * Approve or reject `targetId`'s time. Never your own (unless you are an org
 * admin, who has no one above them to ask). `team` approves for the people
 * under them; `all` approves for anyone.
 */
export function canApprove(actor: Actor, targetId: string, nodes: readonly PersonNode[]): boolean {
  if (actor.isOrgAdmin) return true;
  if (actor.level === "none" || actor.level === "self") return false;
  if (!actor.resourceId || actor.resourceId === targetId) return false;
  if (actor.level === "all") return true;
  // `department` deliberately falls through to the management chain: seeing a
  // colleague's hours and being able to approve them are different rights,
  // and a department-wide view must not quietly hand someone authority over
  // people who do not report to them.
  return reportIds(actor.resourceId, nodes).has(targetId);
}

/**
 * Open Project / Employee reports for other people: team and above, or anyone
 * who leads a project — a lead needs the reports for the work they are
 * accountable for, whatever their designation says.
 */
export function canOpenTeamReports(actor: Actor): boolean {
  if ((actor.ledPeopleIds?.size ?? 0) > 0) return true;
  return actor.level === "team" || actor.level === "department" || actor.level === "all";
}

// ── Who approves THIS entry (Phase A, 2026-11-02) ────────────────────────────

export interface ApprovableEntry {
  resourceId: string;
  assignableType: string | null;
  assignableId: string | null;
}

/**
 * The lead who owns this entry's approval, or null when nobody does.
 *
 * Only a project has a lead. A Manufacturing Order and a Job Work Order are
 * work the floor runs, not an engagement somebody is accountable for, so they
 * fall to the line manager — as does a project whose lead is unset, or set to
 * a person who is no longer active.
 */
export function leadForEntry(
  entry: Pick<ApprovableEntry, "assignableType" | "assignableId">,
  leadOfProject: ReadonlyMap<string, string>,
): string | null {
  if (entry.assignableType !== "project" || !entry.assignableId) return null;
  return leadOfProject.get(entry.assignableId) ?? null;
}

/**
 * Approve or reject one entry. The rule, in order:
 *
 *   an org admin always may (nobody sits above them to ask);
 *   never your own, otherwise;
 *   an `all` designation is the org-wide approver and may act on anything;
 *   time on a project WITH a lead is that lead's to decide, and only theirs —
 *     a line manager does not approve work they are not accountable for;
 *   everything else (no project, or no lead named) is the line manager's,
 *     exactly as it was before this rule existed.
 *
 * That last clause is what makes this safe to ship: `projects.leadResourceId`
 * starts null everywhere, so until an org names a lead nothing moves.
 */
export function canApproveEntry(
  actor: Actor,
  entry: ApprovableEntry,
  people: readonly PersonNode[],
  leadOfProject: ReadonlyMap<string, string>,
): boolean {
  if (actor.isOrgAdmin) return true;
  if (actor.level === "none" || !actor.resourceId) return false;
  if (actor.resourceId === entry.resourceId) return false;
  if (actor.level === "all") return true;
  const lead = leadForEntry(entry, leadOfProject);
  // Being named a project's lead IS the grant, whatever the designation says.
  // Requiring `team` on top would mean naming a lead did nothing until someone
  // also changed their designation — two unrelated settings, one of them
  // silently load-bearing.
  if (lead) return actor.resourceId === lead;
  if (actor.level === "self") return false;
  return canApprove(actor, entry.resourceId, people);
}
