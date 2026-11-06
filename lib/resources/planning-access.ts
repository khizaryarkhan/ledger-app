/**
 * Who may read and change the Resource Planning board — the server half of the
 * menu's "team" capability (lib/resources/nav.ts), so the link and the page
 * cannot disagree. Generic on purpose: it reads the organisation's own
 * designations, custom roles and project leads through resolveActor, never a
 * job title.
 *
 * - The board (and booking anyone) needs the "team" capability: a team,
 *   department or org-wide scope, leading a project, or org admin.
 * - People are limited to those the viewer may see; equipment is not a person
 *   and is visible to anyone who may plan.
 */

import { buildCtx, type TimeCtx } from "./time-entries-server";
import { canOpenTeamReports, visibleResourceIds } from "./access";

export interface PlanningAccess {
  ctx: TimeCtx;
  allowed: boolean;
  visible: ReadonlySet<string> | "all";
}

export async function planningAccess(orgId: string, session: any, role: string | null | undefined): Promise<PlanningAccess> {
  const ctx = await buildCtx(orgId, session, role);
  const allowed = ctx.actor.isOrgAdmin || canOpenTeamReports(ctx.actor);
  return { ctx, allowed, visible: visibleResourceIds(ctx.actor, ctx.people) };
}

/** May this viewer see / book this resource on the board? */
export function canPlanResource(access: PlanningAccess, resource: { id: string; type: string }): boolean {
  if (!access.allowed) return false;
  if (resource.type !== "person") return true;
  return access.visible === "all" || access.visible.has(resource.id);
}

/** A resource row as the board may show it: no login id, and no pay rate unless an org admin. */
export function boardSafeResource<T extends Record<string, unknown>>(row: T, isOrgAdmin: boolean): Omit<T, "userId"> {
  const { userId: _login, costRatePerHour, ...rest } = row as any;
  return (isOrgAdmin ? { ...rest, costRatePerHour } : rest) as Omit<T, "userId">;
}
