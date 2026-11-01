/**
 * Server half of budgets (db-touching). Actuals come from the EXISTING
 * profitAndLoss() once per month — no second GL aggregation exists.
 */
import { db } from "@/db";
import { accounts, budgets } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { profitAndLoss } from "./financials";
import { flattenPl, monthSpan, type ActualIn } from "./budgets";

/** Natural-sign P&L actuals per account per calendar month of `year`. */
export async function actualsByMonth(orgId: string, year: number, months: number[]): Promise<ActualIn[]> {
  const perMonth = await Promise.all(months.map(async (m) => {
    const span = monthSpan(year, m);
    const pl = await profitAndLoss([orgId], span.from, span.to);
    return [...flattenPl(pl).entries()].map(([accountId, amount]) => ({ accountId, month: m, amount }));
  }));
  return perMonth.flat();
}

/** Budget row, only if it belongs to the org. */
export async function loadBudget(orgId: string, id: string) {
  const [row] = await db.select().from(budgets).where(and(eq(budgets.id, id), eq(budgets.orgId, orgId))).limit(1);
  return row ?? null;
}

export async function accountsByIds(orgId: string, ids: string[]) {
  if (!ids.length) return [];
  return db.select({
    id: accounts.id, name: accounts.name, code: accounts.code, type: accounts.type,
    classification: accounts.classification, isHeader: accounts.isHeader,
  }).from(accounts).where(and(eq(accounts.orgId, orgId), inArray(accounts.id, ids)));
}
