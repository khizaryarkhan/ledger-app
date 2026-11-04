// A short-lived, signed download link for a QuickBooks PDF.
//
// A PDF cannot travel through an AI tool call usefully: as base64 it is tens of
// thousands of tokens of noise to the model. So `GET <entity>/<id>/pdf` through
// qbo_api returns a link instead, which the person opens in a browser. The link
// names ONE org and ONE QuickBooks path, expires in 10 minutes, and is signed
// with AUTH_SECRET, so it cannot be altered to fetch something else. It is a
// bearer link for those 10 minutes — anyone holding it can download that one PDF.
//
// The QuickBooks path is re-checked on use (`isPdfPath`), so even a valid
// signature cannot be bent into a call that changes anything.

import { createHmac, timingSafeEqual } from "crypto";

const SECRET = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "";
export const FILE_LINK_TTL_MS = 10 * 60 * 1000;

const b64u = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const sign = (payload: string, secret: string) => createHmac("sha256", secret).update(`qbo-file:${payload}`).digest("base64url");

export type FileLinkClaims = { orgId: string; userId: string; path: string; exp: number };

/** Only a read of a QuickBooks PDF may ever be fetched through a link. */
export function isPdfPath(path: string): boolean {
  return /^[a-z]{2,40}\/[A-Za-z0-9-]{1,40}\/pdf$/.test(path);
}

export function signFileLink(claims: Omit<FileLinkClaims, "exp">, now = Date.now(), secret = SECRET): string {
  if (!secret) throw new Error("AUTH_SECRET is not set");
  if (!isPdfPath(claims.path)) throw new Error("only a QuickBooks PDF path can be linked");
  const payload = b64u(JSON.stringify({ o: claims.orgId, u: claims.userId, p: claims.path, e: now + FILE_LINK_TTL_MS }));
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyFileLink(token: string | null | undefined, now = Date.now(), secret = SECRET): FileLinkClaims | null {
  if (!secret || !token) return null;
  const [payload, sig, extra] = token.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload, secret));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const c = JSON.parse(unb64u(payload));
    if (typeof c?.o !== "string" || typeof c?.u !== "string" || typeof c?.p !== "string" || typeof c?.e !== "number") return null;
    if (now > c.e || !isPdfPath(c.p)) return null;
    return { orgId: c.o, userId: c.u, path: c.p, exp: c.e };
  } catch {
    return null;
  }
}
