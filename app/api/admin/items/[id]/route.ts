import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { catalogItems } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({}));
  const patch: Record<string, any> = { updatedAt: new Date() };
  if (typeof b.name === "string" && b.name.trim()) patch.name = b.name.trim();
  if (typeof b.description === "string") patch.description = b.description.trim() || null;
  if (b.unitAmount != null && !isNaN(Number(b.unitAmount))) patch.unitAmount = Math.max(0, Math.round(Number(b.unitAmount)));
  if (typeof b.currency === "string" && b.currency.length === 3) patch.currency = b.currency.toLowerCase();
  if (b.taxRate !== undefined) patch.taxRate = b.taxRate == null ? null : Math.max(0, Math.min(100, parseInt(String(b.taxRate))));
  if (typeof b.active === "boolean") patch.active = b.active;
  await db.update(catalogItems).set(patch).where(eq(catalogItems.id, params.id));
  return NextResponse.json({ updated: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  await db.delete(catalogItems).where(eq(catalogItems.id, params.id));
  return NextResponse.json({ deleted: true });
}
