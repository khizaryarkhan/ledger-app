import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { db } from "@/db";
import { landingPageRequests } from "@/db/schema";
import { NextRequest } from "next/server";

const VALID_STAGES = ["new", "contacted", "qualified", "converted", "rejected", "archived"];

export async function POST(req: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Forbidden", 403);

  const { rows } = await req.json().catch(() => ({}));
  if (!Array.isArray(rows) || rows.length === 0) return bad("No rows to import");

  const valid: any[] = [];
  let skipped = 0;

  for (const row of rows) {
    const fullName = String(row.fullName ?? "").trim();
    const email    = String(row.email    ?? "").trim().toLowerCase();
    if (!fullName || !email || !email.includes("@")) { skipped++; continue; }

    valid.push({
      fullName,
      email,
      companyName:       row.companyName?.trim()       || null,
      phone:             row.phone?.trim()             || null,
      country:           row.country?.trim()           || null,
      interestedService: row.interestedService?.trim() || null,
      message:           row.message?.trim()           || null,
      source:            "import",
      status:            VALID_STAGES.includes(row.status?.toLowerCase()) ? row.status.toLowerCase() : "new",
    });
  }

  if (valid.length === 0) return bad("No valid rows — every row needs at least a name and a valid email address");

  const CHUNK = 50;
  let inserted = 0;
  for (let i = 0; i < valid.length; i += CHUNK) {
    await db.insert(landingPageRequests).values(valid.slice(i, i + CHUNK));
    inserted += Math.min(CHUNK, valid.length - i);
  }

  return ok({ inserted, skipped });
}
