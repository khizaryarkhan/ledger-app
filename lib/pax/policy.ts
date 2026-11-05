// The rules an organisation's admin sets for PAX Console, and the rules a PROPOSED
// change must pass. Pure: no db, no network, so every rule here is provable in a test.
//
// A model never changes anything. It may PROPOSE a change; the proposal is stored and
// shown as a card; only the user's click runs it, on the server, as that user.

import { authorizeCall, refusedEntity } from "@/lib/mcp/policy";

export interface OrgPolicy {
  /** null = every provider. */
  allowedProviders: string[] | null;
  allowCustomEndpoints: boolean;
  /** May a model propose changes at all? Off until an admin turns it on. */
  writesEnabled: boolean;
  consentText: string | null;
}

export const DEFAULT_POLICY: OrgPolicy = { allowedProviders: null, allowCustomEndpoints: true, writesEnabled: false, consentText: null };

/** Shown when an admin has not written their own. */
export const DEFAULT_CONSENT =
  "PAX Console sends what it reads from your organisation's records (invoices, customers, amounts) to the AI provider you chose, so the model can answer. " +
  "That provider handles it under its own terms. Only connect a provider your organisation is comfortable sharing this data with.";

/** Who may change the organisation's PAX Console rules, and who is offered the live QuickBooks read. */
export const isOrgAdminRole = (role: string | null | undefined): boolean =>
  role === "company_admin" || role === "super_admin" || role === "platform_admin";

/** The QuickBooks route allows exactly these two, so the tool is offered to exactly these two. */
export const isQboAdminRole = (role: string | null | undefined): boolean => role === "company_admin" || role === "super_admin";

/** How long a proposal stays applicable. A stale one must not be applied by a late click. */
export const PROPOSAL_TTL_MS = 30 * 60_000;
export const MAX_PROPOSAL_CHARS = 20_000;
export const MAX_SUMMARY_CHARS = 300;

export function normalisePolicy(row: Partial<{ allowedProviders: unknown; allowCustomEndpoints: boolean; writesEnabled: boolean; consentText: string | null }> | null | undefined): OrgPolicy {
  if (!row) return { ...DEFAULT_POLICY };
  const list = Array.isArray(row.allowedProviders) ? row.allowedProviders.filter((x): x is string => typeof x === "string") : null;
  return {
    allowedProviders: list,
    allowCustomEndpoints: row.allowCustomEndpoints !== false,
    writesEnabled: row.writesEnabled === true,
    consentText: row.consentText?.trim() ? row.consentText.trim() : null,
  };
}

/** null = allowed. `isCustom` is true when the user supplied the address (a provider's own address is ours). */
export function providerRefusal(policy: OrgPolicy, providerId: string, isCustom: boolean): string | null {
  if (policy.allowedProviders && !policy.allowedProviders.includes(providerId)) {
    return "Your organisation's admin has not allowed that provider. Choose one from the allowed list, or ask an admin.";
  }
  if (isCustom && !policy.allowCustomEndpoints) {
    return "Your organisation's admin does not allow custom endpoints. Choose a provider with a built-in address.";
  }
  return null;
}

/**
 * May this conversation be offered the change tool? All three must hold: the admin turned
 * proposals on here, the organisation's AI write switch is on, and the user's model is one
 * we trust with it (small, reasoning and untested models stay read-only).
 */
export function canPropose(a: { policy: OrgPolicy; aiWritesEnabled: boolean; tier: "read" | "full" }): boolean {
  return a.policy.writesEnabled && a.aiWritesEnabled && a.tier === "full";
}

export interface Proposal {
  method: "POST" | "PUT" | "PATCH";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
  summary: string;
}

/** A path segment that names removing, undoing or detaching records: bulk-delete, void, purge, merge, reset, disconnect, revoke … */
export const DESTRUCTIVE_SEGMENT = /(^|[-_])(delete|deletes|remove|removes|void|purge|undo|merge|reset|wipe|disconnect|revoke|destroy|erase|clear|cancel)([-_]|$)/i;

/**
 * The changes a model may PROPOSE. Collections follow-up and task work: each is a record of what
 * someone did or agreed, reversible in the app, and none moves money, approves anything or reaches
 * out to a customer. Recording a payment, approving or rejecting a bill, sending email, deleting and
 * anything in QuickBooks/Xero are deliberately absent. Add a route here only with that same test.
 */
