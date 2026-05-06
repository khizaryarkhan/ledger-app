import { db } from "@/db";
import { projects } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const body = await req.json();
  const [updated] = await db.update(projects).set(body).where(eq(projects.id, params.id)).returning();
  if (!updated) return bad("Not found", 404);
  return ok(updated);
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  await db.delete(projects).where(eq(projects.id, params.id));
  return ok({ ok: true });
}
