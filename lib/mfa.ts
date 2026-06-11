/**
 * TOTP multi-factor auth helpers (super-admin).
 *
 * - Secret is generated with otplib and stored ENCRYPTED at rest (lib/crypto).
 * - Recovery codes are random, shown once, and stored BCRYPT-HASHED.
 * - Verification accepts a 6-digit TOTP code or a one-time recovery code.
 *
 * MFA is opt-in: a user only has it enforced once they enrol (mfaEnabled=true),
 * so this can never lock out users who haven't set it up.
 */
import { authenticator } from "otplib";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";

// Allow a ±1 step (30s) clock-skew window.
authenticator.options = { window: 1 };

const ISSUER = "Primeaccountax";

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

/** otpauth:// URI for QR enrolment in Google Authenticator / Authy / 1Password. */
export function buildOtpAuthUrl(secret: string, accountEmail: string): string {
  return authenticator.keyuri(accountEmail, ISSUER, secret);
}

/** Verify a 6-digit TOTP code against the secret. */
export function verifyTotp(token: string, secret: string): boolean {
  try {
    return authenticator.verify({ token: token.replace(/\s+/g, ""), secret });
  } catch {
    return false;
  }
}

/** Generate N human-friendly recovery codes (plaintext — show once). */
export function generateRecoveryCodes(count = 10): string[] {
  return Array.from({ length: count }, () => {
    const raw = randomBytes(5).toString("hex").toUpperCase(); // 10 hex chars
    return `${raw.slice(0, 5)}-${raw.slice(5)}`;              // e.g. A1B2C-3D4E5
  });
}

export async function hashRecoveryCodes(codes: string[]): Promise<string[]> {
  return Promise.all(codes.map((c) => bcrypt.hash(normalizeCode(c), 10)));
}

function normalizeCode(code: string): string {
  return code.replace(/\s+/g, "").toUpperCase();
}

/**
 * If `input` matches one of the stored hashed recovery codes, return the
 * remaining hashes (with the used one removed) so the caller can persist the
 * consumption. Returns null if no match.
 */
export async function consumeRecoveryCode(
  input: string,
  hashes: string[],
): Promise<string[] | null> {
  const candidate = normalizeCode(input);
  for (let i = 0; i < hashes.length; i++) {
    if (await bcrypt.compare(candidate, hashes[i])) {
      return hashes.filter((_, idx) => idx !== i);
    }
  }
  return null;
}
