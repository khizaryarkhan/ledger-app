// Replays one tool call against the app's own /api under the connecting user's
// real identity. This is what makes "depends on the user's permission" literally
// true: the route that answers is the same route, with the same requireOrg(),
// role checks and module gating, that answers that user in the browser.

import { signAccessToken } from "@/lib/mobile-auth";
import { internalOrigin } from "./origin";
import { resolveLiveClaims } from "./auth";

/**
 * The most this layer reads from a response. It is deliberately much larger
 * than what reaches the model (server.ts truncates AFTER redacting): truncating
 * first would leave half a JSON document that can no longer be parsed, and so
 * could no longer be redacted.
 */
export const MAX_RESPONSE_CHARS = 2_000_000;
// Several report and sync routes run 30-60s; 25s cut them off and read as a
// failure (reported for /api/batch/download). The MCP route's maxDuration is
// set above this.
const CALL_TIMEOUT_MS = 55_000;
/** Lives just long enough for the one call it was minted for. */
const INTERNAL_TOKEN_TTL_S = 60;

export type ApiCallArgs = {
  requestUrl: string;
  userId: string;
  orgId: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  query?: Record<string, unknown>;
  body?: unknown;
};

export type ApiCallResult =
  | { ok: true; status: number; contentType: string; text: string; truncated: boolean }
  | { ok: false; error: string };

export function buildUrl(origin: string, path: string, query?: Record<string, unknown>): URL | null {
  const url = new URL(path, origin);
  // Defence in depth: policy.checkApiPath already refused anything odd, but the
  // final URL is what actually gets requested, so it is checked again here.
  if (url.origin !== origin || !url.pathname.startsWith("/api/")) return null;
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") url.searchParams.set(k, String(v));
    else url.searchParams.set(k, JSON.stringify(v));
  }
  return url;
}

export async function callInternalApi(a: ApiCallArgs): Promise<ApiCallResult> {
  const claims = await resolveLiveClaims(a.userId, a.orgId);
  if (!claims) return { ok: false, error: "Your access to this organisation has been removed, or the account is inactive. Reconnect after access is restored." };

  const origin = internalOrigin(a.requestUrl);
  if (!origin) return { ok: false, error: "The server is not configured with an application URL (NEXTAUTH_URL), so it cannot call its own API." };
  const url = buildUrl(origin, a.path, a.query);
  if (!url) return { ok: false, error: "Refused: the request would not stay within /api/ on this application." };

  const token = await signAccessToken(
    { sub: claims.sub, role: claims.role, orgId: claims.orgId, repId: claims.repId, email: claims.email },
    INTERNAL_TOKEN_TTL_S,
    "mcp",
  );
  const hasBody = a.body !== undefined && a.method !== "GET";
  try {
    const res = await fetch(url, {
      method: a.method,
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(hasBody ? { "content-type": "application/json" } : {}),
      },
      body: hasBody ? JSON.stringify(a.body) : undefined,
      redirect: "manual",
      cache: "no-store",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    const contentType = res.headers.get("content-type") ?? "";
    if (!/json|text|xml|csv/i.test(contentType) && res.status !== 204) {
      return { ok: true, status: res.status, contentType, text: `[${contentType || "binary"} response, not returned — open it in the app instead]`, truncated: false };
    }
    // Don't buffer a huge body just to throw most of it away.
    if (Number(res.headers.get("content-length") ?? 0) > MAX_RESPONSE_CHARS * 5) {
      return { ok: true, status: res.status, contentType, text: "[response too large to return — ask for a narrower query]", truncated: true };
    }
    const raw = await res.text();
    const truncated = raw.length > MAX_RESPONSE_CHARS;
    return { ok: true, status: res.status, contentType, text: truncated ? raw.slice(0, MAX_RESPONSE_CHARS) : raw, truncated };
  } catch (e) {
    const timedOut = e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError");
    return { ok: false, error: timedOut ? `The request timed out after ${CALL_TIMEOUT_MS / 1000}s.` : "The request could not be completed." };
  }
}
