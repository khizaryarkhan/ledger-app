/** GET /api/resources/me/options: active timesheet types + assignable choices (ids and names only). */

import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { timeOptions } from "@/lib/resources/time-entries-server";

export async function GET() {
  const { error, orgId } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  return ok(await timeOptions(orgId!));
}
