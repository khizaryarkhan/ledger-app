import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apWorkflowRules } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";

const CreateSchema = z.object({
  name:           z.string().min(1).max(255),
  entityType:     z.enum(["purchase_request", "purchase_order", "bill", "payment_run"]),
  isActive:       z.boolean().default(true),
  conditionsJson: z.record(z.unknown()).default({}),
  stepsJson:      z.array(z.unknown()).default([]),
  priority:       z.number().int().default(0),
});

export async function GET(_req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const rows = await db.select().from(apWorkflowRules)
    .where(eq(apWorkflowRules.orgId, orgId!))
    .orderBy(asc(apWorkflowRules.priority));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  try {
    const data = CreateSchema.parse(await req.json());
    const [created] = await db.insert(apWorkflowRules).values({
      orgId:          orgId!,
      name:           data.name,
      entityType:     data.entityType,
      isActive:       data.isActive,
      conditionsJson: data.conditionsJson as any,
      stepsJson:      data.stepsJson as any,
      priority:       data.priority,
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create workflow rule", 500);
  }
}
