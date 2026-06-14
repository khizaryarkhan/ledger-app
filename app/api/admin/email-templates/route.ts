import { db } from "@/db";
import { leadEmailTemplates } from "@/db/schema";
import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { desc } from "drizzle-orm";
import { NextRequest } from "next/server";

function isTableMissingError(e: unknown): boolean {
  const msg = (e as any)?.message ?? "";
  return msg.includes("relation") && msg.includes("does not exist");
}

export async function GET() {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

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
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { name, subject, body } = await req.json().catch(() => ({}));
  if (!name?.trim())    return bad("Name is required");
  if (!subject?.trim()) return bad("Subject is required");
  if (!body?.trim())    return bad("Body is required");

  const createdBy = (session as any).user?.id ?? null;

  try {
    const [tpl] = await db.insert(leadEmailTemplates).values({
      name:      name.trim(),
      subject:   subject.trim(),
      body:      body.trim(),
      createdBy,
    }).returning();
    return ok(tpl);
  } catch (e) {
    if (isTableMissingError(e)) return bad("lead_email_templates table not initialised — run the SQL in Neon console first.", 503);
    throw e;
  }
}
