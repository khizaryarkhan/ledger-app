import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { leadContacts } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// PATCH — edit a contact.
export async function PATCH(req: NextRequest, { params }: { params: { id: string; contactId: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, any> = {};
  for (const k of ["name", "email", "phone", "title"]) if (typeof b[k] === "string") patch[k] = b[k].trim() || null;
  if (typeof b.isPrimary === "boolean") patch.isPrimary = b.isPrimary;
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  await db.update(leadContacts).set(patch).where(and(eq(leadContacts.id, params.contactId), eq(leadContacts.leadId, params.id)));
  return NextResponse.json({ updated: true });
}

// DELETE — remove a contact.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string; contactId: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  await db.delete(leadContacts).where(and(eq(leadContacts.id, params.contactId), eq(leadContacts.leadId, params.id)));
  return NextResponse.json({ deleted: true });
}
