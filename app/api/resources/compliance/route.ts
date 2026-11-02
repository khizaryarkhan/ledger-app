/**
 * GET /api/resources/compliance?endDate=&weeks=
 *   -> { weeks, rows, dormant, clear }: who has not handed a week in, and
 *      whose handed-in week is still waiting for a decision.
 *
 * Team and above, scoped to the people the caller may already see — the same
 * gate and the same scope as the Project and Employee reports, so this cannot
 * become a side door onto someone else's team.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { canOpenTeamReports, visibleResourceIds } from "@/lib/resources/access";
import { resolveActor } from "@/lib/resources/access-server";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { loadCompliance, DEFAULT_WEEKS, MAX_WEEKS } from "@/lib/resources/compliance-server";
import { localToday } from "@/lib/format";

export async function GET(req: Request) {
  const { error, orgId, session, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { actor, people } = await resolveActor(orgId!, (session as any)?.user?.id ?? null, role);
  if (!canOpenTeamReports(actor) && !actor.isOrgAdmin) {
    return bad("You do not have access to team reports", 403);
  }

  const { searchParams } = new URL(req.url);
  const endDate = searchParams.get("endDate") || localToday();
  if (!isRealDate(endDate)) return bad("endDate must be a real date (YYYY-MM-DD)");
  const weeksRaw = Number(searchParams.get("weeks") ?? DEFAULT_WEEKS);
  if (!Number.isFinite(weeksRaw) || weeksRaw < 1) return bad("weeks must be a positive number");
  if (weeksRaw > MAX_WEEKS) return bad(`weeks cannot exceed ${MAX_WEEKS}`);

  const visible = visibleResourceIds(actor, people);
  return ok(await loadCompliance(orgId!, visible, endDate, Math.floor(weeksRaw)));
}
