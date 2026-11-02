/**
 * PATCH /api/resources/me/returns/[id] { response? } -> acknowledge, and
 * optionally reply to, one of the caller's OWN returns.
 *
 * Acknowledging and replying are one call on purpose: a reply is an
 * acknowledgement, and two round trips would let the two disagree. Ownership
 * is enforced inside the UPDATE's WHERE clause (see answerReturn), so a
 * guessed id belonging to someone else changes nothing and 404s rather than
 * confirming it exists.
 */

import { requireOrg, bad, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { NextResponse } from "next/server";
import { buildCtx } from "@/lib/resources/time-entries-server";
import { answerReturn } from "@/lib/resources/approval-server";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session, role } = await requireOrg({ allowEmployee: true });
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "resources");
  if (modErr) return modErr;

  const body = await req.json().catch(() => ({}));
  const raw = (body as any)?.response;
  if (raw !== undefined && raw !== null && typeof raw !== "string") return bad("response must be text");

  const ctx = await buildCtx(orgId!, session, role);
  if (!ctx.actor.resourceId) return NextResponse.json({ error: "Your login is not linked to a person yet" }, { status: 403 });

  // `"error" in res`, not `!res.ok`: strictNullChecks is off in this repo, so a
  // boolean discriminant does not narrow a union here.
  const res = await answerReturn(orgId!, ctx.actor.resourceId, params.id, raw === undefined ? null : (raw as string));
  if ("error" in res) return NextResponse.json({ error: res.error }, { status: res.status });
  return ok({ ok: true });
}
