// The signed-in user's own conversations in this organisation, newest first.

import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { paxConversations } from "@/db/schema";
import { ok, requireOrg } from "@/lib/api";
import { userIdOf } from "@/lib/pax/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  const rows = await db.select({ id: paxConversations.id, title: paxConversations.title, updatedAt: paxConversations.updatedAt })
    .from(paxConversations)
    .where(and(eq(paxConversations.userId, userIdOf(session)), eq(paxConversations.orgId, orgId!)))
    .orderBy(desc(paxConversations.updatedAt))
    .limit(50);
  return ok({ conversations: rows });
}
