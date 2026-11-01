/**
 * GET  /api/accounting/budgets          — list the org's budgets (with line counts)
 * POST /api/accounting/budgets          — create { name, year, copyFromPriorYear?, uplift? }
 *
 * copyFromPriorYear seeds the new budget's lines from the prior year's ACTUALS
 * (existing profitAndLoss per month), optionally scaled by `uplift` percent.
 */
import { db } from "@/db";
import { budgets, budgetLines } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { and, eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireLedgerAuthority } from "@/lib/accounting/ledger-authority";
import { actualsByMonth } from "@/lib/accounting/budgets-server";
import { seedLinesFromActuals } from "@/lib/accounting/budgets";

export const runtime = "nodejs";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  year: z.number().int().min(2000).max(2100),
  copyFromPriorYear: z.boolean().optional(),
  uplift: z.number().min(-100).max(1000).optional(),
}).strict();

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const rows = await db.select({
    id: budgets.id, name: budgets.name, year: budgets.year, status: budgets.status, createdAt: budgets.createdAt,
    lineCount: sql<number>`(select count(*) from budget_lines bl where bl.budget_id = ${budgets.id})::int`,
  }).from(budgets).where(eq(budgets.orgId, orgId!)).orderBy(desc(budgets.year), desc(budgets.createdAt));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Invalid request");
  const { name, year, copyFromPriorYear, uplift } = parsed.data;

  let seed: { accountId: string; month: number; amount: number }[] = [];
  if (copyFromPriorYear) {
    const auth = await requireLedgerAuthority([orgId!]);
    if (auth.error) return auth.error;
    const actuals = await actualsByMonth(orgId!, year - 1, Array.from({ length: 12 }, (_, i) => i + 1));
    seed = seedLinesFromActuals(actuals, uplift ?? 0);
  }

  const [dup] = await db.select({ id: budgets.id }).from(budgets)
    .where(and(eq(budgets.orgId, orgId!), eq(budgets.year, year), eq(budgets.name, name))).limit(1);
  if (dup) return bad("A budget with this name already exists for that year");

  const [row] = await db.insert(budgets).values({
    orgId: orgId!, name, year, createdBy: ((session?.user as any)?.id as string) ?? null,
  }).returning();

  if (seed.length) {
    await db.insert(budgetLines).values(seed.map((l) => ({
      orgId: orgId!, budgetId: row.id, accountId: l.accountId, month: l.month, amount: String(l.amount),
    })));
  }
  return ok({ ...row, seeded: seed.length });
}
