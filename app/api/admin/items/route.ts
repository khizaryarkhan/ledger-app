import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { catalogItems } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";

function schemaMissing(e: unknown) {
  return ((e as any)?.message ?? "").toLowerCase().includes("does not exist");
}

// GET — the item catalog (active first).
export async function GET() {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  try {
    const rows = await db.select().from(catalogItems).orderBy(desc(catalogItems.active), desc(catalogItems.updatedAt));
    return NextResponse.json({ items: rows });
  } catch (e) {
    if (schemaMissing(e)) return NextResponse.json({ items: [], needsSetup: true });
    throw e;
  }
}

// POST — create an item.
export async function POST(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;
  const b = await req.json().catch(() => ({}));
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  try {
    const [row] = await db.insert(catalogItems).values({
      name,
      description: b.description?.trim() || null,
      unitAmount: b.unitAmount != null && !isNaN(Number(b.unitAmount)) ? Math.max(0, Math.round(Number(b.unitAmount))) : 0,
      currency: typeof b.currency === "string" && b.currency.length === 3 ? b.currency.toLowerCase() : "eur",
      taxRate: b.taxRate != null && !isNaN(Number(b.taxRate)) ? Math.max(0, Math.min(100, parseInt(String(b.taxRate)))) : null,
      active: b.active !== false,
      createdBy: (userId as string) || null,
    }).returning();
    return NextResponse.json(row, { status: 201 });
  } catch (e) {
    if (schemaMissing(e)) return NextResponse.json({ error: "The catalog_items table isn't set up yet. Create it in Neon, then add items." }, { status: 503 });
    throw e;
  }
}
