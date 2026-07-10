import { db } from "@/db";
import { leadEmailTemplates } from "@/db/schema";
import { ok, bad } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { desc } from "drizzle-orm";
import { NextRequest } from "next/server";

function isTableMissingError(e: unknown): boolean {
  const msg = (e as any)?.message ?? "";
  return msg.includes("relation") && msg.includes("does not exist");
}

export async function GET() {
  const { error } = await requirePlatformAdmin(); // DB-revalidated
  if (error) return error;

  try {
    const templates = await db
      .select()
      .from(leadEmailTemplates)
      .orderBy(desc(leadEmailTemplates.createdAt));
    return ok(templates);
  } catch (e) {
    if (isTableMissingError(e)) return ok([]);
    throw e;
  }
}

export async function POST(req: NextRequest) {
  const { error, userId: actorId } = await requirePlatformAdmin(); // DB-revalidated
  if (error) return error;

  const { name, subject, body, stage } = await req.json().catch(() => ({}));
  if (!name?.trim())    return bad("Name is required");
  if (!subject?.trim()) return bad("Subject is required");
  if (!body?.trim())    return bad("Body is required");

  const createdBy = actorId ?? null;

  try {
    const [tpl] = await db.insert(leadEmailTemplates).values({
      name:      name.trim(),
      subject:   subject.trim(),
      body:      body.trim(),
      stage:     stage?.trim() || null,
      createdBy,
    }).returning();
    return ok(tpl);
  } catch (e) {
    if (isTableMissingError(e)) return bad("lead_email_templates table not initialised — run the SQL in Neon console first.", 503);
    throw e;
  }
}
