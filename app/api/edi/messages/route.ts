/** GET /api/edi/messages?docId= → the EDI file log (no payloads), newest first. */
import { ok, requireOrg } from "@/lib/api";
import { listMessages } from "@/lib/edi/edi-server";
import { ediGuard } from "../_shared";

export async function GET(req: Request) {
  const g = await ediGuard(await requireOrg(), "read");
  if (g.error) return g.error;
  return ok(await listMessages(g.orgId!, { appDocId: new URL(req.url).searchParams.get("docId") }));
}
