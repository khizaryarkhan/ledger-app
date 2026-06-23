import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { guidePages } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_GUIDES } from "@/lib/guide-content";

function isSchemaMissing(e: unknown): boolean {
  const m = ((e as any)?.message ?? "").toLowerCase();
  return m.includes("does not exist") && (m.includes("relation") || m.includes("column"));
}

// GET — admin editor load (platform admin). Same content as the public read,
// but always returns a usable shape (defaults when no row/table).
export async function GET(_req: NextRequest, { params }: { params: { key: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const key = params.key === "admin" ? "admin" : "customer";
  const fallback = DEFAULT_GUIDES[key];
  try {
    const [row] = await db.select().from(guidePages).where(eq(guidePages.key, key)).limit(1);
    if (!row) return NextResponse.json({ ...fallback, _source: "default" });
    return NextResponse.json({
      title:    row.title || fallback.title,
      subtitle: row.subtitle || fallback.subtitle,
      sections: Array.isArray(row.sections) ? row.sections : fallback.sections,
      _source:  "db",
    });
  } catch (e) {
    if (isSchemaMissing(e)) return NextResponse.json({ ...fallback, _source: "default" });
    throw e;
  }
}

// PUT — save the guide (platform admin). Upserts by key.
export async function PUT(req: NextRequest, { params }: { params: { key: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const key = params.key === "admin" ? "admin" : "customer";
  const body = await req.json().catch(() => ({}));
  const { title, subtitle, sections } = body || {};

  if (typeof title !== "string" || !title.trim()) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!Array.isArray(sections)) return NextResponse.json({ error: "Sections must be an array" }, { status: 400 });

  const values = {
    title: title.trim(),
    subtitle: typeof subtitle === "string" ? subtitle : "",
    sections,
    updatedAt: new Date(),
    updatedBy: (userId as string) ?? null,
  };

  try {
    const [existing] = await db.select({ id: guidePages.id }).from(guidePages).where(eq(guidePages.key, key)).limit(1);
    if (existing) {
      await db.update(guidePages).set(values).where(eq(guidePages.id, existing.id));
    } else {
      await db.insert(guidePages).values({ key, ...values });
    }
    return NextResponse.json({ saved: true });
  } catch (e) {
    if (isSchemaMissing(e)) {
      return NextResponse.json(
        { error: "The guide_pages table isn't set up yet. Create it in Neon, then save again." },
        { status: 503 },
      );
    }
    throw e;
  }
}
