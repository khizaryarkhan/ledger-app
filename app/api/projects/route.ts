import { db } from "@/db";
import { projects, organisations, reps } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, and, inArray } from "drizzle-orm";

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

  // rep or company_user scoped to their projects
  if ((role === "rep" || role === "company_user") && repId) {
    const [repRow] = await db.select({ tier: reps.tier })
      .from(reps).where(and(eq(reps.id, repId), eq(reps.orgId, orgId!))).limit(1);
    const tier = repRow?.tier ?? "rep";

    // Build the list of repIds this user can see
    let visibleRepIds: string[] = [repId];
    if (tier === "ed" || tier === "rd") {
      const reportees = await db.select({ id: reps.id })
        .from(reps).where(and(eq(reps.orgId, orgId!), eq(reps.managerId, repId)));
      visibleRepIds = [repId, ...reportees.map(r => r.id)];
    }

    const [org] = await db.select({ level: organisations.classificationLevel })
      .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
    const level = org?.level ?? "customer";

    const filter = level === "project"
      ? and(eq(projects.orgId, orgId!), inArray(projects.repId, visibleRepIds), customerId ? eq(projects.customerId, customerId) : undefined)
      : and(eq(projects.orgId, orgId!), customerId ? eq(projects.customerId, customerId) : undefined);
    return ok(await db.select().from(projects).where(filter));
  }

  if (customerId) {
    return ok(await db.select().from(projects).where(and(eq(projects.orgId, orgId!), eq(projects.customerId, customerId))));
  }
  return ok(await db.select().from(projects).where(eq(projects.orgId, orgId!)));
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());
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
