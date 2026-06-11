import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAuth, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";
import { verifyTotp, consumeRecoveryCode } from "@/lib/mfa";
import { decryptSecret } from "@/lib/crypto";
import { logEvent } from "@/lib/audit";

// POST /api/auth/mfa/disable { code }
// Requires a valid TOTP or recovery code to turn MFA off and wipe the secret.
export async function POST(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const { code } = await req.json().catch(() => ({}));
  if (!code) return bad("Verification code required");

  const [u] = await db
    .select({ orgId: users.orgId, mfaSecret: users.mfaSecret, mfaEnabled: users.mfaEnabled, mfaRecoveryCodes: users.mfaRecoveryCodes })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!u) return bad("Account not found", 404);
  if (!u.mfaEnabled) return ok({ enabled: false }); // already off — idempotent

  const secret = u.mfaSecret ? decryptSecret(u.mfaSecret) : null;
  const totpOk = secret ? verifyTotp(String(code), secret) : false;
  const recoveryOk = totpOk ? false : (await consumeRecoveryCode(String(code), (u.mfaRecoveryCodes as string[]) ?? [])) !== null;
  if (!totpOk && !recoveryOk) return bad("Invalid code", 400);

  await db.update(users)
    .set({ mfaEnabled: false, mfaSecret: null, mfaRecoveryCodes: [] })
    .where(eq(users.id, userId));

  if (u.orgId) {
    await logEvent({ orgId: u.orgId, eventType: "user_role_changed", actorId: userId, actorName: (session!.user as any).name ?? null, meta: { action: "mfa_disabled" } });
  }

  return ok({ enabled: false });
}
