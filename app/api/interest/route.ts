import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { landingPageRequests } from "@/db/schema";
import { rateLimit } from "@/lib/rate-limit";

// Simple server-side validation
function validateEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export async function POST(req: NextRequest) {
  // Rate limit: max 5 submissions per IP per hour
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const rl  = await rateLimit(`interest:${ip}`, 5, 3600).catch(() => ({ ok: true }));
  if (!(rl as any).ok) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const fullName    = typeof body.fullName === "string" ? body.fullName.trim().slice(0, 255) : "";
  const email       = typeof body.email === "string" ? body.email.trim().toLowerCase().slice(0, 255) : "";
  const companyName = typeof body.companyName === "string" ? body.companyName.trim().slice(0, 255) : null;
  const phone       = typeof body.phone === "string" ? body.phone.trim().slice(0, 64) : null;
  const country     = typeof body.country === "string" ? body.country.trim().slice(0, 100) : null;
  const companySize = typeof body.companySize === "string" ? body.companySize.trim().slice(0, 64) : null;
  const interestedService = typeof body.interestedService === "string" ? body.interestedService.trim().slice(0, 128) : null;
  const message     = typeof body.message === "string" ? body.message.trim().slice(0, 2000) : null;
  const utmSource   = typeof body.utmSource === "string" ? body.utmSource.slice(0, 128) : null;
  const utmMedium   = typeof body.utmMedium === "string" ? body.utmMedium.slice(0, 128) : null;
  const utmCampaign = typeof body.utmCampaign === "string" ? body.utmCampaign.slice(0, 128) : null;

  if (!fullName) return NextResponse.json({ error: "Full name is required" }, { status: 400 });
  if (!email || !validateEmail(email)) return NextResponse.json({ error: "A valid email address is required" }, { status: 400 });

  // One company = one account (account_id is NOT NULL) — resolve before insert.
  const { ensureAccount } = await import("@/lib/admin/accounts");
  const accountId = await ensureAccount({ name: companyName || fullName, email, country });

  await db.insert(landingPageRequests).values({
    fullName,
    email,
    companyName,
    phone,
    country,
    companySize,
    interestedService,
    message,
    source:    "landing_page",
    status:    "new",
    accountId,
    utmSource,
    utmMedium,
    utmCampaign,
  });

  return NextResponse.json({ success: true });
}
