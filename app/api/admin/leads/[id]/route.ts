import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { landingPageRequests } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq } from "drizzle-orm";

const VALID_STATUSES = ["new", "contacted", "qualified", "converted", "rejected", "archived"];

// GET — a single lead record (for the 360° workspace).
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const [lead] = await db.select().from(landingPageRequests).where(eq(landingPageRequests.id, params.id)).limit(1);
  if (!lead) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(lead);
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const updates: Record<string, any> = { updatedAt: new Date() };

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }
    updates.status = body.status;
  }
  if (typeof body.adminNotes === "string") updates.adminNotes = body.adminNotes.slice(0, 5000);
  if (typeof body.assignedToAdminId === "string") updates.assignedToAdminId = body.assignedToAdminId;

  await db.update(landingPageRequests).set(updates).where(eq(landingPageRequests.id, params.id));
  return NextResponse.json({ success: true });
}
