// RFC 9728 protected-resource metadata: tells an MCP client which authorization
// server guards /api/mcp. Served for the bare path and for the path-suffixed form
// some clients request (/.well-known/oauth-protected-resource/api/mcp).

import { NextRequest } from "next/server";
import { MCP_SCOPES } from "@/lib/mcp/oauth";
import { publicOrigin } from "@/lib/mcp/origin";
import { json, preflight } from "@/lib/mcp/http";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest) {
  const origin = publicOrigin(req.url, req.headers.get("x-forwarded-host"), req.headers.get("x-forwarded-proto"));
  return json({
    resource: `${origin}/api/mcp`,
    authorization_servers: [origin],
    scopes_supported: MCP_SCOPES,
    bearer_methods_supported: ["header"],
    resource_name: "Prime Accountax",
  }, 200, { "cache-control": "public, max-age=300" });
}

export const OPTIONS = preflight;
