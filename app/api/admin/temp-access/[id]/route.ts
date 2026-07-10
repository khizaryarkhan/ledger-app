import { NextResponse } from "next/server";
import { db } from "@/db";
import { tempAccessRequests, users } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema = z.object({
  action:     z.enum(["approve", "reject"]),
  // days of access granted (admin chooses). Required when action=approve.
  daysAccess: z.number().int().min(1).max(90).optional(),
  adminNotes: z.string().max(500).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const body   = await req.json().catch(() => ({}));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { action, daysAccess, adminNotes } = parsed.data;
  // An approval without a duration produces expiresAt=null, which the access
  // check rejects — the admin thinks they granted access but granted nothing.
  if (action === "approve" && !daysAccess) {
    return NextResponse.json({ error: "daysAccess is required when approving (1-90 days)" }, { status: 400 });
  }

  const [existing] = await db
    .select({ id: tempAccessRequests.id, status: tempAccessRequests.status })
    .from(tempAccessRequests)
    .where(eq(tempAccessRequests.id, params.id))
    .limit(1);

  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (existing.status !== "pending") {
    return NextResponse.json({ error: "Request already reviewed" }, { status: 409 });
  }

  const expiresAt = action === "approve" && daysAccess
    ? new Date(Date.now() + daysAccess * 86_400_000)
    : null;

  await db.update(tempAccessRequests).set({
    status:            action === "approve" ? "approved" : "rejected",
    reviewedByAdminId: userId ?? null,
    reviewedAt:        new Date(),
    expiresAt,
    adminNotes:        adminNotes ?? null,
    updatedAt:         new Date(),
  }).where(eq(tempAccessRequests.id, params.id));

  return NextResponse.json({ ok: true });
}
