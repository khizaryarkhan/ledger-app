/**
 * "Sign in as" for super admins — see what a user sees, without being them.
 *
 * How it stays safe:
 *  1. A TICKET is minted only by POST /api/admin/impersonate, after a
 *     DB-revalidated super-admin check (requireSuperAdmin) and target checks.
 *     It is HMAC-signed with AUTH_SECRET, names who (`by`), whom (`as`) and
 *     where (`orgId`), and expires in 2 minutes. The browser cannot forge one.
 *  2. The NextAuth jwt callback (lib/auth.ts) turns a ticket into an
 *     impersonated token only when the ticket is valid AND `by` is the token's
 *     own user AND that user is a super admin AND they are not already
 *     impersonating. The original identity is kept inside the (encrypted)
 *     token, so "stop" needs no ticket: it can only ever go back to it.
 *  3. READ-ONLY: middleware refuses every non-GET/HEAD/OPTIONS API call while
 *     the token is impersonating (except NextAuth's own /api/auth/*, which is
 *     how "stop" is sent). Nothing is ever written under someone else's name.
 *  4. It ends by itself after IMPERSONATION_MINUTES.
 */
import { createHmac, timingSafeEqual } from "crypto";

export const IMPERSONATION_MINUTES = 60;
const TICKET_TTL_MS = 2 * 60 * 1000;

export interface Ticket { by: string; as: string; orgId: string; exp: number }

function key(): string {
  const k = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!k) throw new Error("AUTH_SECRET is not set");
  return k;
}

function sign(payload: string): string {
  return createHmac("sha256", key()).update(`impersonate:${payload}`).digest("base64url");
}

export function mintTicket(by: string, as: string, orgId: string, now = Date.now()): string {
  const t: Ticket = { by, as, orgId, exp: now + TICKET_TTL_MS };
  const payload = Buffer.from(JSON.stringify(t)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

export function verifyTicket(ticket: unknown, now = Date.now()): Ticket | null {
  if (typeof ticket !== "string" || ticket.length > 2000) return null;
  const [payload, sig] = ticket.split(".");
  if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Ticket;
    if (!t || typeof t.by !== "string" || typeof t.as !== "string" || typeof t.orgId !== "string") return null;
    if (typeof t.exp !== "number" || t.exp < now) return null;
    return t;
  } catch { return null; }
}

/** The identity fields the token carries; kept under `imp` while impersonating. */
export interface Identity { id: string; role: string; orgId: string | null; repId: string | null; name: string | null; email: string | null }
export interface ImpersonationState { original: Identity; until: number }

type Tok = Record<string, any>;

const identityOf = (t: Tok): Identity => ({
  id: t.id, role: t.role, orgId: t.orgId ?? null, repId: t.repId ?? null, name: t.name ?? null, email: t.email ?? null,
});

/** Apply a verified ticket to a token. Returns the token unchanged if any rule fails. */
export function startImpersonation(token: Tok, ticket: Ticket | null, target: Identity | null, now = Date.now()): Tok {
  if (!ticket || !target) return token;
  if (token.imp) return token;                 // no chains: stop first
  if (token.role !== "super_admin") return token;
  if (ticket.by !== token.id) return token;    // a ticket is only good for the admin it was minted for
  if (ticket.as !== target.id) return token;
  const imp: ImpersonationState = { original: identityOf(token), until: now + IMPERSONATION_MINUTES * 60_000 };
  return { ...token, ...target, imp };
}

/** Back to the original identity (also used when the hour runs out). */
export function stopImpersonation(token: Tok): Tok {
  if (!token.imp?.original) return token;
  const { imp, ...rest } = token;
  return { ...rest, ...imp.original };
}

export function isExpired(token: Tok, now = Date.now()): boolean {
  return !!token.imp && typeof token.imp.until === "number" && token.imp.until < now;
}
