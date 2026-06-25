import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/admin/activities";

// PATCH — update account facets (currently the owner). Platform-admin only.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId, userName } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));
  const patch: Record<string, any> = { updatedAt: new Date() };
  if ("ownerAdminId" in body) patch.ownerAdminId = body.ownerAdminId || null;

  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  await db.update(crmAccounts).set(patch).where(eq(crmAccounts.id, params.id));
  if ("ownerAdminId" in body) {
    await logActivity({ type: "owner_assigned", title: body.ownerAdminId ? "Owner assigned" : "Owner cleared", accountId: params.id, actorId: userId, actorName: userName });
  }
  return NextResponse.json({ ok: true });
}
