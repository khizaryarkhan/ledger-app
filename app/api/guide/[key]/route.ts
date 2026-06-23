import { requireAuth } from "@/lib/api";
import { db } from "@/db";
import { guidePages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GUIDES } from "@/lib/guide-content";

// Read a guide. Any authenticated app user may read (customers read /guide).
// Falls back to the built-in defaults if the row — or the table — is missing.
export async function GET(_req: NextRequest, { params }: { params: { key: string } }) {
  const { error } = await requireAuth();
  if (error) return error;

  const key = params.key === "admin" ? "admin" : "customer";
  const fallback = DEFAULT_GUIDES[key];

  try {
    const [row] = await db.select().from(guidePages).where(eq(guidePages.key, key)).limit(1);
    if (!row) return NextResponse.json(fallback);
    return NextResponse.json({
      title:    row.title || fallback.title,
      subtitle: row.subtitle || fallback.subtitle,
      sections: Array.isArray(row.sections) && (row.sections as any[]).length ? row.sections : fallback.sections,
    });
  } catch {
    // Table not created yet — serve the built-in content so the page still works.
    return NextResponse.json(fallback);
  }
}
