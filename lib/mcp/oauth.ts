// Pure OAuth 2.1 helpers for the MCP server (no db, no network) so every rule
// that decides whether a token or redirect is acceptable is provable in tests.
//
// Tokens are OPAQUE random strings; only their SHA-256 is stored. That is what
// makes them individually revocable — the mobile JWTs are not.

import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";

// `mcp:sensitive` is a separate, off-by-default grant for the actions that turn a
// prompt-injected model into a data-exfiltration channel or a persistence
// mechanism: sending email, and changing organisation settings / logins. A user
// who allows "create and change" has NOT allowed these.
export const MCP_SCOPES = ["mcp:read", "mcp:write", "mcp:delete", "mcp:sensitive"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const ACCESS_TOKEN_TTL_S = 60 * 60;              // 1 hour
export const REFRESH_TOKEN_TTL_S = 30 * 24 * 60 * 60;   // 30 days
export const AUTH_CODE_TTL_S = 5 * 60;                  // 5 minutes

export const TOKEN_PREFIX = { access: "pat_", refresh: "prt_", code: "pac_", client: "pcl_" } as const;

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function randomToken(prefix: string): string {
  return prefix + randomBytes(32).toString("base64url");
}

/**
 * Keep only scopes we define. Read is always granted: a connection that cannot
 * read cannot do anything useful, and write/delete without read is meaningless.
 * Write and delete are never implied by anything else.
 */
export function normaliseScopes(input: string | readonly string[] | null | undefined): McpScope[] {
  const asked = (Array.isArray(input) ? input : String(input ?? "").split(/[\s,]+/)).filter(Boolean);
  const out = new Set<McpScope>(["mcp:read"]);
  for (const s of asked) if ((MCP_SCOPES as readonly string[]).includes(s)) out.add(s as McpScope);
  return MCP_SCOPES.filter((s) => out.has(s));
}

export const scopesToString = (s: readonly McpScope[]): string => s.join(" ");

/** S256 only — `plain` defeats the purpose of PKCE and is refused. */
export function pkceChallengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  // RFC 7636: the verifier is 43–128 chars of unreserved characters.
  if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
  const a = Buffer.from(pkceChallengeFor(verifier));
  const b = Buffer.from(challenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);
// Native-app redirect schemes we accept. An arbitrary custom scheme would let a
// registered client aim the user's browser at ANY OS protocol handler (ms-msdt:,
// search-ms:, …) with the auth code attached, so this is an allowlist, not a
// blacklist. Add a client's scheme here deliberately.
export const ALLOWED_APP_SCHEMES: ReadonlySet<string> = new Set(["cursor:", "vscode:", "vscode-insiders:", "windsurf:", "claude:"]);

/**
 * A client may register an https URL, an http loopback URL (a desktop client's
 * local listener), or an allowlisted app scheme. Fragments are forbidden
 * (RFC 6749 §3.1.2) and credentials in the URL are refused.
 */
export function isValidRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== "string" || uri.length > 2000) return false;
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:") return true;
  if (u.protocol === "http:") return LOOPBACK.has(u.hostname);
  return ALLOWED_APP_SCHEMES.has(u.protocol);
}

/** Key-order-independent JSON, so the same arguments always bind to the same confirmation. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

const CONFIRM_TTL_S = 5 * 60;

/**
 * A delete is described first and executed only when the caller echoes back a
 * token the server issued for EXACTLY those arguments, on THIS connection,
 * within five minutes. That makes "describe, then confirm" real rather than a
 * boolean a model can set on its first call. It proves the call was seen, not
 * that a human agreed — the client's own tool-approval prompt is that control.
 */
export function makeConfirmToken(secret: string, binding: string, nowMs: number = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + CONFIRM_TTL_S;
  const mac = createHmac("sha256", secret).update(`${binding}|${exp}`).digest("base64url");
  return `${exp}.${mac}`;
}

export function verifyConfirmToken(secret: string, binding: string, token: unknown, nowMs: number = Date.now()): boolean {
  if (typeof token !== "string" || token.length > 200) return false;
  const [e, m] = token.split(".");
  const exp = Number(e);
  if (!Number.isInteger(exp) || !m || exp * 1000 < nowMs || exp * 1000 > nowMs + (CONFIRM_TTL_S + 60) * 1000) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(`${binding}|${exp}`).digest("base64url"));
  const got = Buffer.from(m);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** Exact match, except a loopback URL may differ in port (RFC 8252 §7.3). */
export function redirectUriMatches(registered: readonly string[], candidate: string): boolean {
  if (registered.includes(candidate)) return true;
  let c: URL;
  try { c = new URL(candidate); } catch { return false; }
  if (c.protocol !== "http:" || !LOOPBACK.has(c.hostname)) return false;
  return registered.some((r) => {
    try {
      const u = new URL(r);
      return u.protocol === "http:" && u.hostname === c.hostname && u.pathname === c.pathname && u.search === c.search;
    } catch { return false; }
  });
}
