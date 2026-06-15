import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apSuppliers } from "@/db/schema";
import { eq, and, ne, inArray } from "drizzle-orm";

export async function GET(_req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];

  const bills = await db.select().from(apBills)
    .where(and(
      eq(apBills.orgId, orgId!),
      inArray(apBills.workflowStatus, ["Approved", "Ready for Payment", "Scheduled"]),
      ne(apBills.accountingPaymentStatus, "Paid"),
    ));

  const supplierIds = [...new Set(bills.map((b) => b.supplierId).filter(Boolean) as string[])];
  const suppliers = supplierIds.length > 0
    ? await db.select().from(apSuppliers).where(eq(apSuppliers.orgId, orgId!))
    : [];

  const supplierNameMap: Record<string, string> = {};
  for (const s of suppliers) {
    supplierNameMap[s.id] = s.displayName || s.name;
  }

  const buckets: {
    label: string;
    fromDays: number;
    toDays:   number;
    bills:    any[];
    total:    number;
  }[] = [
    { label: "Overdue",      fromDays: -Infinity, toDays: -1,  bills: [], total: 0 },
    { label: "Due in 7 days",  fromDays: 0,  toDays: 7,   bills: [], total: 0 },
    { label: "Due in 8-14 days", fromDays: 8, toDays: 14,  bills: [], total: 0 },
    { label: "Due in 15-30 days", fromDays: 15, toDays: 30, bills: [], total: 0 },
    { label: "Due in 31-60 days", fromDays: 31, toDays: 60, bills: [], total: 0 },
    { label: "Due in 60+ days",   fromDays: 61, toDays: Infinity, bills: [], total: 0 },
  ];

  for (const bill of bills) {
    const daysUntilDue = bill.dueDate
      ? Math.floor((new Date(bill.dueDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    const enriched = {
      ...bill,
      supplierName: bill.supplierId ? (supplierNameMap[bill.supplierId] ?? "Unknown") : "Unknown",
      daysUntilDue,
    };

    for (const bucket of buckets) {
      if (daysUntilDue >= bucket.fromDays && daysUntilDue <= bucket.toDays) {
        bucket.bills.push(enriched);
        bucket.total += bill.balance ?? 0;
        break;
      }
    }
  }

  const grandTotal = buckets.reduce((sum, b) => sum + b.total, 0);

  return ok({
    buckets: buckets.map(({ label, total, bills }) => ({ label, total, bills, count: bills.length })),
    grandTotal,
    asOf: todayStr,
  });
}
