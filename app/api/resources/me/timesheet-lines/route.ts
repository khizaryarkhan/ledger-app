/**
 * POST /api/resources/me/timesheet-lines { action: "submit"|"recall"|"delete", ids: string[] }
 *
 * The weekly grid's bulk actions over the ticked lines. Only the caller's own
 * entries are ever touched; each action takes only the entries in a status it
 * applies to and counts the rest as skipped, so a mixed selection is safe.
 */

import { requireOrg, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, respond } from "@/lib/resources/time-entries-server";
import { applyLineAction } from "@/lib/resources/timesheet-lines-server";
import { isLineAction } from "@/lib/resources/timesheet-lines";

export async function POST(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  if (!isLineAction(body?.action)) return bad("action must be submit, recall or delete");
  const ctx = await buildCtx(orgId!, session, role);
  return respond(await applyLineAction(ctx, body.action, body?.ids));
}
