import { db } from "@/db";
import { leadEmailTemplates } from "@/db/schema";
import { ok, bad } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin(); // DB-revalidated
  if (error) return error;

  const { name, subject, body, stage } = await req.json().catch(() => ({}));
  if (!name?.trim())    return bad("Name is required");
  if (!subject?.trim()) return bad("Subject is required");
  if (!body?.trim())    return bad("Body is required");

  const [tpl] = await db
    .update(leadEmailTemplates)
    .set({ name: name.trim(), subject: subject.trim(), body: body.trim(), stage: stage?.trim() || null, updatedAt: new Date() })
    .where(eq(leadEmailTemplates.id, params.id))
    .returning();

  if (!tpl) return bad("Template not found", 404);
  return ok(tpl);
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin(); // DB-revalidated
  if (error) return error;

  await db.delete(leadEmailTemplates).where(eq(leadEmailTemplates.id, params.id));
  return ok({ deleted: true });
}
