// RFC 8414 authorization-server metadata: where a client sends the user to
// approve, where it exchanges the code, and how it registers itself.

import { NextRequest } from "next/server";
import { MCP_SCOPES } from "@/lib/mcp/oauth";
import { publicOrigin } from "@/lib/mcp/origin";
import { json, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const origin = publicOrigin(req.url, req.headers.get("x-forwarded-host"), req.headers.get("x-forwarded-proto"));
  return json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp/oauth/token`,
    registration_endpoint: `${origin}/api/mcp/oauth/register`,
    revocation_endpoint: `${origin}/api/mcp/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: MCP_SCOPES,
  }, 200, { "cache-control": "public, max-age=300" });
}

export const OPTIONS = preflight;
