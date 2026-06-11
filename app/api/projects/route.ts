import { db } from "@/db";
import { projects, customers } from "@/db/schema";
import { requireOrg, ok, bad, ownsInOrg } from "@/lib/api";
import { getRepScope } from "@/lib/rep-scope";
import { z } from "zod";
import { eq, and } from "drizzle-orm";

const Schema = z.object({
  customerId: z.string().uuid(),
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(64),
  ownerId: z.string().uuid().nullable().optional(),
  status: z.enum(["Pending", "Active", "In Progress", "Completed", "On Hold", "Cancelled"]).default("Active"),
});

export async function GET(req: Request) {
  const { error, orgId, role, repId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const customerId = searchParams.get("customerId");

  const rows = customerId
    ? await db.select().from(projects).where(and(eq(projects.orgId, orgId!), eq(projects.customerId, customerId)))
    : await db.select().from(projects).where(eq(projects.orgId, orgId!));

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
    const [created] = await db.insert(projects).values({
      orgId: orgId!,
      customerId: data.customerId,
      name: data.name,
      code: data.code,
      ownerId: data.ownerId ?? null,
      status: data.status ?? "Active",
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    return bad("Failed to create project", 500);
  }
}
