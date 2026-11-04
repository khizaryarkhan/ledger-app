// Generic QuickBooks Online API passthrough — the pure half (no db, no network),
// so every rule that decides what a request IS can be tested.
//
// A request is { method, path, query?, body? }. `path` is relative to
// /v3/company/{realmId}/ for the Accounting API ("query", "invoice/123",
// "invoice/123/pdf", "upload", "reports/ProfitAndLoss", "batch", "cdc", or any
// other Accounting API path), or starts with "payments/" for the QuickBooks
// Payments API (/quickbooks/v4/payments/...).
//
// Access is deliberately FULL (product owner, 2026-11-04): any path, any query
// parameter, Employee records, PDFs, attachments and Payments. What stays is
// CLASSIFICATION — read / write / delete, plus whether a call emails someone or
// moves money — because the connection's grants, the org's kill switches and the
// confirm step all key off it. An unfamiliar path is classified by its method, so
// opening the API never lets a change pass as a read.

export type QboKind = "read" | "write" | "delete";
export type QboApi = "accounting" | "payments";
export type QboFile = "pdf" | "upload" | null;
export type QboRequest = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query: Record<string, string>;
  body?: unknown;
};
export type Classified =
  | { ok: true; req: QboRequest; api: QboApi; kind: QboKind; sends: boolean; movesMoney: boolean; file: QboFile; entities: string[] }
  | { ok: false; error: string };

const DESTRUCTIVE = /\b(delete|void)\b/i;

export const MAX_BATCH_ITEMS = 30;          // QuickBooks' own limit per batch request
export const DEFAULT_MINOR_VERSION = "73";  // what the rest of this app already sends
/** Decoded size of one uploaded file. Vercel caps a request body at ~4.5 MB and base64 adds a third. */
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;

const PARAM = /^[A-Za-z_][A-Za-z0-9_]{0,60}$/;

const rank: Record<QboKind, number> = { read: 0, write: 1, delete: 2 };
const worst = (a: QboKind, b: QboKind): QboKind => (rank[a] >= rank[b] ? a : b);

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cleanQuery(raw: unknown): { ok: true; q: Record<string, string> } | { ok: false; error: string } {
  const q: Record<string, string> = {};
  if (raw === undefined || raw === null) return { ok: true, q };
  if (!isObject(raw)) return { ok: false, error: "query must be an object of string values" };
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined || v === null) continue;
    if (!PARAM.test(k)) return { ok: false, error: `query parameter name "${k}" is not valid` };
    const s = String(v);
    if (s.length > 8000) return { ok: false, error: `query parameter "${k}" is too long` };
    q[k] = s;
  }
  if (q.minorversion !== undefined && !/^[1-9][0-9]?$/.test(q.minorversion)) return { ok: false, error: "minorversion must be a number from 1 to 99" };
  if (q.operation !== undefined) q.operation = q.operation.trim().toLowerCase();
  if (q.requestid !== undefined && !/^[A-Za-z0-9_-]{1,50}$/.test(q.requestid)) return { ok: false, error: "requestid must be 1-50 letters, digits, - or _" };
  return { ok: true, q };
}

/** A change that a query parameter turns destructive (operation=delete/void, include=void). */
function destructiveParams(q: Record<string, string>): boolean {
  return DESTRUCTIVE.test(q.operation ?? "") || DESTRUCTIVE.test(q.include ?? "");
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
  const op = String(item.operation ?? "");
  const entityKey = Object.keys(item).find((k) => !["bId", "operation", "optionsData"].includes(k));
  if (!entityKey) return null;
  return { kind: DESTRUCTIVE.test(op) ? "delete" : "write", entity: entityKey.toLowerCase() };
}

/** Payments API calls that charge, debit, capture or refund. */
const MONEY_PATH = /^payments\/(charges|echecks)$|^payments\/(charges|echecks)\/[^/]+\/(capture|refunds)$/;

function classifyPayments(seg: string[], req: QboRequest): Classified {
  // payments/<resource>[/...]: charges, echecks, tokens, customers/<id>/cards, customers/<id>/bank-accounts, ...
  if (seg.length < 2) return { ok: false, error: "a Payments API path is payments/<resource>, e.g. payments/charges or payments/customers/<id>/cards" };
  const path = seg.join("/");
  const kind: QboKind = req.method === "GET" ? "read" : req.method === "DELETE" || /\/void$/.test(path) ? "delete" : "write";
  const movesMoney = req.method === "POST" && MONEY_PATH.test(path);
  return { ok: true, req, api: "payments", kind, sends: false, movesMoney, file: null, entities: [seg[1]] };
}

