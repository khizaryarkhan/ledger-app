/** POST /api/resources/me/submit-week { weekStart: "YYYY-MM-DD" }: submit your Draft/Rejected entries for that Monday-Sunday week. */

import { requireOrg, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { buildCtx, submitWeek, respond } from "@/lib/resources/time-entries-server";

export async function POST(req: Request) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const ctx = await buildCtx(orgId!, session, role);
  const body = await req.json().catch(() => ({}));
  const res = await submitWeek(ctx, body?.weekStart);
  return respond(res);
}
