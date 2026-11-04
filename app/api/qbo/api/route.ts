// Generic QuickBooks Online API passthrough (POST /api/qbo/api) — full access.
//
// { method, path, query?, body?, preview?, idempotencyKey?, withCount? } is sent
// to https://quickbooks.api.intuit.com/v3/company/{realmId}/{path} — or, for a
// path starting "payments/", to the QuickBooks Payments API — with the org's
// stored, auto-refreshed token. Any path and parameter; `<entity>/<id>/pdf`
// returns a 10-minute download link; `upload` takes a base64 file. Every request is classified first
// (lib/qbo/passthrough.ts) — read / write / delete / emails-a-customer — and the
// MCP tool `qbo_api` gates on that same classification.
//
// ADMIN ONLY, deliberately. The QuickBooks API reads and changes the whole
// company file; it does not know the app's own limits (a rep sees only their own
// customers here). Handing it to every role would turn one connection into a way
// round every per-user rule the app enforces.

import { NextRequest, NextResponse } from "next/server";
import { createHash, randomUUID } from "crypto";
import { db } from "@/db";
import { organisations, qboTokens } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/lib/api";
import { getOrgQboToken, type OrgQboToken } from "@/lib/qbo-token";
import { logEvent } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { inngest } from "@/lib/inngest";
import { redactText } from "@/lib/mcp/policy";
import {
  DEFAULT_MINOR_VERSION, classifyQboRequest, countQueryFor, describeQboFault, entityOfSql, uploadOf,
  type QboApi, type QboRequest,
} from "@/lib/qbo/passthrough";
import { FILE_LINK_TTL_MS, signFileLink } from "@/lib/qbo/file-link";
import { internalOrigin } from "@/lib/mcp/origin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const QBO_API = process.env.QBO_ENV === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com/v3/company"
  : "https://quickbooks.api.intuit.com/v3/company";
const PAYMENTS_API = process.env.QBO_ENV === "sandbox"
  ? "https://sandbox.api.intuit.com/quickbooks/v4/payments"
  : "https://api.intuit.com/quickbooks/v4/payments";
const ADMIN_ROLES = new Set(["company_admin", "super_admin"]);
/** QuickBooks allows ~500 requests per minute per company; leave room for the app's own sync. */
const RATE_PER_MINUTE = 450;
const MAX_ATTEMPTS = 4;
const CALL_TIMEOUT_MS = 20_000;
/** Retries stop starting after this, so a call (plus its audit row and write-back) finishes inside maxDuration. */
const RETRY_DEADLINE_MS = 30_000;
const LOG_CHARS = 4000;

type QboReply = { status: number; intuitTid: string | null; body: unknown };

const json = (body: unknown, status = 200) => NextResponse.json(body, { status });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const trunc = (s: string) => (s.length > LOG_CHARS ? `${s.slice(0, LOG_CHARS)}…[${s.length - LOG_CHARS} more chars]` : s);

/**
 * One QuickBooks call, retried on 429/5xx. A write is retried ONLY when it carries
 * a `requestid`: QuickBooks then returns the first result instead of creating a
 * second record, so a retry cannot duplicate. Reads are always safe to retry.
 */
