import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { verifyTotp, generateRecoveryCodes, hashRecoveryCodes } from "@/lib/mfa";
import { decryptSecret } from "@/lib/crypto";
import { logEvent } from "@/lib/audit";

// POST /api/auth/mfa/enable { code }
// Verifies a TOTP code against the pending secret, enables MFA, and returns
// one-time recovery codes (shown to the user exactly once).
export async function POST(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const { code } = await req.json().catch(() => ({}));
  if (!code) return bad("Verification code required");

  const [u] = await db
    .select({ role: users.role, orgId: users.orgId, mfaSecret: users.mfaSecret, mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return bad("Account not found", 404);
  if (u.role !== "super_admin" && u.role !== "platform_admin") return bad("MFA is available to platform admins", 403);
  if (u.mfaEnabled) return bad("MFA is already enabled", 409);
  if (!u.mfaSecret) return bad("Start setup first", 400);

  const secret = decryptSecret(u.mfaSecret);
  if (!secret || !verifyTotp(String(code), secret)) {
    return bad("Invalid code — check your authenticator app and try again", 400);
  }

  const recoveryCodes = generateRecoveryCodes();
  const hashed = await hashRecoveryCodes(recoveryCodes);

  await db.update(users)
    .set({ mfaEnabled: true, mfaRecoveryCodes: hashed })
    .where(eq(users.id, userId));

  if (u.orgId) {
    await logEvent({ orgId: u.orgId, eventType: "user_role_changed", actorId: userId, actorName: (session!.user as any).name ?? null, meta: { action: "mfa_enabled" } });
  }

  // Plaintext codes returned ONCE — the client must show + let the user save them.
  return ok({ enabled: true, recoveryCodes });
}
