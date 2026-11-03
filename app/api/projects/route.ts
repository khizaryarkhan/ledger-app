import { db } from "@/db";
import { projects, customers, resources } from "@/db/schema";
import { requireOrg, requireReadScope, ok, bad, ownsInOrg } from "@/lib/api";
import { getRepScope } from "@/lib/rep-scope";
import { z } from "zod";
import { eq, and, inArray, or, ilike } from "drizzle-orm";

const Schema = z.object({
  customerId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(64),
  ownerId: z.string().uuid().nullable().optional(),
  // Who approves time booked to this project. NOT ownerId — see db/schema.ts.
  leadResourceId: z.string().uuid().nullable().optional(),
  status: z.enum(["Pending", "Active", "In Progress", "Completed", "On Hold", "Cancelled"]).default("Active"),
});

export async function GET(req: Request) {
  const { error, orgId, orgIds, role, repId } = await requireReadScope();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");
  // `search` matches the project code or name, case-insensitively, anywhere in
  // it ("G26006" finds "G26006 - Main works"). It used to be ignored silently,
  // so a filtered request returned the whole list.
  const search = (searchParams.get("search") ?? "").trim().slice(0, 100);
  const status = searchParams.get("status");

  const conds = [inArray(projects.orgId, orgIds)];
  if (customerId) conds.push(eq(projects.customerId, customerId));
  if (status) conds.push(eq(projects.status, status));
  if (search) {
    const like = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conds.push(or(ilike(projects.code, like), ilike(projects.name, like))!);
  }
  const rows = await db.select().from(projects).where(and(...conds));

  // Reps only see projects in their book (plus any referenced by a visible invoice).
  const scope = await getRepScope(orgId!, role, repId);
  if (scope) return ok(rows.filter((p) => scope.projectIds.has(p.id)));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());
    if (!(await ownsInOrg(customers, data.customerId, orgId!))) return bad("Customer not found in this organisation", 404);
    if (data.leadResourceId && !(await ownsInOrg(resources, data.leadResourceId, orgId!))) {
      return bad("That project lead was not found in this organisation", 404);
    }
    const [created] = await db.insert(projects).values({
      orgId: orgId!,
      customerId: data.customerId,
      name: data.name,
      code: data.code,
      ownerId: data.ownerId ?? null,
      leadResourceId: data.leadResourceId ?? null,
      status: data.status ?? "Active",
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create project", 500);
  }
}
