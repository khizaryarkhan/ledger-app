// RFC 7009 token revocation. Always answers 200: whether a token existed is not
// something the caller is entitled to learn.

import { NextRequest } from "next/server";
import { revokeByToken } from "@/lib/mcp/auth";
import { NO_STORE, json, preflight, readParams } from "@/lib/mcp/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const p = await readParams(req);
  const token = typeof p?.token === "string" ? p.token : "";
  if (token && token.length <= 200) await revokeByToken(token);
  return json({}, 200, NO_STORE);
}

export const OPTIONS = preflight;
