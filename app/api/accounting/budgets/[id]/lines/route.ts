/**
 * PUT /api/accounting/budgets/[id]/lines
 *   { lines: [{ accountId, month, amount }] }  — the full grid
 *
 * Replaces the grid: cells in the payload are upserted, and cells for the
 * SAME accounts that are absent from the payload are removed. Zero cells are
 * not stored. neon-http has no transactions, so everything is validated
 * before any write, and the upsert (one statement) runs before the cleanup
 * (one statement) — a failure between them leaves stale cells, never lost ones.
 */
import { db } from "@/db";
import { budgetLines } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { accountsByIds, loadBudget } from "@/lib/accounting/budgets-server";
import { isBudgetableAccount } from "@/lib/accounting/budgets";

export const runtime = "nodejs";

const schema = z.object({
  lines: z.array(z.object({
    accountId: z.string().uuid(),
    month: z.number().int().min(1).max(12),
    amount: z.number().finite().min(-1e11).max(1e11),
  })).max(5000),
}).strict();

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const parsed = schema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Invalid request");
  const budget = await loadBudget(orgId!, params.id);
  if (!budget) return bad("Budget not found", 404);

  // Last write wins per (account, month).
  const cells = new Map<string, { accountId: string; month: number; amount: number }>();
  for (const l of parsed.data.lines) cells.set(`${l.accountId}|${l.month}`, { accountId: l.accountId, month: l.month, amount: Math.round(l.amount * 100) / 100 });

  const accountIds = [...new Set(parsed.data.lines.map((l) => l.accountId))];
  const found = await accountsByIds(orgId!, accountIds);
  if (found.length !== accountIds.length) return bad("Unknown account in budget lines");
  const bad1 = found.find((a) => !isBudgetableAccount(a));
  if (bad1) return bad(`${bad1.name} is not a Profit & Loss account`);

  const nonZero = [...cells.values()].filter((c) => c.amount !== 0);

  if (nonZero.length) {
    await db.insert(budgetLines).values(nonZero.map((c) => ({
      orgId: orgId!, budgetId: budget.id, accountId: c.accountId, month: c.month, amount: String(c.amount),
    }))).onConflictDoUpdate({
      target: [budgetLines.budgetId, budgetLines.accountId, budgetLines.month],
      set: { amount: sql`excluded.amount` },
    });
  }

  // Remove cells the grid no longer has: zeroed cells, and anything not sent.
  const keep = new Set(nonZero.map((c) => `${c.accountId}|${c.month}`));
  const existing = await db.select({ id: budgetLines.id, accountId: budgetLines.accountId, month: budgetLines.month })
    .from(budgetLines).where(and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.orgId, orgId!)));
  const stale = existing.filter((e) => !keep.has(`${e.accountId}|${e.month}`));
  for (let i = 0; i < stale.length; i += 200) {
    const ids = stale.slice(i, i + 200).map((s) => s.id);
    await db.delete(budgetLines).where(and(
      eq(budgetLines.budgetId, budget.id), eq(budgetLines.orgId, orgId!),
      sql`${budgetLines.id} in (${sql.join(ids.map((x) => sql`${x}`), sql`, `)})`,
    ));
  }
  return ok({ saved: nonZero.length, removed: stale.length });
}
