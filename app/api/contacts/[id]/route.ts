import { db } from "@/db";
import { contacts } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json();
  const [updated] = await db.update(contacts).set(body).where(eq(contacts.id, params.id)).returning();
  if (!updated) return bad("Not found", 404);
  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(contacts).where(eq(contacts.id, params.id));
  return ok({ ok: true });
}
