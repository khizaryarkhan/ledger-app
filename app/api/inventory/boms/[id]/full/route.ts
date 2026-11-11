/**
 * GET /api/inventory/boms/[id]/full → the BOM in the shape the builder edits,
 *                                      plus `updatedAt` (the concurrency token)
 * PUT /api/inventory/boms/[id]/full → replace header + lines + operations in one
 *                                      validated save. Admins only. Send the
 *                                      `updatedAt` you loaded; a 409 means someone
 *                                      else saved first.
 */

import { NextResponse } from "next/server";
import { requireOrg, ok, bad } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { loadBomFull, replaceBom, toBomInput, BomValidationError } from "@/lib/inventory/bom-save";
import { logEvent } from "@/lib/audit";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  const full = await loadBomFull(orgId!, params.id);
  if (!full) return bad("BOM not found", 404);
  return ok(full);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    await replaceBom(orgId!, params.id, toBomInput(body), body?.updatedAt ?? null);
    const actorId = (session as any)?.user?.id ?? null;
    logEvent({ orgId: orgId!, eventType: "bom_edited", docType: "bom", docId: params.id, actorId, actorName: (session as any)?.user?.name ?? null, meta: { code: body?.code ?? null, name: body?.name ?? null } }).catch(() => {});
    const full = await loadBomFull(orgId!, params.id);
    return ok({ id: params.id, updatedAt: full?.updatedAt ?? null });
  } catch (e: any) {
    if (e instanceof BomValidationError) return NextResponse.json({ error: e.messages[0], errors: e.messages }, { status: e.status });
    console.error("[boms/[id]/full PUT]", e);
    return NextResponse.json({ error: "Could not save the BOM." }, { status: 500 });
  }
}
