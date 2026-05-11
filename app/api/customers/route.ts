import { db } from "@/db";
import { customers, projects, organisations, reps } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { desc, eq, and, inArray } from "drizzle-orm";

const Schema = z.object({
  name: z.string().min(1).max(255),
  code: z.string().min(1).max(64),
  country: z.string().optional(),
  currency: z.string().default("EUR"),
  paymentTerms: z.number().int().default(30),
  taxNumber: z.string().optional(),
  riskRating: z.enum(["Low", "Medium", "High"]).default("Low"),
  status: z.enum(["Active", "On Hold", "Inactive"]).default("Active"),
  creditLimit: z.number().nullable().optional(),
  accountOwnerId: z.string().uuid().nullable().optional(),
  collectionOwnerId: z.string().uuid().nullable().optional(),
  notes: z.string().optional(),
  companyName: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().optional(),
  addressStreet: z.string().optional(),
  addressCity: z.string().optional(),
  addressPostcode: z.string().optional(),
  paymentMethod: z.string().optional(),
});

export async function GET() {
  const { error, orgId, role, repId } = await requireOrg();
  if (error) return error;

  // rep or company_user with a rep assignment — scope to their customers only
  if ((role === "rep" || role === "company_user") && repId) {
    const [repRow] = await db.select({ tier: reps.tier })
      .from(reps).where(and(eq(reps.id, repId), eq(reps.orgId, orgId!))).limit(1);
    const tier = repRow?.tier ?? "rep";

    // Build the list of repIds this user can see
    let visibleRepIds: string[] = [repId];
    if (tier === "ed" || tier === "rd") {
      // ED/RD: also include all reps reporting to them
      const reportees = await db.select({ id: reps.id })
        .from(reps).where(and(eq(reps.orgId, orgId!), eq(reps.managerId, repId)));
      visibleRepIds = [repId, ...reportees.map(r => r.id)];
    }

    const [org] = await db.select({ level: organisations.classificationLevel })
      .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
    const level = org?.level ?? "customer";

    if (level === "customer") {
      const rows = await db.select().from(customers)
        .where(and(eq(customers.orgId, orgId!), inArray(customers.repId, visibleRepIds)))
        .orderBy(desc(customers.createdAt));
      return ok(rows);
    } else {
      const repProjects = await db.select({ customerId: projects.customerId })
        .from(projects).where(and(eq(projects.orgId, orgId!), inArray(projects.repId, visibleRepIds)));
      const custIds = [...new Set(repProjects.map(p => p.customerId))];
      if (custIds.length === 0) return ok([]);
      const rows = await db.select().from(customers)
        .where(and(eq(customers.orgId, orgId!), inArray(customers.id, custIds)))
        .orderBy(desc(customers.createdAt));
      return ok(rows);
    }
  }

  const rows = await db.select().from(customers).where(eq(customers.orgId, orgId!)).orderBy(desc(customers.createdAt));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  try {
    const body = await req.json();
    const data = Schema.parse(body);
    const [existing] = await db.select().from(customers).where(and(eq(customers.code, data.code), eq(customers.orgId, orgId!))).limit(1);
    if (existing) return bad(`Customer code "${data.code}" already exists`, 409);
    const [created] = await db.insert(customers).values({
      orgId: orgId!,
      name: data.name,
      code: data.code,
      country: data.country,
      currency: data.currency ?? "EUR",
      paymentTerms: data.paymentTerms ?? 30,
      taxNumber: data.taxNumber,
      riskRating: data.riskRating ?? "Low",
      status: data.status ?? "Active",
      creditLimit: data.creditLimit ?? null,
      accountOwnerId: data.accountOwnerId ?? null,
      collectionOwnerId: data.collectionOwnerId ?? null,
      notes: data.notes,
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create customer", 500);
  }
}
