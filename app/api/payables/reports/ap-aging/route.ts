import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apSuppliers } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";

export async function GET(_req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const today = new Date().toISOString().split("T")[0];

  const bills = await db.select().from(apBills)
    .where(and(
      eq(apBills.orgId, orgId!),
      ne(apBills.accountingPaymentStatus, "Paid"),
    ));

  const supplierMap: Record<string, {
    supplierId: string;
    supplierName: string;
    current:     number;
    days_1_30:   number;
    days_31_60:  number;
    days_61_90:  number;
    days_90_plus: number;
    total:       number;
  }> = {};

  const supplierIds = [...new Set(bills.map((b) => b.supplierId).filter(Boolean) as string[])];

  const suppliers = supplierIds.length > 0
    ? await db.select().from(apSuppliers)
        .where(eq(apSuppliers.orgId, orgId!))
    : [];

  const supplierNameMap: Record<string, string> = {};
  for (const s of suppliers) {
    supplierNameMap[s.id] = s.displayName || s.name;
  }

  for (const bill of bills) {
    const sid  = bill.supplierId ?? "unknown";
    const name = supplierNameMap[sid] ?? "Unknown Supplier";
    const bal  = bill.balance ?? 0;

    if (!supplierMap[sid]) {
      supplierMap[sid] = {
        supplierId:   sid,
        supplierName: name,
        current:      0,
        days_1_30:    0,
        days_31_60:   0,
        days_61_90:   0,
        days_90_plus: 0,
        total:        0,
      };
    }

    supplierMap[sid].total += bal;

    if (!bill.dueDate || bill.dueDate >= today) {
      supplierMap[sid].current += bal;
    } else {
      const daysPast = Math.floor((Date.now() - new Date(bill.dueDate).getTime()) / (1000 * 60 * 60 * 24));
      if (daysPast <= 30)      supplierMap[sid].days_1_30   += bal;
      else if (daysPast <= 60) supplierMap[sid].days_31_60  += bal;
      else if (daysPast <= 90) supplierMap[sid].days_61_90  += bal;
      else                     supplierMap[sid].days_90_plus += bal;
    }
  }

  const supplierList = Object.values(supplierMap);

  const totals = supplierList.reduce(
    (acc, s) => ({
      current:      acc.current      + s.current,
      days_1_30:    acc.days_1_30    + s.days_1_30,
      days_31_60:   acc.days_31_60   + s.days_31_60,
      days_61_90:   acc.days_61_90   + s.days_61_90,
      days_90_plus: acc.days_90_plus + s.days_90_plus,
      grand_total:  acc.grand_total  + s.total,
    }),
    { current: 0, days_1_30: 0, days_31_60: 0, days_61_90: 0, days_90_plus: 0, grand_total: 0 },
  );

  return ok({ suppliers: supplierList, totals });
}
