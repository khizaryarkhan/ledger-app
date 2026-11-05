// One conversation: read it back as screen blocks, or delete it. Only its owner,
// in the organisation it was started in, can do either.

import { NextRequest } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { paxConversations, paxMessages } from "@/db/schema";
import { bad, ok, requireOrg } from "@/lib/api";
import { isAiCall, sameOrigin, userIdOf } from "@/lib/pax/http";
import { toUiBlocks } from "@/lib/pax/ui-shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function owned(id: string, userId: string, orgId: string) {
  if (!UUID.test(id)) return null;
  const [c] = await db.select({ id: paxConversations.id, title: paxConversations.title }).from(paxConversations)
    .where(and(eq(paxConversations.id, id), eq(paxConversations.userId, userId), eq(paxConversations.orgId, orgId))).limit(1);
  return c ?? null;
}

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const c = await owned(params.id, userIdOf(session), orgId!);
  if (!c) return bad("Conversation not found.", 404);
  const rows = await db.select({ message: paxMessages.message }).from(paxMessages)
    .where(eq(paxMessages.conversationId, c.id)).orderBy(asc(paxMessages.createdAt));
  return ok({ id: c.id, title: c.title, blocks: toUiBlocks(rows) });
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (isAiCall(session)) return bad("PAX Console cannot be changed by an AI connection.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);
  const c = await owned(params.id, userIdOf(session), orgId!);
  if (!c) return bad("Conversation not found.", 404);
  await db.delete(paxConversations).where(eq(paxConversations.id, c.id));
  return ok({ deleted: true });
}
