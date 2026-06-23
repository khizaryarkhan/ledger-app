import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { adminEmailAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { encryptSecret } from "@/lib/crypto";
import { verifyMailbox } from "@/lib/admin-mailbox";

export const runtime = "nodejs";
export const maxDuration = 30;

function schemaMissing(e: unknown) {
  return ((e as any)?.message ?? "").toLowerCase().includes("does not exist");
}

// GET — current account (never returns the password).
export async function GET() {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;
  try {
    const [row] = await db.select().from(adminEmailAccounts).where(eq(adminEmailAccounts.userId, userId as string)).limit(1);
    if (!row) return NextResponse.json({ connected: false });
    return NextResponse.json({
      connected: true,
      emailAddress: row.emailAddress, fromName: row.fromName,
      imapHost: row.imapHost, imapPort: row.imapPort,
      smtpHost: row.smtpHost, smtpPort: row.smtpPort,
      username: row.username, status: row.status, lastError: row.lastError,
    });
  } catch (e) {
    if (schemaMissing(e)) return NextResponse.json({ connected: false, needsSetup: true });
    throw e;
  }
}

// POST — connect / update. Verifies IMAP + SMTP before saving (encrypted).
export async function POST(req: NextRequest) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const b = await req.json().catch(() => ({}));
  const emailAddress = String(b.emailAddress ?? "").trim().toLowerCase();
  const username = String(b.username ?? emailAddress).trim();
  const password = String(b.password ?? "");
  const imapHost = String(b.imapHost ?? "").trim();
  const smtpHost = String(b.smtpHost ?? "").trim();
  const imapPort = parseInt(String(b.imapPort ?? 993)) || 993;
  const smtpPort = parseInt(String(b.smtpPort ?? 465)) || 465;
  const fromName = typeof b.fromName === "string" ? b.fromName.trim() : null;

  if (!emailAddress || !password || !imapHost || !smtpHost) {
    return NextResponse.json({ error: "Email, password, IMAP host and SMTP host are required." }, { status: 400 });
  }

  // Verify the credentials actually work before storing them.
  const cfg = { emailAddress, fromName, imapHost, imapPort, smtpHost, smtpPort, username, password };
  const test = await verifyMailbox(cfg);
  if (!test.ok) return NextResponse.json({ error: `Couldn't connect — ${test.error}` }, { status: 400 });

  const passwordEnc = encryptSecret(password);
  if (!passwordEnc) return NextResponse.json({ error: "Server encryption key is not configured (ENCRYPTION_KEY)." }, { status: 503 });

  const values = {
    emailAddress, fromName, imapHost, imapPort, smtpHost, smtpPort, username,
    passwordEnc, status: "connected" as const, lastError: null, lastCheckedAt: new Date(), updatedAt: new Date(),
  };

  try {
    const [existing] = await db.select({ id: adminEmailAccounts.id }).from(adminEmailAccounts).where(eq(adminEmailAccounts.userId, userId as string)).limit(1);
    if (existing) await db.update(adminEmailAccounts).set(values).where(eq(adminEmailAccounts.id, existing.id));
    else await db.insert(adminEmailAccounts).values({ userId: userId as string, ...values });
    return NextResponse.json({ connected: true });
  } catch (e) {
    if (schemaMissing(e)) return NextResponse.json({ error: "The admin_email_accounts table isn't set up yet. Create it in Neon, then connect again." }, { status: 503 });
    throw e;
  }
}

// DELETE — disconnect.
export async function DELETE() {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;
  await db.delete(adminEmailAccounts).where(eq(adminEmailAccounts.userId, userId as string));
  return NextResponse.json({ connected: false });
}
