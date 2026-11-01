/**
 * GET /api/accounting/budget-vs-actual?budgetId=&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Budget vs actual per P&L account per month and for the range. Actuals reuse
 * profitAndLoss() once per month (native GL). The range snaps to whole
 * calendar months of the budget's year. Defaults: Jan 1 .. today within the
 * budget year.
 */
import { requireOrg, ok, bad } from "@/lib/api";
import { requireLedgerAuthority } from "@/lib/accounting/ledger-authority";
import { loadBudget, actualsByMonth, accountsByIds } from "@/lib/accounting/budgets-server";
import { db } from "@/db";
import { budgetLines, organisations } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { isIsoDate } from "@/lib/inventory/delivery-performance";
import { monthsInRange, buildVarianceRows, summariseProfit } from "@/lib/accounting/budgets";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const auth = await requireLedgerAuthority([orgId!]);
  if (auth.error) return auth.error;

  const q = new URL(req.url).searchParams;
  const budgetId = q.get("budgetId");
  if (!budgetId) return bad("budgetId is required");
  const budget = await loadBudget(orgId!, budgetId);
  if (!budget) return bad("Budget not found", 404);

  const today = new Date().toISOString().slice(0, 10);
  const from = q.get("from") || `${budget.year}-01-01`;
  const to = q.get("to") || (today.startsWith(String(budget.year)) ? today : `${budget.year}-12-31`);
  if (!isIsoDate(from) || !isIsoDate(to)) return bad("from/to must be YYYY-MM-DD");
  if (from > to) return bad("from must not be after to");

  const spans = monthsInRange(budget.year, from, to);
  const months = spans.map((m) => m.month);

  const [lineRows, actuals, [org]] = await Promise.all([
    db.select({ accountId: budgetLines.accountId, month: budgetLines.month, amount: budgetLines.amount })
      .from(budgetLines).where(and(eq(budgetLines.budgetId, budget.id), eq(budgetLines.orgId, orgId!))),
    actualsByMonth(orgId!, budget.year, months),
    db.select({ currency: organisations.currency, name: organisations.name, displayName: organisations.displayName })
      .from(organisations).where(eq(organisations.id, orgId!)).limit(1),
  ]);
  const lines = lineRows.map((l) => ({ ...l, amount: Number(l.amount) }));

  const ids = [...new Set([...lines.map((l) => l.accountId), ...actuals.map((a) => a.accountId)])];
  const accts = await accountsByIds(orgId!, ids);
  const rows = buildVarianceRows(accts, lines, actuals, months);

  return ok({
    budget: { id: budget.id, name: budget.name, year: budget.year, status: budget.status },
    from: spans[0]?.from ?? from, to: spans[spans.length - 1]?.to ?? to,
    months: spans,
    rows,
    profit: summariseProfit(rows),
    meta: { entity: org?.displayName || org?.name || "—", currency: org?.currency || "PKR" },
  });
}
