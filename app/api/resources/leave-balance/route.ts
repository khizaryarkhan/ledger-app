/**
 * GET  /api/resources/leave-balance?resourceId=&timesheetTypeId=
 *   → { balance, entries } — the running balance as-at today, plus the
 *     ledger history (newest first) for transparency.
 * POST /api/resources/leave-balance
 *   → grant/adjust a balance-tracked leave type's balance for a resource.
 *     The only place hours are ever CREDITED — approving a leave time entry
 *     only ever writes a `usage` (negative) row (see time-entries/[id]/approve).
 *     Admin-gated: this directly changes someone's leave entitlement.
 */

import { db } from "@/db";
import { leaveBalanceEntries, leavePolicies, timesheetTypes, resources } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, desc } from "drizzle-orm";
import { balanceAsAt } from "@/lib/payroll/leave-balance";
import { localToday } from "@/lib/format";

const SOURCE_TYPES = ["opening", "accrual", "carry_forward", "adjustment"] as const;

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const resourceId = searchParams.get("resourceId");
  const timesheetTypeId = searchParams.get("timesheetTypeId");
  if (!resourceId || !timesheetTypeId) return bad("resourceId and timesheetTypeId are required");

  const [balance, entries] = await Promise.all([
    balanceAsAt(orgId!, resourceId, timesheetTypeId, localToday()),
    db.select().from(leaveBalanceEntries)
      .where(and(eq(leaveBalanceEntries.orgId, orgId!), eq(leaveBalanceEntries.resourceId, resourceId), eq(leaveBalanceEntries.timesheetTypeId, timesheetTypeId)))
      .orderBy(desc(leaveBalanceEntries.date), desc(leaveBalanceEntries.createdAt)),
  ]);
  return ok({ balance, entries });
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const body = await req.json().catch(() => ({}));
  const { resourceId, timesheetTypeId, hours, sourceType, date, note } = body ?? {};
  if (!resourceId) return bad("resourceId is required");
  if (!timesheetTypeId) return bad("timesheetTypeId is required");
  const h = Number(hours);
  if (!Number.isFinite(h) || h === 0) return bad("hours must be a non-zero number (positive to grant, negative to deduct)");
  if (!SOURCE_TYPES.includes(sourceType)) return bad(`sourceType must be one of: ${SOURCE_TYPES.join(", ")}`);
  const entryDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localToday();

  const [resource] = await db.select({ id: resources.id }).from(resources).where(and(eq(resources.id, resourceId), eq(resources.orgId, orgId!))).limit(1);
  if (!resource) return bad("Resource not found", 404);

  const [type] = await db.select({ id: timesheetTypes.id, category: timesheetTypes.category }).from(timesheetTypes)
    .where(and(eq(timesheetTypes.id, timesheetTypeId), eq(timesheetTypes.orgId, orgId!))).limit(1);
  if (!type) return bad("Timesheet type not found", 404);
  if (type.category !== "leave") return bad("Only a leave-category timesheet type can carry a balance");

  const [policy] = await db.select({ id: leavePolicies.id }).from(leavePolicies)
    .where(and(eq(leavePolicies.orgId, orgId!), eq(leavePolicies.timesheetTypeId, timesheetTypeId))).limit(1);
  if (!policy) return bad("This leave type isn't balance-tracked yet — turn on balance tracking for it in Timesheet Types first", 409);

  const [row] = await db.insert(leaveBalanceEntries).values({
    orgId: orgId!, resourceId, timesheetTypeId, date: entryDate, hours: h.toFixed(2),
    sourceType, note: note ? String(note).slice(0, 500) : null, createdBy: (session?.user as any)?.id ?? null,
  }).returning();

  const balance = await balanceAsAt(orgId!, resourceId, timesheetTypeId, localToday());
  return ok({ entry: row, balance });
}
