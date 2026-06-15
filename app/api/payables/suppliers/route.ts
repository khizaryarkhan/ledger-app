import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apSuppliers } from "@/db/schema";
import { eq, and, ilike, or } from "drizzle-orm";
import { z } from "zod";

const CreateSchema = z.object({
  name:         z.string().min(1).max(255),
  displayName:  z.string().max(255).optional(),
  code:         z.string().max(64).optional(),
  email:        z.string().email().optional().nullable(),
  phone:        z.string().max(64).optional().nullable(),
  address:      z.string().optional().nullable(),
  country:      z.string().max(64).optional().nullable(),
  currency:     z.string().max(8).default("EUR"),
  paymentTerms: z.number().int().default(30),
  taxNumber:    z.string().max(64).optional().nullable(),
  status:       z.enum(["Active", "Inactive", "Suspended"]).default("Active"),
  riskRating:   z.enum(["Low", "Medium", "High"]).default("Low"),
  notes:        z.string().optional().nullable(),
});

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const search = searchParams.get("search");

  let query = db.select().from(apSuppliers).where(eq(apSuppliers.orgId, orgId!)).$dynamic();

  const conditions = [eq(apSuppliers.orgId, orgId!)];
  if (status) conditions.push(eq(apSuppliers.status, status));
  if (search) {
    conditions.push(
      or(
        ilike(apSuppliers.name, `%${search}%`),
        ilike(apSuppliers.displayName, `%${search}%`),
        ilike(apSuppliers.email, `%${search}%`),
        ilike(apSuppliers.code, `%${search}%`),
      ) as any,
    );
  }

  const rows = await db.select().from(apSuppliers).where(and(...conditions));
  return ok(rows);
}

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;

  if (role !== "company_admin" && !isSuperAdmin(session)) {
    return bad("Forbidden", 403);
  }

  try {
    const data = CreateSchema.parse(await req.json());
    const [created] = await db.insert(apSuppliers).values({
      orgId:        orgId!,
      name:         data.name,
      displayName:  data.displayName ?? null,
      code:         data.code ?? null,
      email:        data.email ?? null,
      phone:        data.phone ?? null,
      address:      data.address ?? null,
      country:      data.country ?? null,
      currency:     data.currency,
      paymentTerms: data.paymentTerms,
      taxNumber:    data.taxNumber ?? null,
      status:       data.status,
      riskRating:   data.riskRating,
      notes:        data.notes ?? null,
      source:       "manual",
    }).returning();
    return ok(created);
  } catch (e: any) {
    if (e?.issues) return bad(e.issues[0].message);
    console.error(e);
    return bad("Failed to create supplier", 500);
  }
}
