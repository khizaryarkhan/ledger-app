/**
 * GET   /api/edi/messages/[id]             → the message with its payload
 * GET   /api/edi/messages/[id]?download=1  → the file itself, to deliver to the partner
 * PATCH /api/edi/messages/[id] { action: "sent" } | { action: "void", reason }
 */
import { ok, bad, requireOrg } from "@/lib/api";
import { getMessage, markMessageSent, voidMessage } from "@/lib/edi/edi-server";
import { ediGuard, ediFail } from "../../_shared";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "read");
  if (g.error) return g.error;
  try {
    const m = await getMessage(g.orgId!, params.id);
    if (new URL(req.url).searchParams.get("download") === "1") {
      return new Response(m.payload, { headers: {
        "Content-Type": "application/edi-x12; charset=us-ascii",
        "Content-Disposition": `attachment; filename="${m.fileName.replace(/[^A-Za-z0-9._-]/g, "_")}"`,
        "Cache-Control": "no-store",
      } });
    }
    return ok(m);
  } catch (e) { return ediFail(e); }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await ediGuard(await requireOrg(), "operate");
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  try {
    if (b?.action === "sent") return ok(await markMessageSent(g.orgId!, params.id, g.actorId));
    if (b?.action === "void") return ok(await voidMessage(g.orgId!, params.id, String(b.reason ?? ""), g.actorId));
    return bad("action must be sent or void");
  } catch (e) { return ediFail(e); }
}
