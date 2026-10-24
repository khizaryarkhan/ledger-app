/**
 * GET  /api/documents/attachments?docType=ledger|trade&docId=<uuid>
 * POST /api/documents/attachments   { docType, docId, filename, contentType, sizeBytes, blobUrl }
 *
 * `blobUrl` is never returned from GET — only id/filename/contentType/
 * sizeBytes/createdAt/uploadedBy. Downloading goes through
 * /api/documents/attachments/[id], which re-checks org ownership and streams
 * the file server-side, so the real storage URL is never exposed to the
 * client (see db/schema.ts's documentAttachments doc comment for why).
 *
 * POST is called by the client right after it finishes uploading to Vercel
 * Blob via the token from /blob-token — this route is what actually creates
 * the row, not Vercel's onUploadCompleted webhook (see that route's comment).
 */
import { db } from "@/db";
import { documentAttachments } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { docBelongsToOrg, type AttachmentDocKind } from "@/lib/document-attachments";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { logEvent } from "@/lib/audit";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const docType = url.searchParams.get("docType") as AttachmentDocKind | null;
  const docId = url.searchParams.get("docId");
  if (!docType || !docId || (docType !== "ledger" && docType !== "trade")) {
    return bad("docType (ledger|trade) and docId are required");
  }
  if (!(await docBelongsToOrg(orgId!, docType, docId))) return bad("Document not found", 404);

  const rows = await db.select({
    id: documentAttachments.id, filename: documentAttachments.filename,
    contentType: documentAttachments.contentType, sizeBytes: documentAttachments.sizeBytes,
    uploadedBy: documentAttachments.uploadedBy, createdAt: documentAttachments.createdAt,
  }).from(documentAttachments)
    .where(and(eq(documentAttachments.orgId, orgId!), eq(documentAttachments.docType, docType), eq(documentAttachments.docId, docId)))
    .orderBy(desc(documentAttachments.createdAt));

  return ok(rows);
}

const PostSchema = z.object({
  docType: z.enum(["ledger", "trade"]),
  docId: z.string().uuid(),
  filename: z.string().min(1).max(255),
  contentType: z.string().max(128).optional(),
  sizeBytes: z.number().int().positive().max(100 * 1024 * 1024).optional(),
  blobUrl: z.string().url().max(2048),
});

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  let data: z.infer<typeof PostSchema>;
  try { data = PostSchema.parse(await req.json()); }
  catch (e: any) { return bad(e?.issues?.[0]?.message || "Invalid request"); }

  if (!(await docBelongsToOrg(orgId!, data.docType, data.docId))) return bad("Document not found", 404);

  // Vercel Blob URLs for our own stores always live under this host — refuse
  // anything else outright rather than recording an arbitrary attacker-
  // supplied URL as if it were a real attachment.
  if (!/^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//.test(data.blobUrl)) {
    return bad("Invalid file reference.");
  }

  const [row] = await db.insert(documentAttachments).values({
    orgId: orgId!, docType: data.docType, docId: data.docId,
    filename: data.filename, contentType: data.contentType ?? null, sizeBytes: data.sizeBytes ?? null,
    blobUrl: data.blobUrl, uploadedBy: (session?.user as any)?.id ?? null,
  }).returning({
    id: documentAttachments.id, filename: documentAttachments.filename,
    contentType: documentAttachments.contentType, sizeBytes: documentAttachments.sizeBytes,
    uploadedBy: documentAttachments.uploadedBy, createdAt: documentAttachments.createdAt,
  });

  logEvent({
    orgId: orgId!, eventType: "attachment_added", docType: data.docType, docId: data.docId,
    actorId: (session?.user as any)?.id ?? null, actorName: (session?.user as any)?.name ?? null,
    meta: { filename: data.filename },
  }).catch(e => console.error("[audit] attachment_added failed:", e));

  return ok(row);
}
