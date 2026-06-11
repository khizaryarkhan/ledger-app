/**
 * Tamper-proof OAuth `state` for integration connect flows (QBO, Xero, Gmail, MS).
 *
 * The callback endpoints are necessarily public (the provider redirects an
 * unauthenticated browser to them). Previously `state` was a plain
 * `orgId:userId` string, so anyone could forge it and bind a connection to an
 * arbitrary org. We now sign the state with an HMAC keyed on AUTH_SECRET and
 * embed a short expiry, so the callback can trust orgId/userId without a DB
 * round-trip and an attacker cannot mint a valid state for an org they don't
 * control.
 *
 * Stateless by design (no table, no session) so it works on serverless.
 * Fail-closed: if AUTH_SECRET is unset or the signature/expiry is bad,
 * verification returns null and the callback must reject the request.
 */
import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
const TTL_MS = 10 * 60 * 1000; // a connect flow should complete well within 10 min

function sign(payload: string): string {
  return createHmac("sha256", SECRET).update(payload).digest("base64url");
}

/** Build a signed state token: `orgId:userId:exp:sig`. */
export function signOAuthState(orgId: string, userId: string): string {
  const exp = Date.now() + TTL_MS;
  const payload = `${orgId}:${userId}:${exp}`;
  return `${payload}:${sign(payload)}`;
}

/**
 * Verify a state token. Returns { orgId, userId } only if the signature is
 * valid and the token hasn't expired. Returns null otherwise (fail-closed).
 */
export function verifyOAuthState(state: string | null | undefined): { orgId: string; userId: string } | null {
  if (!SECRET || !state) return null;
  const parts = state.split(":");
  // orgId and userId are UUIDs and the sig is base64url — none contain ":".
  if (parts.length !== 4) return null;
  const [orgId, userId, expStr, sig] = parts;
  const expected = sign(`${orgId}:${userId}:${expStr}`);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || Date.now() > exp) return null;
  return { orgId, userId };
}
