/**
 * GET    /api/documents/attachments/[id]  — download (proxies the real Blob
 *          URL server-side; the client never sees it — see the documentAttachments
 *          doc comment in db/schema.ts).
 * DELETE /api/documents/attachments/[id]  — removes the blob and the row.
 */
import { db } from "@/db";
import { documentAttachments } from "@/db/schema";
import { requireOrg, bad, ok } from "@/lib/api";
import { and, eq } from "drizzle-orm";
import { del } from "@vercel/blob";
import { logEvent } from "@/lib/audit";

async function loadOwned(orgId: string, id: string) {
  const [row] = await db.select().from(documentAttachments)
    .where(and(eq(documentAttachments.id, id), eq(documentAttachments.orgId, orgId))).limit(1);
  return row ?? null;
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const row = await loadOwned(orgId!, params.id);
  if (!row) return bad("Attachment not found", 404);

  const upstream = await fetch(row.blobUrl);
  if (!upstream.ok || !upstream.body) return bad("Could not retrieve the file", 502);

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": row.contentType || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${row.filename.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const row = await loadOwned(orgId!, params.id);
  if (!row) return bad("Attachment not found", 404);

  await del(row.blobUrl).catch(e => console.error("[document-attachments] blob delete failed:", e));
  await db.delete(documentAttachments).where(eq(documentAttachments.id, row.id));

  logEvent({
    orgId: orgId!, eventType: "attachment_removed",
    docType: row.docType as "ledger" | "trade", docId: row.docId,
    actorId: (session?.user as any)?.id ?? null, actorName: (session?.user as any)?.name ?? null,
    meta: { filename: row.filename },
  }).catch(e => console.error("[audit] attachment_removed failed:", e));

  return ok({ deleted: true });
}
