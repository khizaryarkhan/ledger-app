/**
 * GET  /api/resources   → list resources (people/equipment), ?type=&status= filters
 * POST /api/resources   → create a resource
 */

import { db } from "@/db";
import { resources, employees } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { and, eq, desc } from "drizzle-orm";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const status = searchParams.get("status");

  const conds = [eq(resources.orgId, orgId!)];
  if (type === "person" || type === "equipment") conds.push(eq(resources.type, type));
  if (status === "active" || status === "inactive") conds.push(eq(resources.status, status));

  const rows = await db.select().from(resources).where(and(...conds)).orderBy(desc(resources.createdAt));
  const employeeIds = rows.map(r => r.employeeId).filter(Boolean) as string[];
  const emps = employeeIds.length
    ? await db.select({ id: employees.id, name: employees.name, email: employees.email }).from(employees).where(and(eq(employees.orgId, orgId!)))
    : [];
  const byId = new Map(emps.map(e => [e.id, e]));
  return ok(rows.map(r => ({ ...r, employee: r.employeeId ? byId.get(r.employeeId) ?? null : null })));
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const { type, employeeId, name, category, dailyCapacity, status, notes } = body ?? {};
  if (type !== "person" && type !== "equipment") return bad("type must be 'person' or 'equipment'");
  if (!name || typeof name !== "string" || !name.trim()) return bad("name is required");

  const [row] = await db.insert(resources).values({
    orgId: orgId!,
    type,
    employeeId: type === "person" && employeeId ? employeeId : null,
    name: name.trim(),
    category: category || null,
    dailyCapacity: dailyCapacity != null ? String(dailyCapacity) : "1",
    status: status === "inactive" ? "inactive" : "active",
    notes: notes || null,
  }).returning();
  return ok(row);
}
