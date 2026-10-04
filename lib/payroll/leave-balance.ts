/**
 * A leave balance is SUM(hours) over leave_balance_entries as-at a date —
 * never a mutable field. Same "prove it, don't assert it" rule every other
 * balance in this app follows (lots, AR aging, inventory valuation).
 */

import { db } from "@/db";
import { leaveBalanceEntries } from "@/db/schema";
import { and, eq, lte, sql } from "drizzle-orm";

export async function balanceAsAt(orgId: string, resourceId: string, timesheetTypeId: string, asAt: string): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${leaveBalanceEntries.hours}), 0)` })
    .from(leaveBalanceEntries)
    .where(and(
      eq(leaveBalanceEntries.orgId, orgId),
      eq(leaveBalanceEntries.resourceId, resourceId),
      eq(leaveBalanceEntries.timesheetTypeId, timesheetTypeId),
      lte(leaveBalanceEntries.date, asAt),
    ));
  return Number(row?.total ?? 0);
}
