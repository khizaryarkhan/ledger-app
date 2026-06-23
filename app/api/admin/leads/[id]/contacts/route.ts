import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { leadContacts, landingPageRequests } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

function schemaMissing(e: unknown) {
  return ((e as any)?.message ?? "").toLowerCase().includes("does not exist");
}

// GET — contacts for a lead. If none stored yet, synthesize a primary contact
// from the lead record so existing leads always show their main person.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  try {
    const rows = await db.select().from(leadContacts)
      .where(eq(leadContacts.leadId, params.id))
      .orderBy(asc(leadContacts.createdAt));
    if (rows.length > 0) return NextResponse.json({ contacts: rows, synthesized: false });
  } catch (e) {
    if (!schemaMissing(e)) throw e;
    // fall through to synthesize
  }

  const [lead] = await db.select({ fullName: landingPageRequests.fullName, email: landingPageRequests.email, phone: landingPageRequests.phone })
    .from(landingPageRequests).where(eq(landingPageRequests.id, params.id)).limit(1);
  const contacts = lead ? [{ id: "primary", leadId: params.id, name: lead.fullName, email: lead.email, phone: lead.phone, title: null, isPrimary: true, createdAt: null }] : [];
  return NextResponse.json({ contacts, synthesized: true });
}

// POST — add a contact to a lead.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });

  try {
    const [row] = await db.insert(leadContacts).values({
      leadId: params.id, name,
      email: b.email?.trim() || null, phone: b.phone?.trim() || null,
      title: b.title?.trim() || null, isPrimary: !!b.isPrimary,
    }).returning();
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (schemaMissing(e)) return NextResponse.json({ error: "The lead_contacts table isn't set up yet. Create it in Neon, then add contacts." }, { status: 503 });
    throw e;
  }
}
