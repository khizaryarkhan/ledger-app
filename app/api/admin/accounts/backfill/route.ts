import { requirePlatformAdmin } from "@/lib/billing";
import { backfillAllAccounts } from "@/lib/admin/accounts";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 60;

// POST — run the idempotent account backfill in the app runtime (where
// DATABASE_URL exists). Super/platform-admin only. Safe to run repeatedly.
export async function POST() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  try {
    const counts = await backfillAllAccounts();
    return NextResponse.json({ ok: true, ...counts });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Backfill failed" }, { status: 500 });
  }
}
