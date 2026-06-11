/**
 * Field-level encryption for secrets at rest (SMTP password, OAuth tokens).
 *
 * AES-256-GCM with a per-value random IV and auth tag. The key is derived from
 * ENCRYPTION_KEY (preferred) or AUTH_SECRET, so encryption activates on deploy
 * with no extra setup — but rotating to a dedicated ENCRYPTION_KEY is advised.
 *
 * BACKWARD COMPATIBLE: decryptSecret() passes through any value that lacks the
 * "enc:v1:" prefix, so existing plaintext rows keep working. New writes are
 * encrypted. This lets you deploy without a data migration; rows get encrypted
 * naturally as they're next written (reconnect / re-save), or via a one-off
 * re-encrypt script if you want to convert them all at once.
 */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from "crypto";

const PREFIX = "enc:v1:";
const secret = process.env.ENCRYPTION_KEY || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
const KEY: Buffer | null = secret ? createHash("sha256").update(secret).digest() : null;

let warnedNoKey = false;
function noKeyWarn() {
  if (!warnedNoKey) {
    warnedNoKey = true;
    console.warn("lib/crypto: no ENCRYPTION_KEY/AUTH_SECRET set — secrets stored as plaintext");
  }
}

/** Encrypt a secret for storage. Null/undefined pass through unchanged. */
export function encryptSecret(plain: string | null | undefined): string | null {
  if (plain == null) return null;
  if (!KEY) { noKeyWarn(); return plain; }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ct]).toString("base64");
}

/** Decrypt a stored secret. Legacy (unprefixed) plaintext is returned as-is. */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (stored == null) return null;
  if (!stored.startsWith(PREFIX)) return stored; // legacy plaintext
  if (!KEY) { noKeyWarn(); return stored; }
  try {
    const raw = Buffer.from(stored.slice(PREFIX.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch (e: any) {
    console.error("lib/crypto: decrypt failed —", e?.message);
    return null; // corrupt/forged value — never return the raw ciphertext
  }
}
