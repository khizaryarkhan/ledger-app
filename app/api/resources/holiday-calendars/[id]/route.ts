/**
 * PATCH  /api/resources/holiday-calendars/:id   → rename / set as default
 * DELETE /api/resources/holiday-calendars/:id   → delete (blocked if any resource still points at it)
 */

import { db } from "@/db";
import { holidayCalendars, resources } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: holidayCalendars.id }).from(holidayCalendars).where(and(eq(holidayCalendars.id, params.id), eq(holidayCalendars.orgId, orgId!))).limit(1);
  if (!existing) return bad("Holiday calendar not found", 404);

  const body = await req.json().catch(() => ({}));
  const { name, isDefault } = body ?? {};
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (name != null) { if (!String(name).trim()) return bad("name cannot be empty"); patch.name = String(name).trim(); }
  if (isDefault === true) {
    await db.update(holidayCalendars).set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(holidayCalendars.orgId, orgId!), eq(holidayCalendars.isDefault, true)));
    patch.isDefault = true;
  } else if (isDefault === false) {
    patch.isDefault = false;
  }

  const [row] = await db.update(holidayCalendars).set(patch).where(and(eq(holidayCalendars.id, params.id), eq(holidayCalendars.orgId, orgId!))).returning();
  return ok(row);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const [existing] = await db.select({ id: holidayCalendars.id }).from(holidayCalendars).where(and(eq(holidayCalendars.id, params.id), eq(holidayCalendars.orgId, orgId!))).limit(1);
  if (!existing) return bad("Holiday calendar not found", 404);

  const [inUse] = await db.select({ id: resources.id }).from(resources).where(and(eq(resources.orgId, orgId!), eq(resources.holidayCalendarId, params.id))).limit(1);
  if (inUse) return bad("This calendar is assigned to one or more resources — reassign them first", 409);

  await db.delete(holidayCalendars).where(and(eq(holidayCalendars.id, params.id), eq(holidayCalendars.orgId, orgId!)));
  return ok({ ok: true });
}
