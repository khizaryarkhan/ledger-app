/**
 * GET /api/resources/machines/report?from=&to=
 *   -> { from, to, machines[], unlinked[] }
 *
 * Utilisation, downtime and (admins only) running cost beside depreciation for
 * every active machine linked to a work centre. Hours are derived from completed
 * manufacturing runs; available hours come only from dated working-hours rows,
 * and a utilisation figure is withheld when they do not cover the whole window.
 *
 * Open to anyone who may see the Resources module (employee logins are refused
 * by requireOrg). The `cost` block is organisation admins only: it carries the
 * work centre's labour rate and the asset's book value.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { planningAccess } from "@/lib/resources/planning-access";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { loadMachineReport } from "@/lib/resources/machine-report-server";
import { addDays } from "@/lib/accounting/report-periods";
import { localToday } from "@/lib/format";

/** The report walks every day of the window per machine. */
const MAX_SPAN_DAYS = 366;
const DEFAULT_SPAN_DAYS = 30;

export async function GET(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const q = new URL(req.url).searchParams;
  const to = q.get("to") || localToday();
  const from = q.get("from") || addDays(to, -(DEFAULT_SPAN_DAYS - 1));
  if (!isRealDate(from) || !isRealDate(to)) return bad("from and to must be real dates (YYYY-MM-DD)");
  if (from > to) return bad("from cannot be after to");
  if (addDays(from, MAX_SPAN_DAYS) < to) return bad(`The range cannot exceed ${MAX_SPAN_DAYS} days`);

  // Same "team" capability as the menu link (lib/resources/nav.ts).
  if (!(await planningAccess(orgId!, session, role)).allowed) return bad("Machine utilisation is for people who manage a team, a department or a project", 403);
  return ok(await loadMachineReport(orgId!, from, to, isAdminRole(role)));
}
