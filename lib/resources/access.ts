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

export type AccessLevel = "none" | "self" | "team" | "all";
export type DesignationLevel = "self" | "team" | "all";

export interface PersonNode {
  id: string;
  managerId: string | null;
}

export interface Actor {
  /** The caller's own people-resource, or null when none is linked to their login. */
  resourceId: string | null;
  level: AccessLevel;
  isOrgAdmin: boolean;
}

const ADMIN_ROLES = new Set(["company_admin", "super_admin", "platform_admin"]);

export function isAdminRole(role: string | null | undefined): boolean {
  return !!role && ADMIN_ROLES.has(role);
}

export function normaliseDesignationLevel(v: unknown): DesignationLevel {
  return v === "team" || v === "all" ? v : "self";
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
): Actor {
  return {
    resourceId: linkedResourceId,
    level: actorLevel(orgRole, linkedResourceId, designationLevel),
    isOrgAdmin: isAdminRole(orgRole),
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

/** The resource ids the actor may see: `"all"`, or an explicit set (possibly empty). */
export function visibleResourceIds(actor: Actor, nodes: readonly PersonNode[]): Set<string> | "all" {
  if (actor.level === "all") return "all";
  if (actor.level === "none" || !actor.resourceId) return new Set();
  const own = new Set<string>([actor.resourceId]);
  if (actor.level === "self") return own;
  for (const id of reportIds(actor.resourceId, nodes)) own.add(id);
  return own;
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
 * Approve or reject `targetId`'s time. Never your own (unless you are an org
 * admin, who has no one above them to ask). `team` approves for the people
 * under them; `all` approves for anyone.
 */
export function canApprove(actor: Actor, targetId: string, nodes: readonly PersonNode[]): boolean {
  if (actor.isOrgAdmin) return true;
  if (actor.level === "none" || actor.level === "self") return false;
  if (!actor.resourceId || actor.resourceId === targetId) return false;
  if (actor.level === "all") return true;
  return reportIds(actor.resourceId, nodes).has(targetId);
}

/** Open Project / Employee reports for other people: team and above. */
export function canOpenTeamReports(actor: Actor): boolean {
  return actor.level === "team" || actor.level === "all";
}
