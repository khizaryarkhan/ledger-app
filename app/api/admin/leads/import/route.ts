import { ok, bad } from "@/lib/api";
import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { landingPageRequests } from "@/db/schema";
import { NextRequest } from "next/server";

const VALID_STAGES = ["new", "contacted", "qualified", "converted", "rejected", "archived"];

export async function POST(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const { rows } = await req.json().catch(() => ({}));
  if (!Array.isArray(rows) || rows.length === 0) return bad("No rows to import");

  const { ensureAccount } = await import("@/lib/admin/accounts");
  const valid: any[] = [];
  let skipped = 0;

  for (const row of rows) {
    const fullName = String(row.fullName ?? "").trim();
    const email    = String(row.email    ?? "").trim().toLowerCase();
    if (!fullName || !email || !email.includes("@")) { skipped++; continue; }

    const companyName = row.companyName?.trim() || null;
    const country     = row.country?.trim()     || null;
    // One company = one account (account_id is NOT NULL); dedups across the import.
    const accountId = await ensureAccount({ name: companyName || fullName, email, country });

    valid.push({
      fullName,
      email,
      companyName,
      phone:             row.phone?.trim()             || null,
      country,
      interestedService: row.interestedService?.trim() || null,
      message:           row.message?.trim()           || null,
      source:            "import",
      status:            VALID_STAGES.includes(row.status?.toLowerCase()) ? row.status.toLowerCase() : "new",
      accountId,
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
