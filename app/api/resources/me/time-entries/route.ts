/**
 * GET  /api/resources/me/time-entries?from=&to=[&resourceId=]  -> own entries (another person's only if you may view them)
 * POST /api/resources/me/time-entries                          -> log time for yourself
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, listEntries, createEntry, respond } from "@/lib/resources/time-entries-server";

export async function GET(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const sp = new URL(req.url).searchParams;
  const resourceId = sp.get("resourceId") || ctx.actor.resourceId;
  if (!resourceId) return ok([]);
  const res = await listEntries(ctx, { resourceId, from: sp.get("from"), to: sp.get("to"), status: sp.get("status") });
  return respond(res);
}

export async function POST(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  if (!ctx.actor.resourceId) return bad("Your login is not linked to a person yet. Ask an admin.", 403);
  const body = await req.json().catch(() => ({}));
  const res = await createEntry(ctx, { ...(body ?? {}), resourceId: ctx.actor.resourceId });
  return respond(res);
}
