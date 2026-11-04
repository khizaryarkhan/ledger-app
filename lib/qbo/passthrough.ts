// Generic QuickBooks Online Accounting API passthrough — the pure half (no db,
// no network), so every rule that decides what a request IS can be tested.
//
// A request is { method, path, query?, body? }, where `path` is relative to
// /v3/company/{realmId}/ — e.g. "query", "invoice", "invoice/123",
// "invoice/123/send", "reports/ProfitAndLoss", "batch", "cdc".
//
// Every request is CLASSIFIED before it is sent: read, write, delete — and
// whether it emails a customer (`send`). Scopes, the admin kill switches and
// the confirm step all key off this one classification, so a write can never be
// mistaken for a read by a caller that described it differently.

export type QboKind = "read" | "write" | "delete";
export type QboRequest = { method: "GET" | "POST"; path: string; query: Record<string, string>; body?: unknown };
export type Classified = { ok: true; req: QboRequest; kind: QboKind; sends: boolean; entities: string[] } | { ok: false; error: string };

/** A void zeroes a transaction for good, so it is gated like a delete. */
/** Same rule as Data Studio's REFUSED_ENTITIES (lib/mcp/policy.ts): personal records stay out. */
const REFUSED_ENTITIES = new Set(["employee"]);

const DESTRUCTIVE_OPS = new Set(["delete", "void"]);

export const MAX_BATCH_ITEMS = 30;          // QuickBooks' own limit per batch request
export const DEFAULT_MINOR_VERSION = "73";  // what the rest of this app already sends

const ENTITY = /^[a-z]{2,40}$/;
const ID = /^[A-Za-z0-9-]{1,40}$/;
const REPORT = /^[A-Za-z]{2,60}$/;
/** Query-string parameters a caller may set. `requestid` is NOT one — the server sets it. */
const FIXED_PARAMS = new Set(["minorversion", "operation", "query", "entities", "changedSince", "sendTo", "include"]);
const REPORT_PARAM = /^[A-Za-z_]{1,40}$/;
const OPERATIONS = new Set(["delete", "void", "update"]);

const rank: Record<QboKind, number> = { read: 0, write: 1, delete: 2 };
const worst = (a: QboKind, b: QboKind): QboKind => (rank[a] >= rank[b] ? a : b);

