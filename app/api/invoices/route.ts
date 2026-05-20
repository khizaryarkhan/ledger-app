import { db } from "@/db";
import { invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, desc, and } from "drizzle-orm";

const Schema = z.object({
  invoiceNumber: z.string().min(1).max(64),
  customerId: z.string().uuid(),
  projectId: z.string().uuid().nullable().optional(),
  invoiceDate: z.string(),
  dueDate: z.string(),
  currency: z.string().default("EUR"),
  amount: z.number(),
  taxAmount: z.number().default(0),
  total: z.number(),
  paymentTerms: z.number().int().default(30),
  paymentStatus: z.enum(["Unpaid", "Partially Paid", "Paid", "Written Off"]).default("Unpaid"),
  collectionStage: z.string().default("New"),
  collectionOwnerId: z.string().uuid().nullable().optional(),
  poNumber: z.string().optional(),
  notes: z.string().optional(),
});

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  // All roles see all invoices in their organisation — balances must match.
  return ok(await db.select().from(invoices).where(eq(invoices.orgId, orgId!)).orderBy(desc(invoices.dueDate)));
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());
    const [existing] = await db.select().from(invoices).where(and(eq(invoices.invoiceNumber, data.invoiceNumber), eq(invoices.orgId, orgId!))).limit(1);
    if (existing) return bad(`Invoice number "${data.invoiceNumber}" already exists`, 409);
    const [created] = await db.insert(invoices).values({
      orgId: orgId!,
      invoiceNumber: data.invoiceNumber,
      customerId: data.customerId,
      projectId: data.projectId ?? null,
      invoiceDate: data.invoiceDate,
      dueDate: data.dueDate,
      currency: data.currency ?? "EUR",
      amount: data.amount,
      taxAmount: data.taxAmount ?? 0,
      total: data.total,
      paid: 0,
      paymentTerms: data.paymentTerms ?? 30,
      paymentStatus: data.paymentStatus ?? "Unpaid",
      collectionStage: data.collectionStage ?? "New",
      collectionOwnerId: data.collectionOwnerId ?? null,
      poNumber: data.poNumber,
      notes: data.notes,
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create invoice", 500);
  }
}
