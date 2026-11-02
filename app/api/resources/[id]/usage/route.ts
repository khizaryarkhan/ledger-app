/**
 * GET /api/resources/[id]/usage?from=&to=
 *   -> { linked, workCentre, from, to, usage, firm }
 *
 * Hours a machine was used, read from completion runs through its linked work
 * centre. `linked: false` for a machine with no work centre, which is not the
 * same fact as zero hours.
 *
 * Open to anyone who may already see the Resources module: this is hours, not
 * cost, and it carries no pay rate.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { loadMachineUsage } from "@/lib/resources/machine-server";
import { addDays } from "@/lib/accounting/report-periods";
import { localToday } from "@/lib/format";

/** An unbounded range would read every run ever recorded. */
const MAX_SPAN_DAYS = 366;
const DEFAULT_SPAN_DAYS = 30;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const to = searchParams.get("to") || localToday();
  const from = searchParams.get("from") || addDays(to, -(DEFAULT_SPAN_DAYS - 1));
  if (!isRealDate(from) || !isRealDate(to)) return bad("from and to must be real dates (YYYY-MM-DD)");
  if (from > to) return bad("from cannot be after to");
  if (addDays(from, MAX_SPAN_DAYS) < to) return bad(`The range cannot exceed ${MAX_SPAN_DAYS} days`);

  return ok(await loadMachineUsage(orgId!, params.id, from, to));
}
