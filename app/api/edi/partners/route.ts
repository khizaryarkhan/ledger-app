/**
 * GET  /api/edi/partners → every EDI partner profile, with the party's name
 * POST /api/edi/partners { partyId, mode, version, senderQualifier, senderId, receiverQualifier, receiverId,
 *                          senderAppId?, receiverAppId?, requirePartNumber?, requireGtin?, unitOverrides?, notes? }
 * Admin-only writes. Rules: lib/edi/partner.ts.
 */
import { ok, requireOrg } from "@/lib/api";
import { listPartners, createPartner } from "@/lib/edi/edi-server";
import { ediGuard, ediFail } from "../_shared";

export async function GET() {
  const g = await ediGuard(await requireOrg(), "read");
  if (g.error) return g.error;
  return ok(await listPartners(g.orgId!));
}

export async function POST(req: Request) {
  const g = await ediGuard(await requireOrg(), "admin");
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  try { return ok(await createPartner(g.orgId!, b, g.actorId!)); } catch (e) { return ediFail(e); }
}
