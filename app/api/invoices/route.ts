import { db } from "@/db";
import { invoices, customers, projects, organisations, reps } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { eq, desc, and, inArray } from "drizzle-orm";

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
  const { error, orgId, role, repId } = await requireOrg();
  if (error) return error;

  // Rep role: only return invoices for this rep's assigned customers/projects
  if ((role === "rep" || role === "company_user") && repId) {
    const [repRow] = await db.select({ tier: reps.tier })
      .from(reps).where(and(eq(reps.id, repId), eq(reps.orgId, orgId!))).limit(1);
    const tier = repRow?.tier ?? "rep";

    // Build the list of repIds this user can see
    let visibleRepIds: string[] = [repId];
    if (tier === "ed" || tier === "rd") {
      const reportees = await db.select({ id: reps.id })
        .from(reps).where(and(eq(reps.orgId, orgId!), eq(reps.managerId, repId)));
      visibleRepIds = [repId, ...reportees.map(r => r.id)];
    }

    const [org] = await db.select({ level: organisations.classificationLevel })
      .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
    const level = org?.level ?? "customer";

    if (level === "project") {
      const repProjects = await db.select({ id: projects.id })
        .from(projects).where(and(eq(projects.orgId, orgId!), inArray(projects.repId, visibleRepIds)));
      if (repProjects.length === 0) return ok([]);
      const projectIds = repProjects.map(p => p.id);
      return ok(await db.select().from(invoices)
        .where(and(eq(invoices.orgId, orgId!), inArray(invoices.projectId, projectIds)))
        .orderBy(desc(invoices.dueDate)));
    } else {
      const repCustomers = await db.select({ id: customers.id })
        .from(customers).where(and(eq(customers.orgId, orgId!), inArray(customers.repId, visibleRepIds)));
      if (repCustomers.length === 0) return ok([]);
      const customerIds = repCustomers.map(c => c.id);
      return ok(await db.select().from(invoices)
        .where(and(eq(invoices.orgId, orgId!), inArray(invoices.customerId, customerIds)))
        .orderBy(desc(invoices.dueDate)));
    }
  }

  return ok(await db.select().from(invoices).where(eq(invoices.orgId, orgId!)).orderBy(desc(invoices.dueDate)));
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const data = Schema.parse(await req.json());
    const [existing] = await db.select().from(invoices).where(eq(invoices.invoiceNumber, data.invoiceNumber)).limit(1);
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
