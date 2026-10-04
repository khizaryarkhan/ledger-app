/**
 * GET  /api/resources/holiday-calendars   → list calendars
 * POST /api/resources/holiday-calendars   → create a calendar
 *
 * A region's public-holiday list — orgs with multi-region staff (e.g. UK +
 * Ireland) need more than one. `resources.holidayCalendarId` null = the
 * org's default (is_default = true).
 */

import { db } from "@/db";
import { holidayCalendars } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, desc } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const rows = await db.select().from(holidayCalendars).where(eq(holidayCalendars.orgId, orgId!)).orderBy(desc(holidayCalendars.isDefault), holidayCalendars.name);
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const { name, isDefault } = body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) return bad("name is required");

  if (isDefault) {
    await db.update(holidayCalendars).set({ isDefault: false, updatedAt: new Date() })
      .where(and(eq(holidayCalendars.orgId, orgId!), eq(holidayCalendars.isDefault, true)));
  }
  const [row] = await db.insert(holidayCalendars).values({ orgId: orgId!, name: name.trim(), isDefault: !!isDefault }).returning();
  return ok(row);
}
