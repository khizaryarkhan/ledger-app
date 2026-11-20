/**
 * POST /api/edi/inbound { fileName, content } → read a file the partner sent (manual transport: a person uploads it).
 * The partner is found from the ISA IDs; a file already received (same partner + interchange number) changes nothing
 * and returns the first result. 997 marks our sent file; 855 goes through the supplier-response path. Rules: lib/edi/**.
 */
import { ok, requireOrg } from "@/lib/api";
import { receiveEdiFile } from "@/lib/edi/inbound-server";
import { EdiError } from "@/lib/edi/edi-server";
import { ediGuard, ediFail } from "../_shared";

export async function POST(req: Request) {
  const g = await ediGuard(await requireOrg(), "operate");
  if (g.error) return g.error;
  const b = await req.json().catch(() => ({}));
  if (typeof b?.content !== "string") return ediFail(new EdiError("Choose a file."));
  try { return ok(await receiveEdiFile(g.orgId!, b.content, String(b.fileName ?? "").slice(0, 128), g.actorId)); } catch (e) { return ediFail(e); }
}
