// The user's decision on a change a model PROPOSED: Apply or Reject.
//
// This is the only place a PAX Console change ever runs, and only because a person
// pressed a button. The stored request is what runs — never anything the model says
// afterwards — and it runs through the app's own API as that user, so their role,
// rep scope and module access decide whether it succeeds.
//
// Before running it: the organisation's switches are re-read (an admin may have
// turned changes off since it was proposed), the stored request is re-checked against
// the same route rules, it must not have expired, and the row is claimed with one
// atomic UPDATE so a double click or a second tab cannot run it twice.

import { createHash } from "crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { and, eq, gt } from "drizzle-orm";
import { db } from "@/db";
import { paxPendingActions } from "@/db/schema";
import { bad, ok, requireOrg } from "@/lib/api";
import { logEvent } from "@/lib/audit";
import { callInternalApi } from "@/lib/mcp/api-call";
import { resolveLiveClaims } from "@/lib/mcp/auth";
import { formatResult, responseRef } from "@/lib/mcp/server";
import { rateLimit } from "@/lib/rate-limit";
import { isAiCall, sameOrigin, userIdOf } from "@/lib/pax/http";
import { recheckStored } from "@/lib/pax/policy";
import { aiWritesEnabled, loadOrgPolicy } from "@/lib/pax/policy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const Body = z.object({ decision: z.enum(["apply", "reject"]) }).strict();
const MAX_RESULT = 1500;

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (isAiCall(session)) return bad("A proposal can only be decided by a person.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);
  const userId = userIdOf(session);
  if (!UUID.test(params.id)) return bad("Proposal not found.", 404);

  const limited = await rateLimit(`pax-act:${userId}`, 20, 60);
  if (!limited.ok) return bad("Too many decisions in a short time. Wait a moment.", 429);

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return bad("Say apply or reject.");

  const [row] = await db.select().from(paxPendingActions)
    .where(and(eq(paxPendingActions.id, params.id), eq(paxPendingActions.userId, userId), eq(paxPendingActions.orgId, orgId!))).limit(1);
  if (!row) return bad("Proposal not found.", 404);
  // A repeated click or a second tab just sees how it ended.
  if (row.status !== "pending") return ok({ status: row.status, result: row.result });

  const actor = (session?.user as { email?: string } | undefined)?.email ?? null;
  const decided = and(
    eq(paxPendingActions.id, row.id), eq(paxPendingActions.userId, userId), eq(paxPendingActions.orgId, orgId!), eq(paxPendingActions.status, "pending"),
  );

  if (parsed.data.decision === "reject") {
    await db.update(paxPendingActions).set({ status: "rejected", decidedAt: new Date() }).where(decided);
    await logEvent({ orgId: orgId!, eventType: "pax_proposal", actorId: userId, actorName: actor, meta: { id: row.id, method: row.method, path: row.path, state: "rejected" } }).catch(() => {});
    return ok({ status: "rejected", result: null });
  }

  if (row.expiresAt.getTime() <= Date.now()) {
    await db.update(paxPendingActions).set({ status: "expired", decidedAt: new Date() }).where(decided);
    return bad("This proposal has expired. Ask again and review the new card.", 410);
  }

  const [policy, aiOn] = await Promise.all([loadOrgPolicy(orgId!), aiWritesEnabled(orgId!)]);
  if (!policy.writesEnabled || !aiOn) return bad("An admin has switched off changes from PAX Console, so this was not applied.", 403);

  const still = recheckStored(row);
  if (still.ok === false) return bad(`This change is no longer allowed, so it was not applied: ${still.reason}`, 403);

  // One atomic claim: only a single request can move it out of "pending".
  const claimed = await db.update(paxPendingActions).set({ status: "running", decidedAt: new Date() })
    .where(and(decided, gt(paxPendingActions.expiresAt, new Date()))).returning({ id: paxPendingActions.id });
  if (!claimed.length) return bad("This proposal was already decided.", 409);

  let status: "applied" | "failed" = "failed";
  let text = "";
  let ref: string | null = null;
  try {
    const live = await resolveLiveClaims(userId, orgId!);
    if (!live) throw new Error("Your access to this organisation has been removed.");
    const result = await callInternalApi({
      requestUrl: req.url, userId, orgId: orgId!, method: row.method as "POST" | "PUT" | "PATCH", path: row.path,
      query: (row.query as Record<string, unknown> | null) ?? undefined, body: row.body ?? undefined,
    });
    const f = formatResult(result);
    text = f.content.map((c) => c.text).join("\n").slice(0, MAX_RESULT);
    status = f.isError ? "failed" : "applied";
    ref = responseRef(result);
  } catch (e) {
    text = e instanceof Error ? e.message.slice(0, MAX_RESULT) : "The change could not be sent.";
  }

  await db.update(paxPendingActions).set({ status, result: text }).where(eq(paxPendingActions.id, row.id)).catch(() => {});
  await logEvent({
    orgId: orgId!, eventType: "mcp_write", actorId: userId, actorName: actor,
    // The summary and a hash of the body say what the person agreed to, without storing the body again.
    meta: {
      via: "pax_console_apply", method: row.method, path: row.path, status, ref, proposal: row.id,
      summary: row.summary.slice(0, 200), bodyHash: createHash("sha256").update(JSON.stringify([row.query ?? null, row.body ?? null])).digest("hex").slice(0, 16),
    },
  }).catch(() => {});
  return ok({ status, result: text });
}
