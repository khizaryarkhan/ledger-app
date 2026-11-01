/**
 * GET /api/resources/me: who the caller is to the timesheet — their person,
 * level and what they may open. A login with no linked person gets resource:null.
 */

import { db } from "@/db";
import { organisations, resources } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx } from "@/lib/resources/time-entries-server";
import { canOpenTeamReports } from "@/lib/resources/access";

export async function GET() {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName })
    .from(organisations).where(eq(organisations.id, orgId!)).limit(1);

  let resource: Record<string, unknown> | null = null;
  if (ctx.me) {
    const [r] = await db.select({ c: resources.dailyCapacity }).from(resources)
      .where(and(eq(resources.id, ctx.me.id), eq(resources.orgId, orgId!))).limit(1);
    const manager = ctx.me.managerId ? ctx.people.find((p) => p.id === ctx.me!.managerId) : null;
    resource = {
      id: ctx.me.id,
      name: ctx.me.name,
      designationName: ctx.me.designationName,
      accessLevel: ctx.me.accessLevel,
      managerName: manager?.name ?? null,
      dailyCapacity: Number(r?.c ?? 8),
      department: ctx.me.department,
    };
  }

  const { actor } = ctx;
  return ok({
    resource,
    level: actor.level,
    isOrgAdmin: actor.isOrgAdmin,
    canApprove: actor.isOrgAdmin || actor.level === "team" || actor.level === "all",
    canTeamReports: canOpenTeamReports(actor),
    orgName: org?.displayName || org?.name || "",
  });
}
