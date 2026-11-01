/**
 * GET    /api/accounting/budgets/[id]  — budget + its lines
 * PATCH  /api/accounting/budgets/[id]  — { name?, status? }
 * DELETE /api/accounting/budgets/[id]  — lines cascade
 */
import { db } from "@/db";
import { budgets, budgetLines } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { loadBudget } from "@/lib/accounting/budgets-server";

export const runtime = "nodejs";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  status: z.enum(["active", "archived"]).optional(),
}).strict();

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const budget = await loadBudget(orgId!, params.id);
  if (!budget) return bad("Budget not found", 404);
  const lines = await db.select({ accountId: budgetLines.accountId, month: budgetLines.month, amount: budgetLines.amount })
    .from(budgetLines).where(and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.orgId, orgId!)));
  return ok({ ...budget, lines: lines.map((l) => ({ ...l, amount: Number(l.amount) })) });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Invalid request");
  if (!(await loadBudget(orgId!, params.id))) return bad("Budget not found", 404);
  if (Object.keys(parsed.data).length === 0) return bad("Nothing to update");
  const [row] = await db.update(budgets).set(parsed.data)
    .where(and(eq(budgets.id, params.id), eq(budgets.orgId, orgId!))).returning();
  return ok(row);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  if (!(await loadBudget(orgId!, params.id))) return bad("Budget not found", 404);
  await db.delete(budgets).where(and(eq(budgets.id, params.id), eq(budgets.orgId, orgId!)));
  return ok({ ok: true });
}
