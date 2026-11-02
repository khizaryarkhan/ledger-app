/**
 * GET /api/resources/[id]/downtime?from=
 *   -> { linked, workCentre, from, upcoming, happened, plannedMinutes, unplannedMinutes }
 *
 * A machine's stoppages since `from` (default 30 days ago) and the maintenance
 * windows booked ahead, read from the downtime recorded against its linked work
 * centre. Booking or logging one is the existing POST /api/production/downtime.
 * `linked: false` for a machine with no work centre.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { loadMachineDowntime } from "@/lib/resources/machine-server";
import { addDays } from "@/lib/accounting/report-periods";
import { localToday } from "@/lib/format";

const MAX_SPAN_DAYS = 366;
const DEFAULT_SPAN_DAYS = 30;

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const today = localToday();
  const from = new URL(req.url).searchParams.get("from") || addDays(today, -DEFAULT_SPAN_DAYS);
  if (!isRealDate(from)) return bad("from must be a real date (YYYY-MM-DD)");
  if (addDays(from, MAX_SPAN_DAYS) < today) return bad(`from cannot be more than ${MAX_SPAN_DAYS} days ago`);

  return ok(await loadMachineDowntime(orgId!, params.id, from));
}
