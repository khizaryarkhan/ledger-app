import { db } from "@/db";
import { reps } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const all = await db.select().from(reps).where(eq(reps.orgId, orgId!));
  return ok(all);
}

export async function POST(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { name, email } = await req.json();
  if (!name?.trim()) return bad("Name is required");
  const [rep] = await db.insert(reps).values({ orgId: orgId!, name: name.trim(), email: email?.trim() || null }).returning();
  return ok(rep);
}

export async function DELETE(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);
  const { id } = await req.json();
  if (!id) return bad("id required");
  await db.delete(reps).where(and(eq(reps.id, id), eq(reps.orgId, orgId!)));
  return ok({ deleted: true });
}
