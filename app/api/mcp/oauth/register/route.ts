// Dynamic Client Registration (RFC 7591). MCP clients register themselves, so no
// secret is handed out: every client is a PUBLIC client and is protected by PKCE
// plus the user's explicit consent for each connection, not by a client secret.

import { NextRequest } from "next/server";
import { db } from "@/db";
import { mcpClients } from "@/db/schema";
import { gt, sql } from "drizzle-orm";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { TOKEN_PREFIX, isValidRedirectUri, randomToken } from "@/lib/mcp/oauth";
import { json, oauthError, preflight, readParams } from "@/lib/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_REDIRECT_URIS = 10;
/** Registration is unauthenticated by design, so cap how fast the table can grow. */
const MAX_REGISTRATIONS_PER_HOUR = 200;

export async function POST(req: NextRequest) {
  // Per-IP first, so one caller cannot use up the global cap below and lock every
  // legitimate client out of registering.
  const rl = await rateLimit(`mcp-register:${clientIp(req)}`, 10, 60 * 60);
  if (!rl.ok) return oauthError("temporarily_unavailable", "Too many registrations from this address. Try again later.", 429);

  const body = await readParams(req);
  if (!body) return oauthError("invalid_client_metadata", "Send a JSON object.");

  const uris = body.redirect_uris;
  if (!Array.isArray(uris) || uris.length === 0 || uris.length > MAX_REDIRECT_URIS || !uris.every(isValidRedirectUri)) {
    return oauthError("invalid_redirect_uri", "redirect_uris must be 1–10 https, loopback-http or app-scheme URLs without fragments.");
  }
  const name = typeof body.client_name === "string" ? body.client_name.trim().slice(0, 200) : "";

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(mcpClients)
    .where(gt(mcpClients.createdAt, new Date(Date.now() - 60 * 60 * 1000)));
  if (n >= MAX_REGISTRATIONS_PER_HOUR) return oauthError("temporarily_unavailable", "Too many registrations. Try again later.", 429);

  const clientId = randomToken(TOKEN_PREFIX.client).slice(0, 48);
  await db.insert(mcpClients).values({ clientId, clientName: name || "MCP client", redirectUris: uris });

  return json({
    client_id: clientId,
    client_name: name || "MCP client",
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, 201, { "cache-control": "no-store" });
}

export const OPTIONS = preflight;
