// A user's own AI connections: list them, and revoke one. Scoped strictly to the
// signed-in user — nobody can see or revoke another person's connection here.
// (/api/mcp is public in middleware, so this handler authenticates itself.)

import { NextRequest } from "next/server";
import { db } from "@/db";
import { mcpClients, mcpTokens, organisations } from "@/db/schema";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { bad, ok, requireAuth } from "@/lib/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error, session } = await requireAuth();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const rows = await db.select({
    id: mcpTokens.id, scopes: mcpTokens.scopes, createdAt: mcpTokens.createdAt, lastUsedAt: mcpTokens.lastUsedAt,
    clientName: mcpClients.clientName, orgName: organisations.name,
  })
    .from(mcpTokens)
    .leftJoin(mcpClients, eq(mcpClients.clientId, mcpTokens.clientId))
    .leftJoin(organisations, eq(organisations.id, mcpTokens.orgId))
    .where(and(eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt), gt(mcpTokens.refreshExpiresAt, new Date())))
    .orderBy(desc(mcpTokens.createdAt));

  return ok({ connections: rows });
}

export async function DELETE(req: NextRequest) {
  const { error, session } = await requireAuth();
  if (error) return error;
  const userId = (session!.user as any).id as string;

  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return bad("id is required");

  const done = await db.update(mcpTokens).set({ revokedAt: new Date() })
    .where(and(eq(mcpTokens.id, id), eq(mcpTokens.userId, userId), isNull(mcpTokens.revokedAt)))
    .returning({ id: mcpTokens.id });
  if (done.length === 0) return bad("Connection not found", 404);
  return ok({ revoked: true });
}
