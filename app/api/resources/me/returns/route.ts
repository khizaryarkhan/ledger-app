/**
 * GET /api/resources/me/returns -> the caller's OWN returned time, newest first.
 *
 * The resource is resolved from the session, never from the request, so this
 * can only ever answer with the caller's own thread.
 */

import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx } from "@/lib/resources/time-entries-server";
import { returnsFor } from "@/lib/resources/approval-server";

export async function GET() {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  if (!ctx.actor.resourceId) return ok([]);
  return ok(await returnsFor(orgId!, ctx.actor.resourceId));
}
