// The organisation's AI-connection switches: GET for anyone in the org (the
// settings page shows them), PATCH for org admins only.
//
// Changing them is refused to every AI connection, three ways over: /api/mcp is on
// the MCP deny-list (policy.ts), a token minted for an AI call carries via:"mcp"
// and is refused here, and PATCH requires a same-origin browser request.
// (/api/mcp is public in middleware, so this handler authenticates itself.)

import { NextRequest } from "next/server";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { bad, ok, requireOrg } from "@/lib/api";
import { logEvent } from "@/lib/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ADMIN_ROLES = new Set(["company_admin", "super_admin"]);

function sameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (!origin || !host) return false;
  try { return new URL(origin).host === host.split(",")[0].trim(); } catch { return false; }
}

export async function GET() {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  const [org] = await db.select({ writes: organisations.aiWritesEnabled, deletes: organisations.aiDeletesEnabled })
    .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  return ok({ writes: org?.writes ?? true, deletes: org?.deletes ?? true, canEdit: ADMIN_ROLES.has(role ?? "") });
}

export async function PATCH(req: NextRequest) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if ((session?.user as any)?.via === "mcp") return bad("AI connections cannot change their own switches.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);
  if (!ADMIN_ROLES.has(role ?? "")) return bad("Only an organisation admin can change these switches.", 403);

  const body = await req.json().catch(() => null);
  const set: { aiWritesEnabled?: boolean; aiDeletesEnabled?: boolean } = {};
  if (typeof body?.writes === "boolean") set.aiWritesEnabled = body.writes;
  if (typeof body?.deletes === "boolean") set.aiDeletesEnabled = body.deletes;
  if (Object.keys(set).length === 0) return bad("Send writes and/or deletes as true or false.");

  const [row] = await db.update(organisations).set(set).where(eq(organisations.id, orgId!))
    .returning({ writes: organisations.aiWritesEnabled, deletes: organisations.aiDeletesEnabled });

  await logEvent({
    orgId: orgId!, eventType: "ai_switches_changed", actorId: (session?.user as any)?.id ?? null,
    actorName: (session?.user as any)?.email ?? null, meta: { ...row },
  }).catch(() => {});
  return ok(row);
}
