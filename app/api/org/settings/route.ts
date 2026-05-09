import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [org] = await db
    .select({
      classificationLevel: organisations.classificationLevel,
      dateFormat: organisations.dateFormat,
      currency: organisations.currency,
      logoUrl: organisations.logoUrl,
      displayName: organisations.displayName,
      name: organisations.name,
    })
    .from(organisations)
    .where(eq(organisations.id, orgId!))
    .limit(1);
  return ok({
    classificationLevel: org?.classificationLevel ?? "customer",
    dateFormat: org?.dateFormat ?? "DD MMM YYYY",
    currency: org?.currency ?? "EUR",
    logoUrl: org?.logoUrl ?? null,
    displayName: org?.displayName ?? null,
    name: org?.name ?? "",
  });
}

const ALLOWED_DATE_FORMATS = ["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "MMM DD, YYYY"];
const ALLOWED_CURRENCIES = ["EUR", "USD", "GBP", "AED", "AUD", "CAD", "CHF", "DKK", "NOK", "NZD", "SEK", "SGD", "ZAR"];

export async function PATCH(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const body = await req.json();
  const updates: Record<string, any> = { updatedAt: new Date() };

  if (body.classificationLevel !== undefined) {
    if (!["customer", "project"].includes(body.classificationLevel)) return bad("Invalid classificationLevel");
    updates.classificationLevel = body.classificationLevel;
  }
  if (body.dateFormat !== undefined) {
    if (!ALLOWED_DATE_FORMATS.includes(body.dateFormat)) return bad("Invalid dateFormat");
    updates.dateFormat = body.dateFormat;
  }
  if (body.currency !== undefined) {
    if (!ALLOWED_CURRENCIES.includes(body.currency)) return bad("Invalid currency");
    updates.currency = body.currency;
  }
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl || null;
  if (body.displayName !== undefined) updates.displayName = body.displayName || null;

  await db.update(organisations).set(updates).where(eq(organisations.id, orgId!));

  const [updated] = await db
    .select({
      classificationLevel: organisations.classificationLevel,
      dateFormat: organisations.dateFormat,
      currency: organisations.currency,
      logoUrl: organisations.logoUrl,
      displayName: organisations.displayName,
      name: organisations.name,
    })
    .from(organisations)
    .where(eq(organisations.id, orgId!))
    .limit(1);

  return ok({
    classificationLevel: updated.classificationLevel,
    dateFormat: updated.dateFormat ?? "DD MMM YYYY",
    currency: updated.currency ?? "EUR",
    logoUrl: updated.logoUrl ?? null,
    displayName: updated.displayName ?? null,
    name: updated.name,
  });
}