export function classifyQboRequest(input: unknown): Classified {
  if (!isObject(input)) return { ok: false, error: "send { method, path, query?, body? }" };
  const method = String(input.method ?? "").toUpperCase();
  if (method !== "GET" && method !== "POST" && method !== "DELETE") {
    return { ok: false, error: "method must be GET, POST or DELETE (Accounting API updates and deletes are POSTs; DELETE is for the Payments API)" };
  }
  const path = String(input.path ?? "").replace(/^\/+|\/+$/g, "");
  // Any path — but only path characters, and never one that climbs out of the company.
  if (!path || path.length > 300 || /[^A-Za-z0-9/_.-]/.test(path) || path.split("/").some((s) => s === "" || s === "." || s === "..")) {
    return { ok: false, error: "path must be a QuickBooks API path such as \"invoice\", \"invoice/123\", \"invoice/123/pdf\", \"query\", \"reports/ProfitAndLoss\", \"upload\" or \"payments/charges\"" };
  }
  const seg = path.split("/");
  const cq = cleanQuery(input.query);
  if (cq.ok === false) return cq;
  const query = cq.q;
  const body = input.body;
  if (method === "GET" && body !== undefined) return { ok: false, error: "a GET has no body" };
  const req: QboRequest = { method: method as QboRequest["method"], path, query, ...(body !== undefined ? { body } : {}) };

  if (seg[0] === "payments") return classifyPayments(seg, req);
  if (method === "DELETE") return { ok: false, error: "the Accounting API deletes with POST <entity>?operation=delete — DELETE is only for Payments API paths" };

  const done = (kind: QboKind, entities: string[], extra: { sends?: boolean; file?: QboFile } = {}): Classified =>
    ({ ok: true, req, api: "accounting", kind, sends: extra.sends ?? false, movesMoney: false, file: extra.file ?? null, entities });
  const changeKind = (): QboKind => (destructiveParams(query) ? "delete" : "write");

  if (seg[0] === "query" && seg.length === 1) {
    if (method !== "GET" || !query.query) return { ok: false, error: "send queries as GET with query: { query: \"select * from Invoice ...\" }" };
    return done("read", [entityOfSql(query.query) ?? "query"]);
  }
  if (seg[0] === "cdc" && seg.length === 1 && method === "GET") {
    return done("read", (query.entities ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
  }
  if (seg[0] === "batch" && seg.length === 1) {
    if (method !== "POST" || !isObject(body) || !Array.isArray(body.BatchItemRequest)) {
      return { ok: false, error: "batch is POST batch with body { BatchItemRequest: [...] }" };
    }
    const items = body.BatchItemRequest as unknown[];
    if (items.length === 0 || items.length > MAX_BATCH_ITEMS) return { ok: false, error: `a batch holds 1 to ${MAX_BATCH_ITEMS} operations (QuickBooks' limit)` };
    let kind: QboKind = destructiveParams(query) ? "delete" : "read";
    const entities = new Set<string>();
    for (const it of items) {
      const c = batchItemKind(it);
      if (!c) return { ok: false, error: "every batch item needs a Query, or an entity object with an optional operation" };
      kind = worst(kind, c.kind);
      entities.add(c.entity);
    }
    return done(kind, [...entities]);
  }
  if (seg[0] === "upload" && seg.length === 1) {
    if (method !== "POST") return { ok: false, error: "upload is a POST" };
    const u = uploadOf(body);
    if (u.ok === false) return u;
    return done("write", ["attachable"], { file: "upload" });
  }
  if (seg[seg.length - 1] === "pdf" && method === "GET") return done("read", [seg[0].toLowerCase()], { file: "pdf" });
  if (seg[seg.length - 1] === "send" && method === "POST") return done(changeKind(), [seg[0].toLowerCase()], { sends: true });

  // Every other path: the method decides. GET reads; POST changes, and a
  // delete/void operation makes it a delete.
  return method === "GET" ? done("read", [seg[0].toLowerCase()]) : done(changeKind(), [seg[0].toLowerCase()]);
}

export type UploadSpec = { fileName: string; contentType: string; bytes: Buffer; attachable: Record<string, unknown> };

/**
 * An attachment upload, sent as JSON because a tool call cannot carry a file:
 * { fileName, contentType, base64, attachable?: { AttachableRef: [...], Note } }.
 */
export function uploadOf(body: unknown): { ok: true; spec: UploadSpec } | { ok: false; error: string } {
  const shape = "upload needs body { fileName, contentType, base64, attachable?: { AttachableRef: [{ EntityRef: { type: \"Invoice\", value: \"145\" } }], Note } }";
  if (!isObject(body)) return { ok: false, error: shape };
  const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
  const contentType = typeof body.contentType === "string" ? body.contentType.trim() : "";
  const b64 = typeof body.base64 === "string" ? body.base64.replace(/\s+/g, "") : "";
  if (!fileName || fileName.length > 200 || /[\r\n"\\/]/.test(fileName)) return { ok: false, error: `${shape} — fileName is missing or not a plain file name` };
  if (!/^[a-z]+\/[A-Za-z0-9.+-]+$/.test(contentType)) return { ok: false, error: `${shape} — contentType must be a MIME type such as application/pdf` };
  if (!b64 || !/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) return { ok: false, error: `${shape} — base64 is missing or not base64` };
  const bytes = Buffer.from(b64, "base64");
  if (bytes.length === 0) return { ok: false, error: "the file is empty" };
  if (bytes.length > MAX_UPLOAD_BYTES) return { ok: false, error: `the file is ${Math.round(bytes.length / 1024)} KB; an upload through an AI connection is limited to ${MAX_UPLOAD_BYTES / 1024 / 1024} MB` };
  if (body.attachable !== undefined && !isObject(body.attachable)) return { ok: false, error: `${shape} — attachable must be an object` };
  return { ok: true, spec: { fileName, contentType, bytes, attachable: (body.attachable as Record<string, unknown>) ?? {} } };
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
  if (isObject(fault)) {
    const errs = Array.isArray(fault.Error) ? fault.Error : [];
    const parts = errs.map((e: any) => [e?.code && `code ${e.code}`, e?.Message, e?.Detail, e?.element && `(field: ${e.element})`].filter(Boolean).join(" — "));
    return `${fault.type ?? "Fault"}: ${parts.join("; ") || "no detail"}`;
  }
  // Payments API errors: { errors: [{ code, message, detail, moreInfo }] }
  if (isObject(body) && Array.isArray(body.errors)) {
    return body.errors.map((e: any) => [e?.code && `code ${e.code}`, e?.message, e?.detail, e?.moreInfo].filter(Boolean).join(" — ")).join("; ");
  }
  return null;
}
