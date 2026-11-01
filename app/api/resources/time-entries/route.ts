/**
 * GET  /api/resources/time-entries   -> list (?resourceId=&status=&from=&to=), only people the caller may see
 * POST /api/resources/time-entries   -> log time (Draft), only for yourself unless you are an org admin
 *
 * All rules live in lib/resources/time-entries-server.ts, shared with /api/resources/me/**.
 */

import { requireOrg, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, listEntries, createEntry, respond } from "@/lib/resources/time-entries-server";

export async function GET(req: Request) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const sp = new URL(req.url).searchParams;
  const res = await listEntries(ctx, {
    resourceId: sp.get("resourceId"), status: sp.get("status"), from: sp.get("from"), to: sp.get("to"),
  });
  return respond(res);
}

export async function POST(req: Request) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const body = await req.json().catch(() => ({}));
  const res = await createEntry(ctx, body ?? {});
  return respond(res);
}