function cleanQuery(raw: unknown, isReport: boolean): { ok: true; q: Record<string, string> } | { ok: false; error: string } {
  const q: Record<string, string> = {};
  if (raw === undefined || raw === null) return { ok: true, q };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "query must be an object of string values" };
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (v === undefined || v === null) continue;
    if (k === "requestid") return { ok: false, error: "requestid is set by the server — pass idempotencyKey instead" };
    if (!FIXED_PARAMS.has(k) && !(isReport && REPORT_PARAM.test(k))) return { ok: false, error: `query parameter "${k}" is not supported` };
    const s = String(v);
    if (s.length > 4000) return { ok: false, error: `query parameter "${k}" is too long` };
    q[k] = s;
  }
  if (q.minorversion !== undefined && !/^[1-9][0-9]?$/.test(q.minorversion)) return { ok: false, error: "minorversion must be a number from 1 to 99" };
  if (q.operation !== undefined) q.operation = q.operation.trim().toLowerCase();
  if (q.operation !== undefined && !OPERATIONS.has(q.operation)) return { ok: false, error: "operation must be delete, void or update" };
  return { ok: true, q };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Classify one item of a Batch request (QuickBooks' BatchItemRequest shape). */
function batchItemKind(item: unknown): { kind: QboKind; entity: string } | null {
  if (!isObject(item)) return null;
  // A Query item must be ONLY a query: one that also names an entity or an operation
  // would be classified as a read while possibly changing that entity.
  if ("Query" in item) {
    const extra = Object.keys(item).some((k) => !["bId", "optionsData", "Query"].includes(k));
    return typeof item.Query === "string" && !extra ? { kind: "read", entity: entityOfSql(item.Query) ?? "query" } : null;
  }
  const op = String(item.operation ?? "").trim().toLowerCase();
  const entityKey = Object.keys(item).find((k) => !["bId", "operation", "optionsData"].includes(k));
  if (!entityKey) return null;
  return { kind: DESTRUCTIVE_OPS.has(op) ? "delete" : "write", entity: entityKey.toLowerCase() };
}

export function classifyQboRequest(input: unknown): Classified {
  if (!isObject(input)) return { ok: false, error: "send { method, path, query?, body? }" };
  const method = String(input.method ?? "").toUpperCase();
  if (method !== "GET" && method !== "POST") return { ok: false, error: "method must be GET or POST (QuickBooks updates and deletes are POSTs)" };
  const path = String(input.path ?? "").replace(/^\/+|\/+$/g, "");
  if (!path || path.length > 200 || /[^A-Za-z0-9/_-]/.test(path)) return { ok: false, error: "path must be like \"invoice\", \"invoice/123\", \"query\", \"reports/ProfitAndLoss\", \"batch\" or \"cdc\"" };
  const seg = path.split("/");
  const isReport = seg[0] === "reports";
  const cq = cleanQuery(input.query, isReport);
  if (cq.ok === false) return cq;
  const query = cq.q;
  const body = input.body;
  if (method === "GET" && body !== undefined) return { ok: false, error: "a GET has no body" };
  // include changes what a WRITE does in some QuickBooks versions (e.g. include=void), so
  // a change carrying it could not be classified safely: reads only.
  if (method !== "GET" && query.include !== undefined) return { ok: false, error: "include is only accepted on reads" };
  const req: QboRequest = { method: method as "GET" | "POST", path, query, ...(body !== undefined ? { body } : {}) };
  const done = (kind: QboKind, entities: string[], sends = false): Classified => {
    const refused = entities.find((e) => REFUSED_ENTITIES.has(e));
    if (refused) return { ok: false, error: `QuickBooks ${refused} records hold personal details (home address, pay rates, tax ids) and are not available to AI connections` };
    return { ok: true, req, kind, sends, entities };
  };

  // Files cannot travel through a JSON tool call.
  if (seg.includes("pdf") || seg[0] === "upload" || seg[0] === "download") {
    return { ok: false, error: "PDFs and file uploads/downloads are files, which a connection cannot carry — read the record's JSON instead" };
  }

  if (seg[0] === "query") {
    if (seg.length !== 1) return { ok: false, error: "query takes no sub-path" };
    if (method !== "GET" || !query.query) return { ok: false, error: "send queries as GET with query: { query: \"select * from Invoice ...\" }" };
    return done("read", [entityOfSql(query.query) ?? "query"]);
  }
  if (isReport) {
    if (method !== "GET" || seg.length !== 2 || !REPORT.test(seg[1])) return { ok: false, error: "reports are GET reports/<ReportName>, e.g. reports/ProfitAndLoss" };
    return done("read", ["report"]);
  }
  if (seg[0] === "cdc") {
    if (method !== "GET" || seg.length !== 1 || !query.entities || !query.changedSince) return { ok: false, error: "change data capture is GET cdc with query { entities, changedSince }" };
    return done("read", query.entities.split(",").map((e) => e.trim().toLowerCase()));
  }
  if (seg[0] === "batch") {
    if (method !== "POST" || seg.length !== 1 || !isObject(body) || !Array.isArray(body.BatchItemRequest)) {
      return { ok: false, error: "batch is POST batch with body { BatchItemRequest: [...] }" };
    }
    const items = body.BatchItemRequest as unknown[];
    if (items.length === 0 || items.length > MAX_BATCH_ITEMS) return { ok: false, error: `a batch holds 1 to ${MAX_BATCH_ITEMS} operations` };
    let kind: QboKind = "read";
    const entities = new Set<string>();
    for (const it of items) {
      const c = batchItemKind(it);
      if (!c) return { ok: false, error: "every batch item needs a Query, or an entity object with an optional operation" };
      kind = worst(kind, c.kind);
      entities.add(c.entity);
    }
    return done(kind, [...entities]);
  }

  // Entity routes: <entity>, <entity>/<id>, <entity>/<id>/send, companyinfo/<id>, preferences.
  if (!ENTITY.test(seg[0])) return { ok: false, error: `"${seg[0]}" is not a QuickBooks entity name (use the lowercase API name, e.g. "invoice", "journalentry")` };
  const entity = seg[0];
  if (seg.length === 1) {
    if (method === "GET") return entity === "preferences" ? done("read", [entity]) : { ok: false, error: `read a single ${entity} with GET ${entity}/<id>, or list them with a query` };
    if (!isObject(body)) return { ok: false, error: "create/update/delete needs a JSON object body" };
    return done(DESTRUCTIVE_OPS.has(String(query.operation ?? "").toLowerCase()) ? "delete" : "write", [entity]);
  }
  if (!ID.test(seg[1])) return { ok: false, error: "the id in the path is not valid" };
  if (seg.length === 2) {
    if (method !== "GET") return { ok: false, error: `writes go to POST ${entity} with the Id in the body, not to ${entity}/<id>` };
    return done("read", [entity]);
  }
  if (seg.length === 3 && seg[2] === "send") {
    if (method !== "POST") return { ok: false, error: "send is a POST" };
    return done("write", [entity], true);
  }
  return { ok: false, error: "unsupported path" };
}

/** The entity a `select ... from X` reads, lowercased; null if it isn't a select. */
export function entityOfSql(sql: string): string | null {
  const m = /^\s*select\s+[\s\S]+?\s+from\s+([A-Za-z]+)/i.exec(sql);
  return m ? m[1].toLowerCase() : null;
}

/**
 * The COUNT(*) form of a query, for a total next to a page: same entity and
 * WHERE, without ORDER BY / STARTPOSITION / MAXRESULTS (QuickBooks rejects
 * those on a count). Null when the query is not a plain select it can rewrite.
 */
export function countQueryFor(sql: string): string | null {
  const m = /^\s*select\s+[\s\S]+?\s+from\s+([A-Za-z]+)([\s\S]*)$/i.exec(sql);
  if (!m) return null;
  const rest = m[2].replace(/\s+(order\s+by|startposition|maxresults)\b[\s\S]*$/i, "").trim();
  if (rest && !/^where\s/i.test(rest)) return null;
  return `select count(*) from ${m[1]}${rest ? ` ${rest}` : ""}`;
}

/** What a QuickBooks error body says, kept whole: Fault type, every error's code, message and detail. */
export function describeQboFault(body: unknown): string | null {
  const fault = isObject(body) ? (body.Fault ?? (isObject(body.fault) ? body.fault : undefined)) : undefined;
  if (!isObject(fault)) return null;
  const errs = Array.isArray(fault.Error) ? fault.Error : [];
  const parts = errs.map((e: any) => [e?.code && `code ${e.code}`, e?.Message, e?.Detail, e?.element && `(field: ${e.element})`].filter(Boolean).join(" — "));
  return `${fault.type ?? "Fault"}: ${parts.join("; ") || "no detail"}`;
}
