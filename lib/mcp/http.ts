// Shared HTTP helpers for the MCP and OAuth routes.
//
// CORS is open (`*`) on purpose and only on these routes: browser-based MCP
// clients (the MCP Inspector, web connectors) call discovery, token and MCP
// endpoints cross-origin. That is safe here because none of them use cookies —
// access is by bearer token or PKCE-bound code, which a hostile page cannot
// obtain. The consent POST (/oauth/approve) is cookie-authenticated and does NOT
// use these helpers.

import { NextResponse } from "next/server";

export const CORS_HEADERS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "access-control-expose-headers": "www-authenticate",
  "access-control-max-age": "86400",
};

export const preflight = () => new NextResponse(null, { status: 204, headers: CORS_HEADERS });

export function json(body: unknown, status = 200, extra: Record<string, string> = {}) {
  return NextResponse.json(body, { status, headers: { ...CORS_HEADERS, ...extra } });
}

/** Token responses must never be cached (RFC 6749 §5.1). */
export const NO_STORE = { "cache-control": "no-store", pragma: "no-cache" } as const;

export function oauthError(error: string, description: string, status = 400) {
  return json({ error, error_description: description }, status, NO_STORE);
}

/** OAuth token/register bodies arrive as form-encoded (token) or JSON (register). */
export async function readParams(req: Request): Promise<Record<string, unknown> | null> {
  const type = req.headers.get("content-type") ?? "";
  try {
    if (type.includes("application/json")) {
      const b = await req.json();
      return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
    }
    return Object.fromEntries(new URLSearchParams(await req.text()));
  } catch {
    return null;
  }
}
