/**
 * GET  /api/resources/me/copy-week?weekStart=YYYY-MM-DD&back=1..4 -> the lines an earlier week offers
 * POST /api/resources/me/copy-week { weekStart, back, rows: string[] } -> copy the ticked lines in as Drafts
 *
 * The caller's own time only. Leave, retired types and returned lines never copy.
 */

import { requireOrg } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, respond } from "@/lib/resources/time-entries-server";
import { copyWeekRows, copyWeek } from "@/lib/resources/timesheet-lines-server";

export async function GET(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const sp = new URL(req.url).searchParams;
  const ctx = await buildCtx(orgId!, session, role);
  return respond(await copyWeekRows(ctx, sp.get("weekStart"), sp.get("back")));
}

export async function POST(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const ctx = await buildCtx(orgId!, session, role);
  return respond(await copyWeek(ctx, body ?? {}));
}