export const PROPOSABLE: readonly { label: string; methods: readonly string[]; pattern: RegExp; maxIds?: number }[] = [
  { label: "record a promise to pay on an invoice", methods: ["POST"], pattern: /^\/api\/invoices\/[^/]+\/promises$/ },
  { label: "raise a dispute on an invoice", methods: ["POST"], pattern: /^\/api\/invoices\/[^/]+\/disputes$/ },
  { label: "record a customer response on an invoice", methods: ["POST"], pattern: /^\/api\/invoices\/[^/]+\/response$/ },
  { label: "change an invoice's stage or escalation", methods: ["PATCH"], pattern: /^\/api\/invoices\/[^/]+$/ },
  { label: "change the stage or escalation of up to 50 invoices", methods: ["POST"], pattern: /^\/api\/invoices\/batch-update$/, maxIds: 50 },
  { label: "update a dispute's owner or outcome", methods: ["PATCH"], pattern: /^\/api\/disputes\/[^/]+$/ },
  { label: "log a communication (a note or call) against an invoice", methods: ["POST"], pattern: /^\/api\/communications$/ },
  { label: "create a task", methods: ["POST"], pattern: /^\/api\/tasks$/ },
  { label: "update a task", methods: ["PATCH"], pattern: /^\/api\/tasks\/[^/]+$/ },
  { label: "switch a customer's automatic reminders on or off", methods: ["PATCH"], pattern: /^\/api\/customers\/[^/]+$/ },
];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Validate what a model proposed. Same route rules as an AI connection with write access
 * and nothing more: deletes are not available, and routes that change QuickBooks/Xero, send
 * email or change settings/logins are refused (they need grants a console does not have).
 */
export function checkProposal(args: Record<string, unknown>): { ok: true; proposal: Proposal } | { ok: false; reason: string } {
  const method = String(args.method ?? "").toUpperCase();
  if (method === "DELETE") return { ok: false, reason: "deleting is not available in PAX Console. Tell the user which screen deletes it." };
  if (method !== "POST" && method !== "PUT" && method !== "PATCH") return { ok: false, reason: "method must be POST, PUT or PATCH." };

  const d = authorizeCall(["mcp:read", "mcp:write"], method, args.path);
  if (d.ok === false) return { ok: false, reason: d.reason };

  // Deny by default: only the changes named in PROPOSABLE can be proposed. A denylist missed
  // routes that delete through a POST (/api/invoices/bulk-delete), and a new or oddly named
  // route would always have slipped past one. The destructive-name check stays as a second wall.
  const hit = d.path.split("/").find((seg) => DESTRUCTIVE_SEGMENT.test(seg));
  if (hit) return { ok: false, reason: `"${hit}" removes or undoes records, which is not available in PAX Console. Tell the user which screen does it.` };
  const rule = PROPOSABLE.find((r) => r.methods.includes(method) && r.pattern.test(d.path));
  if (!rule) {
    return { ok: false, reason: `that change is not one PAX Console can propose. It can propose: ${PROPOSABLE.map((r) => r.label).join("; ")}. Tell the user which screen does what they asked.` };
  }
  if (rule.maxIds) {
    const ids = (args.body as { ids?: unknown } | undefined)?.ids;
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > rule.maxIds) {
      return { ok: false, reason: `${rule.label} needs between 1 and ${rule.maxIds} ids in body.ids.` };
    }
  }

  const summary = typeof args.summary === "string" ? args.summary.trim() : "";
  if (!summary) return { ok: false, reason: "summary is required: one plain sentence saying what will change, for the user to read before applying." };
  if (summary.length > MAX_SUMMARY_CHARS) return { ok: false, reason: `summary must be at most ${MAX_SUMMARY_CHARS} characters.` };

  if (args.query !== undefined && !isRecord(args.query)) return { ok: false, reason: "query must be an object." };
  if (args.body !== undefined && !isRecord(args.body) && !Array.isArray(args.body)) return { ok: false, reason: "body must be a JSON object or array." };

  const entity = refusedEntity(d.path, args.query, args.body);
  if (entity) return { ok: false, reason: `the "${entity}" records hold personal identifiers and are not available here.` };

  if (JSON.stringify([args.query ?? null, args.body ?? null]).length > MAX_PROPOSAL_CHARS) return { ok: false, reason: "that request is too large to propose." };

  return { ok: true, proposal: { method, path: d.path, query: args.query as Record<string, unknown> | undefined, body: args.body, summary } };
}

/** The same rules, re-run at apply time on the STORED request (policy may have changed since). */
export function recheckStored(p: { method: string; path: string; query: unknown; body: unknown; summary: string }): { ok: true } | { ok: false; reason: string } {
  const r = checkProposal({ method: p.method, path: p.path, query: p.query ?? undefined, body: p.body ?? undefined, summary: p.summary });
  return r.ok === false ? { ok: false, reason: r.reason } : { ok: true };
}
