/**
 * GET  /api/resources/time-entries   → list (?resourceId=&status=&from=&to=)
 * POST /api/resources/time-entries   → log time (Draft)
 *
 * Mirrors Dynamics' Quick Create: Time Entry — Date, Hours, Type, and (only
 * when the Type requires it) a Project/Manufacturing Order/Job Work Order.
 */

import { db } from "@/db";
import { timeEntries, timesheetTypes } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, gte, lte, desc } from "drizzle-orm";
import { isAssignableType } from "@/lib/resources/assignable";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const resourceId = searchParams.get("resourceId");
  const status = searchParams.get("status");
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  const conds = [eq(timeEntries.orgId, orgId!)];
  if (resourceId) conds.push(eq(timeEntries.resourceId, resourceId));
  if (status) conds.push(eq(timeEntries.status, status));
  if (from) conds.push(gte(timeEntries.date, from));
  if (to) conds.push(lte(timeEntries.date, to));

  const rows = await db.select().from(timeEntries).where(and(...conds)).orderBy(desc(timeEntries.date));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const { resourceId, date, hours, timesheetTypeId, assignableType, assignableId, description } = body ?? {};
  if (!resourceId || typeof resourceId !== "string") return bad("resourceId is required");
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return bad("A valid date (YYYY-MM-DD) is required");
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return bad("hours must be a positive number");
  if (!timesheetTypeId || typeof timesheetTypeId !== "string") return bad("timesheetTypeId is required");

  const [type] = await db.select().from(timesheetTypes).where(and(eq(timesheetTypes.id, timesheetTypeId), eq(timesheetTypes.orgId, orgId!))).limit(1);
  if (!type) return bad("That timesheet type was not found in this organisation.");

  let finalAssignableType: string | null = null;
  let finalAssignableId: string | null = null;
  if (type.requiresAssignable) {
    if (!assignableType || !isAssignableType(assignableType) || !assignableId) {
      return bad(`"${type.name}" requires a Project, Manufacturing Order or Job Work Order to be selected.`);
    }
    finalAssignableType = assignableType;
    finalAssignableId = assignableId;
  }

  const [row] = await db.insert(timeEntries).values({
    orgId: orgId!,
    resourceId,
    date,
    hours: h.toFixed(2),
    timesheetTypeId,
    assignableType: finalAssignableType,
    assignableId: finalAssignableId,
    description: description ? String(description).slice(0, 255) : null,
    status: "draft",
    createdBy: (session?.user as any)?.id ?? null,
  }).returning();
  return ok(row);
}
