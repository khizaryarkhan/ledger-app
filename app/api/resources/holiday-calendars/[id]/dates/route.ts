/**
 * GET  /api/resources/holiday-calendars/:id/dates   → list this calendar's public holidays
 * POST /api/resources/holiday-calendars/:id/dates   → add one
 */

import { db } from "@/db";
import { holidayCalendars, publicHolidays } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { isAdminRole } from "@/lib/resources/access";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { requireModule } from "@/lib/modules-server";
import { and, eq, asc } from "drizzle-orm";

async function requireCalendar(orgId: string, calendarId: string) {
  const [row] = await db.select({ id: holidayCalendars.id }).from(holidayCalendars)
    .where(and(eq(holidayCalendars.id, calendarId), eq(holidayCalendars.orgId, orgId))).limit(1);
  return row;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  if (!(await requireCalendar(orgId!, params.id))) return bad("Holiday calendar not found", 404);
  const rows = await db.select().from(publicHolidays).where(and(eq(publicHolidays.orgId, orgId!), eq(publicHolidays.calendarId, params.id))).orderBy(asc(publicHolidays.date));
  return ok(rows);
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  // Types carry GL accounts and leave policy; calendars set everyone's capacity. Admin only.
  if (!isAdminRole(role)) return bad("Only organisation admins can change this", 403);
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  if (!(await requireCalendar(orgId!, params.id))) return bad("Holiday calendar not found", 404);

  const body = await req.json().catch(() => ({}));
  const { date, name } = body ?? {};
  // isRealDate, not just the shape: 2026-02-30 passed the regex and 500'd in Postgres.
  if (typeof date !== "string" || !isRealDate(date)) return bad("A valid date (YYYY-MM-DD) is required");
  if (!name || typeof name !== "string" || !name.trim()) return bad("name is required");

  const [row] = await db.insert(publicHolidays).values({ orgId: orgId!, calendarId: params.id, date, name: name.trim() }).returning();
  return ok(row);
}
