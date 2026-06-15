import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apWorkflowRules } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

const UpdateSchema = z.object({
  name:           z.string().min(1).max(255).optional(),
  entityType:     z.enum(["purchase_request", "purchase_order", "bill", "payment_run"]).optional(),
  isActive:       z.boolean().optional(),
  conditionsJson: z.record(z.unknown()).optional(),
  stepsJson:      z.array(z.unknown()).optional(),
  priority:       z.number().int().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [existing] = await db.select().from(apWorkflowRules)
    .where(and(eq(apWorkflowRules.id, params.id), eq(apWorkflowRules.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Workflow rule not found", 404);

  try {
    const data = UpdateSchema.parse(await req.json());
    const [updated] = await db.update(apWorkflowRules)
      .set({ ...data, updatedAt: new Date() })
      .where(and(eq(apWorkflowRules.id, params.id), eq(apWorkflowRules.orgId, orgId!)))
      .returning();
    return ok(updated);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to update workflow rule", 500);
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  const [existing] = await db.select().from(apWorkflowRules)
    .where(and(eq(apWorkflowRules.id, params.id), eq(apWorkflowRules.orgId, orgId!)))
    .limit(1);
  if (!existing) return bad("Workflow rule not found", 404);

  await db.delete(apWorkflowRules)
    .where(and(eq(apWorkflowRules.id, params.id), eq(apWorkflowRules.orgId, orgId!)));

  return ok({ deleted: true });
}
