/** DELETE /api/resources/holiday-calendars/:id/dates/:dateId */

import { db } from "@/db";
import { publicHolidays } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { isAdminRole } from "@/lib/resources/access";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

export async function DELETE(_req: Request, { params }: { params: { id: string; dateId: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  // Types carry GL accounts and leave policy; calendars set everyone's capacity. Admin only.
  if (!isAdminRole(role)) return bad("Only organisation admins can change this", 403);
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: publicHolidays.id }).from(publicHolidays)
    .where(and(eq(publicHolidays.id, params.dateId), eq(publicHolidays.calendarId, params.id), eq(publicHolidays.orgId, orgId!))).limit(1);
  if (!existing) return bad("Holiday date not found", 404);

  await db.delete(publicHolidays).where(eq(publicHolidays.id, params.dateId));
  return ok({ ok: true });
}
