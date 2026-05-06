import { db } from "@/db";
import { invoices, customers, projects } from "@/db/schema";
import { requireAuth, ok, bad } from "@/lib/api";
import { z } from "zod";
import { inArray } from "drizzle-orm";

const RowSchema = z.object({
  invoiceNumber: z.string(),
  customerCode: z.string(),
  projectCode: z.string().optional(),
  invoiceDate: z.string(),
  dueDate: z.string(),
  amount: z.number(),
  taxAmount: z.number().default(0),
  currency: z.string().optional(),
  poNumber: z.string().optional(),
});

export async function POST(req: Request) {
  const { error } = await requireAuth();
  if (error) return error;
  try {
    const body = await req.json();
    const rows = z.array(RowSchema).parse(body.rows);

    if (rows.length === 0) return bad("No rows to import");

    const codes = [...new Set(rows.map(r => r.customerCode))];
    const projCodes = [...new Set(rows.map(r => r.projectCode).filter(Boolean) as string[])];
    const existingInvNums = [...new Set(rows.map(r => r.invoiceNumber))];

    const customerRows = codes.length > 0 ? await db.select().from(customers).where(inArray(customers.code, codes)) : [];
    const projectRows = projCodes.length > 0 ? await db.select().from(projects).where(inArray(projects.code, projCodes)) : [];
    const dupRows = existingInvNums.length > 0 ? await db.select().from(invoices).where(inArray(invoices.invoiceNumber, existingInvNums)) : [];

    const customerByCode = new Map(customerRows.map(c => [c.code, c]));
    const projectByCode = new Map(projectRows.map(p => [p.code, p]));
    const dupSet = new Set(dupRows.map(d => d.invoiceNumber));

    const valid: any[] = [];
    const errors: { row: number; message: string }[] = [];

    rows.forEach((r, idx) => {
      const cust = customerByCode.get(r.customerCode);
      if (!cust) { errors.push({ row: idx + 2, message: `Unknown customer code: ${r.customerCode}` }); return; }
      if (dupSet.has(r.invoiceNumber)) { errors.push({ row: idx + 2, message: `Duplicate invoice number: ${r.invoiceNumber}` }); return; }
      const proj = r.projectCode ? projectByCode.get(r.projectCode) : null;
      valid.push({
        invoiceNumber: r.invoiceNumber,
        customerId: cust.id,
        projectId: proj?.id || null,
        invoiceDate: r.invoiceDate,
        dueDate: r.dueDate,
        currency: r.currency || cust.currency,
        amount: r.amount,
        taxAmount: r.taxAmount || 0,
        total: r.amount + (r.taxAmount || 0),
        paid: 0,
        paymentTerms: cust.paymentTerms,
        paymentStatus: "Unpaid" as const,
        collectionStage: "New",
        collectionOwnerId: cust.collectionOwnerId,
        poNumber: r.poNumber || "",
      });
    });

    if (valid.length > 0) await db.insert(invoices).values(valid);

    return ok({ imported: valid.length, errors });
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Import failed", 500);
  }
}
