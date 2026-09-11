import { db } from "@/db";
import { countries } from "@/db/schema";
import { requireOrg, requireReadScope, ok, bad } from "@/lib/api";
import { eq, and, inArray } from "drizzle-orm";

export async function GET() {
  const { error, orgIds } = await requireReadScope();
  if (error) return error;
  const all = await db.select().from(countries).where(inArray(countries.orgId, orgIds));
  return ok(all);
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { name } = await req.json();
  if (!name?.trim()) return bad("Name is required");
  const [country] = await db.insert(countries).values({ orgId: orgId!, name: name.trim() }).returning();
  return ok(country);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { id } = await req.json();
  if (!id) return bad("id required");
  await db.delete(countries).where(and(eq(countries.id, id), eq(countries.orgId, orgId!)));
  return ok({ deleted: true });
}
