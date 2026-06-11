import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { generateMfaSecret, buildOtpAuthUrl } from "@/lib/mfa";
import { encryptSecret } from "@/lib/crypto";
import QRCode from "qrcode";

// POST /api/auth/mfa/setup
// Begins enrolment: generates a fresh secret (stored encrypted, NOT yet enabled)
// and returns the otpauth URL, a QR data-URL, and the secret for manual entry.
export async function POST() {
  const { error, session } = await requireAuth();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const [u] = await db
    .select({ role: users.role, email: users.email, mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return bad("Account not found", 404);
  if (u.role !== "super_admin") return bad("MFA is available to super admins", 403);
  if (u.mfaEnabled) return bad("MFA is already enabled. Disable it first to re-enrol.", 409);

  const secret = generateMfaSecret();
  const otpauthUrl = buildOtpAuthUrl(secret, u.email);

  // Store the pending secret encrypted; mfaEnabled stays false until verified.
  await db.update(users).set({ mfaSecret: encryptSecret(secret) }).where(eq(users.id, userId));

  const qrDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 220 });

  return ok({ secret, otpauthUrl, qrDataUrl });
}
