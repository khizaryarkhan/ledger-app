import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

// GET — the signed-in admin's own profile bits (scheduling link).
export async function GET() {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;
  const [u] = await db.select({ schedulingUrl: users.schedulingUrl, name: users.name, email: users.email })
    .from(users).where(eq(users.id, userId!)).limit(1);
  return NextResponse.json({ schedulingUrl: u?.schedulingUrl ?? null, name: u?.name, email: u?.email });
}

// PATCH — update the signed-in admin's scheduling link.
export async function PATCH(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({} as any));
  let url: string | null = typeof b.schedulingUrl === "string" ? b.schedulingUrl.trim() : null;
  if (url && !/^https?:\/\//i.test(url)) url = `https://${url}`;
  await db.update(users).set({ schedulingUrl: url || null }).where(eq(users.id, userId!));
  return NextResponse.json({ ok: true, schedulingUrl: url || null });
}