async function callQbo(token: OrgQboToken, req: QboRequest, requestId?: string, api: QboApi = "accounting"): Promise<QboReply> {
  // The Accounting API takes its idempotency key as ?requestid= and wants a
  // minorversion; the Payments API takes it as a Request-Id header and has neither.
  const url = api === "payments"
    ? new URL(`${PAYMENTS_API}/${req.path.replace(/^payments\//, "")}`)
    : new URL(`${QBO_API}/${token.realmId}/${req.path}`);
  const { requestid: _callerKey, ...rest } = req.query;
  const params = api === "payments"
    ? rest
    : { minorversion: DEFAULT_MINOR_VERSION, ...rest, ...(requestId ? { requestid: requestId } : {}) };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  // An upload is multipart: an Attachable's JSON plus the file itself.
  const upload = api === "accounting" && req.path === "upload" ? uploadOf(req.body) : null;
  if (upload && upload.ok === false) return { status: 400, intuitTid: null, body: { error: upload.error } };
  const makeBody = (): BodyInit | undefined => {
    if (upload && upload.ok) {
      const { fileName, contentType, bytes, attachable } = upload.spec;
      const form = new FormData();
      form.append("file_metadata_01", new Blob([JSON.stringify({ ...attachable, FileName: fileName, ContentType: contentType })], { type: "application/json" }), "attachment.json");
      form.append("file_content_01", new Blob([new Uint8Array(bytes)], { type: contentType }), fileName);
      return form;
    }
    return req.body !== undefined ? JSON.stringify(req.body) : undefined;
  };
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token.accessToken}`,
    Accept: "application/json",
    ...(req.body !== undefined && !upload ? { "Content-Type": "application/json" } : {}),
    ...(api === "payments" && requestId ? { "Request-Id": requestId } : {}),
  };
  const retryable = req.method === "GET" || !!requestId;
  const started = Date.now();
  const canRetry = (attempt: number) => retryable && attempt < MAX_ATTEMPTS - 1 && Date.now() - started < RETRY_DEADLINE_MS;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(url, {
        method: req.method,
        headers,
        body: makeBody(),
        signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
      if ((res.status === 429 || res.status >= 500) && canRetry(attempt)) {
        const after = Number(res.headers.get("retry-after"));
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after * 1000, 10_000) : Math.min(500 * 2 ** attempt, 8_000));
        continue;
      }
      const text = await res.text();
      let body: unknown = text;
      try { body = JSON.parse(text); } catch { /* QuickBooks sometimes answers XML or plain text on errors */ }
      return { status: res.status, intuitTid: res.headers.get("intuit_tid"), body };
    } catch (e) {
      if (!canRetry(attempt)) {
        return { status: 0, intuitTid: null, body: { error: e instanceof Error ? e.message : "network error" } };
      }
      await sleep(Math.min(500 * 2 ** attempt, 8_000));
    }
  }
  return { status: 0, intuitTid: null, body: { error: "retries exhausted" } };
}

/** The body as it may be shown or logged: an upload's file content is replaced by its size. */
function describeBody(req: QboRequest): unknown {
  const b = req.body as any;
  if (req.path === "upload" && b && typeof b.base64 === "string") {
    return { ...b, base64: `[${Math.round((b.base64.length * 3) / 4 / 1024)} KB of file content]` };
  }
  return b ?? null;
}

/** Lift a query's rows to the top, so paging finds them and the AI sees totals beside them. */
function shapeReply(reply: QboReply) {
  const b = reply.body as any;
  const qr = b?.QueryResponse;
  if (qr && typeof qr === "object") {
    const key = Object.keys(qr).find((k) => Array.isArray(qr[k]));
    return {
      entity: key ?? null, rows: key ? qr[key] : [],
      startPosition: qr.startPosition ?? null, maxResults: qr.maxResults ?? null,
      ...(typeof qr.totalCount === "number" ? { totalCount: qr.totalCount } : {}),
    };
  }
  return { body: b };
}

export async function POST(req: NextRequest) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (!ADMIN_ROLES.has(role ?? "")) {
    return json({ error: "QuickBooks API access is limited to organisation admins: it reads and changes the whole company file, beyond the per-user limits the app applies." }, 403);
  }
  const viaMcp = (session?.user as any)?.via === "mcp";
  const userId = (session?.user as any)?.id as string;

  const input = await req.json().catch(() => null);
  const c = classifyQboRequest(input);
  if (c.ok === false) return json({ error: c.error }, 400);

  // The admin's kill switches bind AI connections, whatever a connection was granted.
  if (viaMcp && c.kind !== "read") {
    const [org] = await db.select({ w: organisations.aiWritesEnabled, d: organisations.aiDeletesEnabled })
      .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
    if (!org?.w) return json({ error: "An admin has switched off changes by AI connections for this organisation." }, 403);
    if (c.kind === "delete" && !org?.d) return json({ error: "An admin has switched off deletes by AI connections for this organisation." }, 403);
  }

  const token = await getOrgQboToken(orgId!).catch(() => null);
  if (!token) {
    return json({ error: "QuickBooks is not connected, or its authorisation has expired. An admin must reconnect it in Settings → Integrations." }, 409);
  }

  const rl = await rateLimit(`qbo-api:${token.realmId}`, RATE_PER_MINUTE, 60);
  if (!rl.ok) return json({ error: `QuickBooks rate limit for this company reached. Retry in ${rl.retryAfter}s.`, retryAfter: rl.retryAfter }, 429);

  const isWrite = c.kind !== "read";

  // A PDF is handed back as a short-lived download link, not as bytes: base64 in a
  // tool result is thousands of tokens the model cannot use (lib/qbo/file-link.ts).
  if (c.file === "pdf") {
    const origin = internalOrigin(req.url);
    if (!origin) return json({ error: "The app's public address is not configured (NEXTAUTH_URL), so a download link cannot be made." }, 500);
    const link = `${origin}/api/public/qbo-file?t=${encodeURIComponent(signFileLink({ orgId: orgId!, userId, path: c.req.path }))}`;
    await logEvent({
      orgId: orgId!, eventType: "qbo_api_call", actorId: userId, actorName: (session?.user as any)?.email ?? null,
      meta: { via: viaMcp ? "mcp" : "app", kind: "read", method: "GET", path: c.req.path, file: "pdf", linkIssued: true },
    }).catch((e) => console.error("[qbo-api] audit row not written:", e));
    return json({
      ok: true, kind: "read", file: "pdf", downloadUrl: link, expiresInMinutes: FILE_LINK_TTL_MS / 60_000,
      note: "Give this link to the user to open in a browser. It downloads this one PDF and stops working after 10 minutes, or as soon as they lose admin access.",
    });
  }

  // Preview: QuickBooks has no validate-only mode, so a preview is the request as
  // it will be sent plus the record as it stands now — never QuickBooks' verdict.
  if (input.preview === true && isWrite) {
    const b = c.req.body as any;
    const entity = c.req.path.split("/")[0];
    const current = c.api === "accounting" && c.file === null && c.req.path.split("/").length === 1 && b?.Id
      ? shapeReply(await callQbo(token, { method: "GET", path: `${entity}/${encodeURIComponent(String(b.Id))}`, query: {} }))
      : null;
    return json({
      preview: true, api: c.api, kind: c.kind, sends: c.sends, movesMoney: c.movesMoney, entities: c.entities,
      request: { method: c.req.method, path: c.req.path, query: c.req.query, body: describeBody(c.req) },
      current,
      note: "Not sent. QuickBooks has no validate-only mode: this is the request and the record as it stands, not QuickBooks' check.",
    });
  }

  const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey : "";
  if (key && !/^[A-Za-z0-9_-]{1,50}$/.test(key)) return json({ error: "idempotencyKey must be 1-50 letters, digits, - or _" }, 400);
  // Every write carries a requestid. A caller's own `requestid` parameter is used
  // as given. Otherwise the key is hashed WITH the request, so retrying the same
  // change returns QuickBooks' first answer, while re-using a key for a DIFFERENT
  // change gets its own requestid instead of a misleading "success".
  const requestId = c.req.query.requestid
    ?? (isWrite
      ? (key ? createHash("sha256").update(JSON.stringify([orgId, key, c.req.method, c.req.path, c.req.query, c.req.body ?? null])).digest("hex").slice(0, 36) : randomUUID())
      : undefined);

  const reply = await callQbo(token, c.req, requestId, c.api);
  const shaped = shapeReply(reply);

  // A total for paging, when asked: same entity and WHERE, counted.
  let totalCount: number | undefined;
  if (input.withCount === true && c.req.path === "query" && reply.status === 200 && !("totalCount" in shaped)) {
    const cq = countQueryFor(c.req.query.query);
    if (cq) {
      const r = await callQbo(token, { method: "GET", path: "query", query: { query: cq } });
      const n = (r.body as any)?.QueryResponse?.totalCount;
      if (typeof n === "number") totalCount = n;
    }
  }

  const ok = reply.status >= 200 && reply.status < 300;
  const fault = ok ? null : describeQboFault(reply.body);

  // Actor log: who, when, what was asked and what came back — redacted and capped.
  // The change has already happened in QuickBooks: a failed audit write is logged
  // loudly, never turned into an error response that would invite a retry.
  await logEvent({
    orgId: orgId!, eventType: "qbo_api_call", actorId: userId, actorName: (session?.user as any)?.email ?? null,
    meta: {
      via: viaMcp ? "mcp" : "app", api: c.api, kind: c.kind, sends: c.sends, movesMoney: c.movesMoney, file: c.file,
      method: c.req.method, path: c.req.path,
      query: c.req.query, entities: c.entities, requestId: requestId ?? null, status: reply.status, intuitTid: reply.intuitTid,
      request: c.req.body !== undefined ? trunc(redactText(JSON.stringify(describeBody(c.req))).text) : null,
      response: trunc(redactText(typeof reply.body === "string" ? reply.body : JSON.stringify(reply.body)).text),
    },
  }).catch((e) => console.error("[qbo-api] audit row not written:", e));

  // Write-back: a change made in QuickBooks is pulled into the app by the normal
  // incremental sync, collapsed to at most one run per org per minute.
  if (ok && isWrite) {
    const [t] = await db.select({ userId: qboTokens.userId, companyName: qboTokens.companyName, refreshTokenExpiresAt: qboTokens.refreshTokenExpiresAt })
      .from(qboTokens).where(eq(qboTokens.orgId, orgId!)).limit(1);
    if (t) {
      await inngest.send({
        id: `qbo-api-writeback-${orgId}-${Math.floor(Date.now() / 60_000)}`,
        name: "qbo/sync-org",
        data: {
          orgId: orgId!, userId: t.userId, companyName: t.companyName,
          refreshTokenExpiresAt: t.refreshTokenExpiresAt instanceof Date ? t.refreshTokenExpiresAt.toISOString() : String(t.refreshTokenExpiresAt),
        },
      }).catch((e) => console.error("[qbo-api] write-back sync not queued:", e));
    }
  }

  // The Payments API needs its own OAuth scope, which an org only has if it
  // connected QuickBooks after that scope was switched on (QBO_PAYMENTS_SCOPE).
  const paymentsHint = c.api === "payments" && (reply.status === 401 || reply.status === 403)
    ? "The QuickBooks Payments API needs the com.intuit.quickbooks.payment permission. An admin must reconnect QuickBooks (Settings → Integrations) after it has been switched on for this app, and the company must have a QuickBooks Payments merchant account."
    : null;

  return json({
    ok, status: reply.status, intuitTid: reply.intuitTid, api: c.api, kind: c.kind, requestId: requestId ?? null,
    ...(fault ? { fault } : {}), ...(paymentsHint ? { hint: paymentsHint } : {}), ...(totalCount !== undefined ? { totalCount } : {}),
    ...(c.req.path === "query" ? { queriedEntity: entityOfSql(c.req.query.query) } : {}),
    ...(ok && isWrite ? { writeBack: "queued: the app's QuickBooks sync will pull this change in within a minute or two" } : {}),
    ...shaped,
  }, reply.status === 0 ? 502 : ok ? 200 : reply.status);
}
