// One conversation: read it back as screen blocks, or delete it. Only its owner,
// in the organisation it was started in, can do either.

import { NextRequest } from "next/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { paxConversations, paxMessages, paxPendingActions } from "@/db/schema";
import { bad, ok, requireOrg } from "@/lib/api";
import { isAiCall, sameOrigin, userIdOf } from "@/lib/pax/http";
import { toUiBlocks } from "@/lib/pax/ui-shape";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** An apply is capped at 60 seconds; anything "running" for longer than this did not finish. */
const RUNNING_TIMEOUT_MS = 2 * 60_000;
const UUID =/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  const rows = await db.select({ message: paxMessages.message, createdAt: paxMessages.createdAt }).from(paxMessages)
    .where(eq(paxMessages.conversationId, c.id)).orderBy(asc(paxMessages.createdAt));
  let actions = await db.select().from(paxPendingActions).where(eq(paxPendingActions.conversationId, c.id));
  // A change claimed "running" whose process then died would otherwise read as running forever.
  // It cannot run twice (the claim is atomic), but nobody can say whether it happened, so say that.
  const stale = actions.filter((a) => a.status === "running" && (a.decidedAt?.getTime() ?? 0) < Date.now() - RUNNING_TIMEOUT_MS);
  if (stale.length) {
    const result = "The outcome is unknown: the request did not report back. Check the record before trying again.";
    await db.update(paxPendingActions).set({ status: "failed", result })
      .where(and(inArray(paxPendingActions.id, stale.map((a) => a.id)), eq(paxPendingActions.status, "running"))).catch(() => {});
    actions = actions.map((a) => (stale.includes(a) ? { ...a, status: "failed", result } : a));
  }
  return ok({
    id: c.id, title: c.title,
    blocks: toUiBlocks(rows, actions.map((a) => ({
      id: a.id, method: a.method, path: a.path, query: a.query, body: a.body, summary: a.summary,
      // A pending proposal past its time is shown as expired even before anyone clicks it.
      status: a.status === "pending" && a.expiresAt.getTime() <= Date.now() ? "expired" : a.status,
      result: a.result, createdAt: a.createdAt,
    }))),
  });
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
