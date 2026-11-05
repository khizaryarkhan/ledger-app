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
  { prefix: "/api/pax-console",     why: "PAX Console's own settings, keys and conversations" },
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

/**
 * Exact paths refused, each with the reason an AI is told. These are not
 * dangerous so much as useless or misleading through an API: the root of each
 * integration route STARTS a browser sign-in (a 307 to Intuit/Xero/Google), the
 * consolidated group views read a group picked in the browser (so they always
 * answered 401 to a connection — reported as a bug), and Data Studio's download
 * and upload move spreadsheet FILES, which a tool call cannot carry.
 */
export const REFUSED_PATHS: readonly { path: string; prefix?: boolean; why: string }[] = [
  { path: "/api/qbo", why: "it starts the QuickBooks sign-in in a browser. To check the connection use GET /api/qbo/verify or GET /api/qbo/sync" },
  // Reached only through the qbo_api tool, which classifies each request and
  // checks the read / change / delete / send grants first. Through api_write
  // every QuickBooks call would look like a plain "write".
  { path: "/api/qbo/api", why: "use the qbo_api tool for QuickBooks API calls" },
  { path: "/api/xero", why: "it starts the Xero sign-in in a browser. To check the connection use GET /api/xero/sync" },
  { path: "/api/gmail", why: "it starts the Gmail sign-in in a browser" },
  { path: "/api/microsoft", why: "it starts the Microsoft sign-in in a browser" },
  { path: "/api/google-sheets", why: "it starts the Google sign-in in a browser" },
  { path: "/api/group", prefix: true, why: "consolidated group views need a group picked in the browser; ask about one organisation at a time instead" },
  { path: "/api/batch/download", why: "it returns a spreadsheet file, which cannot be passed back through a connection. Read the records with api_get instead" },
  { path: "/api/batch/upload", prefix: true, why: "it imports a spreadsheet uploaded in the browser. Make changes with /api/batch/bulk-edit instead" },
  { path: "/api/batch/template", why: "it returns a spreadsheet file" },
  { path: "/api/batch/debug", prefix: true, why: "diagnostic route" },
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
  const trimmed = lower.length > 5 && lower.endsWith("/") ? lower.slice(0, -1) : lower;
  for (const r of REFUSED_PATHS) {
    if (trimmed === r.path || (r.prefix && trimmed.startsWith(r.path + "/"))) {
      return { ok: false, reason: `${r.path} is not available to AI connections: ${r.why}` };
    }
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

/**
 * Routes that change records in QuickBooks/Xero themselves (Data Studio jobs, and
 * anything that "pushes" a document out). These need their own grant,
 * `mcp:accounting_system`, because they edit the client's real books in bulk —
 * a plain "create and change" grant is about this app's own records.
 * A Data Studio SEARCH is a read sent as POST, so it is not a change.
 */
export function isAccountingSystemWrite(path: string): boolean {
  const p = path.toLowerCase();
  if (p.endsWith("/search")) return false;
  if (p === "/api/batch" || p.startsWith("/api/batch/")) return true;
  return p.split("/").includes("push");
}

/** Most records one call may change in QuickBooks/Xero. A bigger job is done in the app, where a person reviews it. */
export const MAX_ACCOUNTING_SYSTEM_ROWS = 100;

/** Length of the largest array in a request body, looking two levels deep (`{ ids: [...] }`, `{ changes: { ids: [...] } }`). */
export function largestArray(body: unknown, depth = 2): number {
  // reduce, not Math.max(...spread): a 1 MB body can hold more items than a call's argument limit.
  if (Array.isArray(body)) {
    return (body as unknown[]).reduce<number>((m, b) => Math.max(m, depth > 0 ? largestArray(b, depth - 1) : 0), body.length);
  }
  if (body && typeof body === "object" && depth > 0) {
    return Object.values(body as Record<string, unknown>).reduce<number>((m, v) => Math.max(m, largestArray(v, depth - 1)), 0);
  }
  return 0;
}

/**
 * Data Studio entities an AI connection may not touch at all. QuickBooks
 * employees carry SSN, date of birth and home address; the app's own payroll
 * screens are where those belong.
 */
export const REFUSED_ENTITIES: ReadonlySet<string> = new Set(["employee"]);

export function refusedEntity(path: string, query: unknown, body: unknown): string | null {
  if (!path.toLowerCase().startsWith("/api/batch")) return null;
  const pick = (o: unknown) => (o && typeof o === "object" && !Array.isArray(o) ? (o as Record<string, unknown>).entity : undefined);
  for (const e of [pick(query), pick(body)]) {
    if (typeof e === "string" && REFUSED_ENTITIES.has(e.toLowerCase())) return e;
  }
  return null;
}

/**
 * Field names whose VALUES never leave through an AI connection, whatever route
 * returned them: personal identifiers, credentials and bank details. Matched on
 * the name with case, spaces and punctuation removed, so `ssn`, `SSN` and the
 * Data Studio column "Birth Date" are all caught. Redacting the value, not
 * dropping the key, keeps the shape so the model can say the field exists.
 */
const SENSITIVE_KEY = /^(ssn|sin|socialsecurity(no|number)?|nino|ninumber|nationalinsurance(no|number)?|nationalid(no|number)?|dob|dateofbirth|birthdate|birthday|passport(no|number)?|password|passwordhash|accesstoken|refreshtoken|idtoken|apikey|clientsecret|secret|iban|bankaccount(no|number)?|sortcode|routingnumber|cardnumber|cvv|cvc|taxidentifier|taxid|ein|tin|utr)$/;
export const isSensitiveKey = (key: string): boolean => SENSITIVE_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
/**
 * The narrower set redacted from the QuickBooks API (qbo_api), which an org admin
 * was given full access to on 2026-11-04 — Employee records and tax ids included.
 * Credentials, bank and card numbers still never reach a model.
 */
const CREDENTIAL_KEY = /^(password|passwordhash|accesstoken|refreshtoken|idtoken|apikey|clientsecret|secret|iban|bankaccount(no|number)?|accountnumber|sortcode|routingnumber|cardnumber|cvv|cvc)$/;
export const isCredentialKey = (key: string): boolean => CREDENTIAL_KEY.test(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
export type RedactMode = "personal" | "credentials";
export const REDACTED = "[redacted]";

function redactValue(v: unknown, count: { n: number }, depth: number, hit: (k: string) => boolean): unknown {
  if (depth > 40) return v;
  if (Array.isArray(v)) return v.map((x) => redactValue(x, count, depth + 1, hit));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (hit(k) && x !== null && x !== "" && x !== undefined) { out[k] = REDACTED; count.n++; }
      else out[k] = redactValue(x, count, depth + 1, hit);
    }
    return out;
  }
  return v;
}

/**
 * Redact a response body. JSON is parsed and walked; anything else (or JSON too
 * damaged to parse) falls back to a pattern over `"key": value` pairs, so a body
 * that is not clean JSON is still not a way round the rule.
 */
export function redactJson(value: unknown, mode: RedactMode = "personal"): { value: unknown; redacted: number } {
  const count = { n: 0 };
  const clean = redactValue(value, count, 0, mode === "credentials" ? isCredentialKey : isSensitiveKey);
  return { value: count.n ? clean : value, redacted: count.n };
}

export function redactText(text: string, mode: RedactMode = "personal"): { text: string; redacted: number } {
  const count = { n: 0 };
  const hit = mode === "credentials" ? isCredentialKey : isSensitiveKey;
  try {
    const { value, redacted } = redactJson(JSON.parse(text), mode);
    return { text: redacted ? JSON.stringify(value) : text, redacted };
  } catch {
    const out = text.replace(/"([^"\\]{1,80})"(\s*:\s*)("(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*)/g, (m, key: string, sep: string) => {
      if (!hit(key)) return m;
      count.n++;
      return `"${key}"${sep}"${REDACTED}"`;
    });
    return { text: out, redacted: count.n };
  }
}

export const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export function scopeForMethod(method: HttpMethod): McpScope {
  if (method === "GET") return "mcp:read";
  if (method === "DELETE") return "mcp:delete";
  return "mcp:write";
}

/**
 * Calls that are described first and run only when the issued confirmation
 * token is echoed back: every delete, and every change to QuickBooks/Xero (the
 * "preview before any QBO write" the first live user asked for).
 */
export const requiresConfirmation = (method: HttpMethod, path = ""): boolean =>
  method === "DELETE" || (method !== "GET" && isAccountingSystemWrite(path));

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
  if (m !== "GET" && isAccountingSystemWrite(p.path) && !granted.includes("mcp:accounting_system")) {
    return { ok: false, reason: "this route changes records in QuickBooks/Xero, which needs the separate 'Change QuickBooks / Xero' access — the user can reconnect and allow it" };
  }
  if (m !== "GET" && isSensitiveRoute(p.path) && !granted.includes("mcp:sensitive")) {
    return { ok: false, reason: "this route sends email or changes organisation settings/logins, which needs the separate 'sensitive' access — the user can reconnect and allow it" };
  }
  return { ok: true, path: p.path, method: m, scope };
}
