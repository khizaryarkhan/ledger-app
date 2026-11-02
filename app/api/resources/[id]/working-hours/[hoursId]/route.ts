/**
 * DELETE /api/resources/[id]/working-hours/[hoursId] -> remove one dated row.
 *
 * Admin-only, like every other edit to a resource. Both the org AND the
 * resource are in the WHERE clause, so a row id from another person or another
 * tenant deletes nothing rather than being checked after the fact.
 *
 * There is no PATCH: a contracted period is a statement about a span of time,
 * and silently editing one in place would restate history — the very thing
 * these rows exist to prevent. Close the old row and add the new one.
 */

import { db } from "@/db";
import { resourceWorkingHours } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { and, eq } from "drizzle-orm";

export async function DELETE(_req: Request, { params }: { params: { id: string; hoursId: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  if (!isAdminRole(role)) return bad("Admins only", 403);

  const removed = await db.delete(resourceWorkingHours).where(and(
    eq(resourceWorkingHours.id, params.hoursId),
    eq(resourceWorkingHours.orgId, orgId!),
    eq(resourceWorkingHours.resourceId, params.id),
  )).returning({ id: resourceWorkingHours.id });
  if (removed.length === 0) return bad("Working hours not found", 404);
  return ok({ ok: true });
}
