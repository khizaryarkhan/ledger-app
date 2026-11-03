// What an MCP connection may do. Pure — no db, no network.
//
// The MCP server does NOT re-implement permissions. Every tool call is replayed
// against the app's own /api routes under the connecting user's real identity, so
// requireOrg(), role checks and module gating answer exactly as they would for
// that person in the browser. This file adds only two things on top:
//   1. the SCOPE the user granted this connection (read / write / delete), and
//   2. a deny-list of routes an AI client must never reach even if the user could
//      (credentials, identity, billing, integration hand-shakes, internals).

import type { McpScope } from "./oauth";

/** Prefixes (and everything beneath them) that are never reachable. */
export const BLOCKED_PREFIXES: readonly { prefix: string; why: string }[] = [
  { prefix: "/api/admin",           why: "platform admin portal" },
  { prefix: "/api/auth",            why: "login, MFA, password reset and org switching" },
  { prefix: "/api/mobile",          why: "mobile login/session endpoints" },
  { prefix: "/api/mcp",             why: "the MCP server itself" },
  { prefix: "/api/oauth",           why: "OAuth endpoints" },
  { prefix: "/api/billing",         why: "Stripe is the source of truth for billing" },
  { prefix: "/api/cron",            why: "scheduled jobs" },
  { prefix: "/api/webhooks",        why: "inbound provider webhooks" },
  { prefix: "/api/inngest",         why: "background-job runner" },
  { prefix: "/api/register",        why: "sign-up" },
  { prefix: "/api/debug-auth",      why: "debug utility" },
  { prefix: "/api/migrate",         why: "one-off schema utilities" },
  { prefix: "/api/seed",            why: "seeding" },
  { prefix: "/api/backfill",        why: "one-off backfills" },
  { prefix: "/api/public",          why: "unauthenticated public endpoints" },
  { prefix: "/api/portal",          why: "customer-portal token endpoints" },
  { prefix: "/api/owner-portal",    why: "owner-portal token endpoints" },
  { prefix: "/api/supplier-portal", why: "supplier-portal token endpoints" },
  { prefix: "/api/approver",        why: "external-approver token endpoints" },
  { prefix: "/api/health",          why: "health check" },
  { prefix: "/api/org/smtp",        why: "mailbox credentials" },
  { prefix: "/api/org/users",       why: "user, role and password management" },
  { prefix: "/api/user",            why: "account/session helpers" },
];

/** Any path SEGMENT with one of these names is an integration hand-shake or a credential flow. */
export const BLOCKED_SEGMENTS: ReadonlySet<string> = new Set([
  "callback", "connect", "disconnect", "reset-password", "forgot-password", "mfa", "webhook", "webhooks",
]);

export type PathCheck = { ok: true; path: string } | { ok: false; reason: string };

/**
 * Vet a caller-supplied path. It becomes part of a request to our own origin, so
 * anything that could escape /api/ (traversal, encoded dots, `//`, a scheme) is
 * REFUSED rather than "cleaned" — a sanitiser that rewrites is a sanitiser that
 * can be tricked into producing a different valid path.
 */
export function checkApiPath(raw: unknown): PathCheck {
  if (typeof raw !== "string" || !raw) return { ok: false, reason: "path is required" };
  if (raw.length > 500) return { ok: false, reason: "path is too long" };
  if (/[?#\\\s\u0000-\u001f]/.test(raw)) {
    return { ok: false, reason: "path must not contain a query, fragment, spaces or backslashes — pass query separately" };
  }
  if (!raw.startsWith("/api/")) return { ok: false, reason: "path must start with /api/" };
  if (raw.includes("//")) return { ok: false, reason: "path must not contain //" };

  // No percent-encoding at all. Ids are uuids and route names are plain words, so
  // there is nothing legitimate to encode — and an encoded letter (/api/%69nventory)
  // would route to the real handler while module gating, which matches the RAW
  // pathname, would not recognise it.
  if (raw.includes("%")) return { ok: false, reason: "percent-encoding is not allowed in the path" };
  const decoded = raw;
  if (/(^|\/)\.\.?(\/|$)/.test(decoded)) return { ok: false, reason: "path must not contain . or .. segments" };

  const lower = decoded.toLowerCase();
  for (const b of BLOCKED_PREFIXES) {
    if (lower === b.prefix || lower.startsWith(b.prefix + "/") || (b.prefix === "/api/backfill" && lower.startsWith(b.prefix))) {
      return { ok: false, reason: `${b.prefix} is not available to AI connections (${b.why})` };
    }
  }
  for (const seg of lower.split("/")) {
    if (BLOCKED_SEGMENTS.has(seg)) return { ok: false, reason: `"${seg}" routes are not available to AI connections` };
  }
  return { ok: true, path: raw.length > 5 && raw.endsWith("/") ? raw.slice(0, -1) : raw };
}

/**
 * Routes that need the separate `mcp:sensitive` grant for anything but a read:
 * they send email (a prompt-injected model could mail customer data to an
 * attacker), or change how the organisation's mail, settings and logins behave
 * (e.g. a silent CC on every outgoing message, or a new employee login).
 * Matched on SEGMENTS so a future /…/send route is caught without a list edit.
 */
const SENSITIVE_SEGMENT = /(^|-)(send|email|emails|mail|notify|notify-owners|resend)(-|$)/;
const SENSITIVE_PREFIXES = ["/api/gmail", "/api/chat", "/api/org/settings", "/api/settings"] as const;
const SENSITIVE_PATTERNS: readonly RegExp[] = [/^\/api\/resources\/[^/]+\/login$/];

export function isSensitiveRoute(path: string): boolean {
  const p = path.toLowerCase();
  if (SENSITIVE_PREFIXES.some((x) => p === x || p.startsWith(x + "/"))) return true;
  if (SENSITIVE_PATTERNS.some((r) => r.test(p))) return true;
  return p.split("/").some((seg) => SENSITIVE_SEGMENT.test(seg));
}

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export function scopeForMethod(method: HttpMethod): McpScope {
  if (method === "GET") return "mcp:read";
  if (method === "DELETE") return "mcp:delete";
  return "mcp:write";
}

/** A delete is described back to the caller and needs an explicit `confirm: true`. */
export const requiresConfirmation = (method: HttpMethod): boolean => method === "DELETE";

export type Decision = { ok: true; path: string; method: HttpMethod; scope: McpScope } | { ok: false; reason: string };

export function authorizeCall(granted: readonly McpScope[], method: unknown, rawPath: unknown): Decision {
  const m = String(method ?? "").toUpperCase() as HttpMethod;
  if (!(HTTP_METHODS as readonly string[]).includes(m)) return { ok: false, reason: `method must be one of ${HTTP_METHODS.join(", ")}` };
  const p = checkApiPath(rawPath);
  if (p.ok === false) return p;
  const scope = scopeForMethod(m);
  if (!granted.includes(scope)) {
    return { ok: false, reason: `this connection was not granted ${scope.replace("mcp:", "")} access — the user can reconnect and allow it` };
  }
  if (m !== "GET" && isSensitiveRoute(p.path) && !granted.includes("mcp:sensitive")) {
    return { ok: false, reason: "this route sends email or changes organisation settings/logins, which needs the separate 'sensitive' access — the user can reconnect and allow it" };
  }
  return { ok: true, path: p.path, method: m, scope };
}
