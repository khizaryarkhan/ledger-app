// The MCP endpoint. Stateless Streamable HTTP: a client POSTs JSON-RPC and gets
// JSON back. Auth is a bearer token we issued (lib/mcp/auth.ts), verified HERE —
// middleware lets /api/mcp through unauthenticated precisely so it can answer 401
// with the discovery header MCP clients need to start the OAuth flow.

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { bearerTokenFrom } from "@/lib/mobile-auth";
import { logEvent } from "@/lib/audit";
import { resolveMcpToken, resolveLiveClaims, type McpIdentity } from "@/lib/mcp/auth";
import { callInternalApi } from "@/lib/mcp/api-call";
import { handleRpc, type McpContext, type RpcRequest, type RpcResponse } from "@/lib/mcp/server";
import { publicOrigin } from "@/lib/mcp/origin";
import { CORS_HEADERS, json, preflight } from "@/lib/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Above one call's 55s timeout (lib/mcp/api-call.ts) times the batch cap.
export const maxDuration = 120;

const MAX_BODY_BYTES = 1_000_000;
// Calls in a batch run one after another, each up to 25s, inside a 60s function —
// so a batch must stay small enough to finish.
const MAX_BATCH = 2;

function unauthorized(req: NextRequest) {
  const origin = publicOrigin(req.url, req.headers.get("x-forwarded-host"), req.headers.get("x-forwarded-proto"));
  return json({ error: "unauthorized", error_description: "A valid access token is required." }, 401, {
    "www-authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource"`,
  });
}

function contextFor(req: NextRequest, id: McpIdentity, confirmSecret: string): McpContext {
  return {
    scopes: id.scopes,
    connectionId: id.tokenId,
    confirmSecret,
    callApi: (a) => callInternalApi({ requestUrl: req.url, userId: id.userId, orgId: id.orgId, ...a }),
    // The passthrough route is refused to the generic api_* tools (policy.ts), so
    // qbo_api — which classifies and gates each request first — is its only door.
    callQbo: (body) => callInternalApi({ requestUrl: req.url, userId: id.userId, orgId: id.orgId, method: "POST", path: "/api/qbo/api", body }),
    async aiSwitches() {
      const [org] = await db.select({ w: organisations.aiWritesEnabled, d: organisations.aiDeletesEnabled })
        .from(organisations).where(eq(organisations.id, id.orgId)).limit(1);
      // A missing row is not permission: fail closed.
      return { writes: org?.w === true, deletes: org?.d === true };
    },
    async whoami() {
      const claims = await resolveLiveClaims(id.userId, id.orgId);
      if (!claims) return { error: "Your access to this organisation has been removed or the account is inactive." };
      const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName })
        .from(organisations).where(eq(organisations.id, id.orgId)).limit(1);
      return {
        user: { email: claims.email, name: claims.name },
        organisation: { id: id.orgId, name: org?.displayName || org?.name || null },
        role: claims.role,
        access: {
          read: id.scopes.includes("mcp:read"),
          write: id.scopes.includes("mcp:write"),
          delete: id.scopes.includes("mcp:delete"),
          sendEmailAndChangeSettings: id.scopes.includes("mcp:sensitive"),
          changeQuickBooksXero: id.scopes.includes("mcp:accounting_system"),
        },
        note: "Every call runs as this user, so the app's own role checks decide what succeeds.",
      };
    },
    async audit(e) {
      const claims = await resolveLiveClaims(id.userId, id.orgId);
      await logEvent({
        orgId: id.orgId,
        eventType: e.method === "DELETE" ? "mcp_delete" : e.method === "GET" ? "mcp_read" : "mcp_write",
        actorId: id.userId,
        actorName: claims?.email ?? null,
        // `ref` ties the row to what was done — for Data Studio it is the job id,
        // so a QuickBooks change made by an AI is traceable from its job record.
        meta: { via: "mcp", clientId: id.clientId, method: e.method, path: e.path, status: e.status, ref: e.ref ?? null },
      });
    },
  };
}

export async function POST(req: NextRequest) {
  const identity = await resolveMcpToken(bearerTokenFrom(req.headers.get("authorization")));
  if (!identity) return unauthorized(req);

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Request too large" } }, 413);

  let payload: unknown;
  try { payload = await req.json(); } catch {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  }

  const messages = (Array.isArray(payload) ? payload : [payload]) as RpcRequest[];
  if (messages.length === 0 || messages.length > MAX_BATCH) {
    return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: `Send between 1 and ${MAX_BATCH} messages` } }, 400);
  }

  const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET;
  if (!secret) return json({ jsonrpc: "2.0", id: null, error: { code: -32603, message: "Server is not configured" } }, 500);
  const ctx = contextFor(req, identity, secret);
  const responses: RpcResponse[] = [];
  for (const m of messages) {
    const r = await handleRpc(m, ctx);
    if (r) responses.push(r);
  }
  if (responses.length === 0) return new NextResponse(null, { status: 202, headers: CORS_HEADERS });
  return json(Array.isArray(payload) ? responses : responses[0]);
}

// Stateless server: no SSE stream to open and no session to terminate.
const methodNotAllowed = () => new NextResponse(null, { status: 405, headers: { ...CORS_HEADERS, allow: "POST, OPTIONS" } });
export const GET = methodNotAllowed;
export const DELETE = methodNotAllowed;
export const OPTIONS = preflight;
