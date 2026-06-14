import { db } from "@/db";
import { leadNotes, users } from "@/db/schema";
import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { eq, asc } from "drizzle-orm";
import { NextRequest } from "next/server";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const notes = await db
    .select({
      id:         leadNotes.id,
      body:       leadNotes.body,
      authorName: leadNotes.authorName,
      authorId:   leadNotes.authorId,
      createdAt:  leadNotes.createdAt,
    })
    .from(leadNotes)
    .where(eq(leadNotes.leadId, params.id))
    .orderBy(asc(leadNotes.createdAt));

  return ok(notes);
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { body } = await req.json().catch(() => ({}));
  if (!body?.trim()) return bad("Note body is required");

  const authorName = (session as any).user?.name ?? "Admin";
  const authorId   = (session as any).user?.id ?? null;

  const [note] = await db.insert(leadNotes).values({
    leadId:     params.id,
    authorId,
    authorName,
    body:       body.trim(),
  }).returning();

  return ok(note, 201);
}
