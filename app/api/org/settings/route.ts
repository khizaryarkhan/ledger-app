import { db } from "@/db";
import { organisations } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [org] = await db.select({ classificationLevel: organisations.classificationLevel })
    .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  return ok({ classificationLevel: org?.classificationLevel ?? "customer" });
}

export async function PATCH(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { classificationLevel } = await req.json();
  if (!["customer", "project"].includes(classificationLevel)) return bad("Must be 'customer' or 'project'");
  await db.update(organisations).set({ classificationLevel }).where(eq(organisations.id, orgId!));
  return ok({ classificationLevel });
}
