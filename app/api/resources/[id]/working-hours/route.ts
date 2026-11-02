/**
 * GET  /api/resources/[id]/working-hours  -> that person's dated contracted hours
 * POST /api/resources/[id]/working-hours  -> add a row
 *
 * Writes are admin-only, matching every other edit to a resource. Reads are
 * open to anyone who may already see the Resources module: this is a working
 * pattern, not pay.
 */

import { db } from "@/db";
import { resources, resourceWorkingHours } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { isAdminRole } from "@/lib/resources/access";
import { isRealDate } from "@/lib/resources/time-entry-rules";
import { and, eq } from "drizzle-orm";

const MAX_HOURS_PER_DAY = 24;

/** ISO weekday numbers, de-duplicated and sorted; null when the row names none. */
export function parseWorkingDays(v: unknown): { ok: true; days: number[] | null } | { ok: false; error: string } {
  if (v === undefined || v === null || (Array.isArray(v) && v.length === 0)) return { ok: true, days: null };
  if (!Array.isArray(v)) return { ok: false, error: "workingDays must be a list of weekday numbers" };
  const days = Array.from(new Set(v.map((d) => Number(d))));
  if (days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    return { ok: false, error: "workingDays must be whole numbers from 1 (Monday) to 7 (Sunday)" };
  }
  return { ok: true, days: days.sort((a, b) => a - b) };
}

export function parseHoursPerDay(v: unknown): { ok: true; hours: number } | { ok: false; error: string } {
  const h = typeof v === "string" ? Number(v.trim()) : Number(v);
  if (v === null || v === undefined || v === "" || !Number.isFinite(h)) return { ok: false, error: "hoursPerDay must be a number" };
  if (h <= 0) return { ok: false, error: "hoursPerDay must be more than zero" };
  if (h > MAX_HOURS_PER_DAY) return { ok: false, error: `hoursPerDay cannot exceed ${MAX_HOURS_PER_DAY}` };
  return { ok: true, hours: Math.round(h * 100) / 100 };
}

async function ownResource(orgId: string, id: string): Promise<boolean> {
  const [r] = await db.select({ id: resources.id }).from(resources)
    .where(and(eq(resources.id, id), eq(resources.orgId, orgId))).limit(1);
  return !!r;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  if (!(await ownResource(orgId!, params.id))) return bad("Resource not found", 404);

  const rows = await db.select().from(resourceWorkingHours)
    .where(and(eq(resourceWorkingHours.orgId, orgId!), eq(resourceWorkingHours.resourceId, params.id)))
    .orderBy(resourceWorkingHours.effectiveFrom);
  return ok(rows.map((r) => ({
    id: r.id, hoursPerDay: Number(r.hoursPerDay), workingDays: r.workingDays ?? null,
    effectiveFrom: r.effectiveFrom, effectiveTo: r.effectiveTo ?? null, note: r.note ?? null,
  })));
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;
  if (!isAdminRole(role)) return bad("Admins only", 403);
  if (!(await ownResource(orgId!, params.id))) return bad("Resource not found", 404);

  const body = await req.json().catch(() => ({}));
  const hours = parseHoursPerDay((body as any)?.hoursPerDay);
  if ("error" in hours) return bad(hours.error);
  const days = parseWorkingDays((body as any)?.workingDays);
  if ("error" in days) return bad(days.error);

  const from = (body as any)?.effectiveFrom;
  const to = (body as any)?.effectiveTo || null;
  if (!isRealDate(from)) return bad("effectiveFrom must be a real date (YYYY-MM-DD)");
  if (to !== null && !isRealDate(to)) return bad("effectiveTo must be a real date (YYYY-MM-DD)");
  // Compared as strings — a date is a date.
  if (to !== null && to < from) return bad("effectiveTo cannot be before effectiveFrom");

  const [created] = await db.insert(resourceWorkingHours).values({
    orgId: orgId!, resourceId: params.id,
    hoursPerDay: hours.hours.toFixed(2), workingDays: days.days,
    effectiveFrom: from, effectiveTo: to,
    note: (body as any)?.note ? String((body as any).note).slice(0, 160) : null,
  }).returning();
  return ok(created);
}
