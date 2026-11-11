/**
 * POST /api/inventory/boms/full → create a whole BOM (header, output packs,
 * ingredients, packaging, operations) in one validated save. Admins only.
 * See lib/inventory/bom-save.ts for why it validates everything before writing.
 */

import { NextResponse } from "next/server";
import { requireOrg, ok } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { createBom, toBomInput, BomValidationError } from "@/lib/inventory/bom-save";
import { logEvent } from "@/lib/audit";

export async function POST(req: Request) {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;
  if (!["company_admin", "super_admin"].includes(role!)) return NextResponse.json({ error: "Admins only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  try {
    const id = await createBom(orgId!, toBomInput(body));
    const actorId = (session as any)?.user?.id ?? null;
    logEvent({ orgId: orgId!, eventType: "bom_created", docType: "bom", docId: id, actorId, actorName: (session as any)?.user?.name ?? null, meta: { code: body?.code ?? null, name: body?.name ?? null } }).catch(() => {});
    return ok({ id });
  } catch (e: any) {
    if (e instanceof BomValidationError) return NextResponse.json({ error: e.messages[0], errors: e.messages }, { status: e.status });
    console.error("[boms/full POST]", e);
    return NextResponse.json({ error: "Could not save the BOM." }, { status: 500 });
  }
}
