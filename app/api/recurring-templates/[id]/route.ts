/**
 * PATCH  /api/recurring-templates/[id] — pause/resume (active), or edit
 *          name/frequency/interval/endType/endAfterCount/endOnDate/autoSend.
 * DELETE /api/recurring-templates/[id]
 */
import { db } from "@/db";
import { recurringTemplates } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

async function loadOwned(orgId: string, id: string) {
  const [row] = await db.select().from(recurringTemplates)
    .where(and(eq(recurringTemplates.id, id), eq(recurringTemplates.orgId, orgId))).limit(1);
  return row ?? null;
}

const PatchSchema = z.object({
  templateName: z.string().min(1).max(255).optional(),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]).optional(),
  interval: z.number().int().min(1).max(365).optional(),
  endType: z.enum(["never", "after", "on"]).optional(),
  endAfterCount: z.number().int().min(1).max(999).nullable().optional(),
  endOnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  autoSend: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const row = await loadOwned(orgId!, params.id);
  if (!row) return bad("Template not found", 404);

  let data: z.infer<typeof PatchSchema>;
  try { data = PatchSchema.parse(await req.json()); }
  catch (e: any) { return bad(e?.issues?.[0]?.message || "Invalid request"); }

  const [updated] = await db.update(recurringTemplates).set({
    ...(data.templateName !== undefined ? { templateName: data.templateName } : {}),
    ...(data.frequency !== undefined ? { frequency: data.frequency } : {}),
    ...(data.interval !== undefined ? { interval: data.interval } : {}),
    ...(data.endType !== undefined ? { endType: data.endType } : {}),
    ...(data.endAfterCount !== undefined ? { endAfterCount: data.endAfterCount } : {}),
    ...(data.endOnDate !== undefined ? { endOnDate: data.endOnDate } : {}),
    ...(data.autoSend !== undefined ? { autoSend: data.autoSend } : {}),
    ...(data.active !== undefined ? { active: data.active } : {}),
  }).where(and(eq(recurringTemplates.id, params.id), eq(recurringTemplates.orgId, orgId!))).returning();

  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const row = await loadOwned(orgId!, params.id);
  if (!row) return bad("Template not found", 404);

  await db.delete(recurringTemplates).where(eq(recurringTemplates.id, row.id));
  return ok({ deleted: true });
}
