/**
 * POST /api/documents/attachments/blob-token
 *
 * Issues a short-lived client token so the browser can upload an attachment
 * DIRECTLY to Vercel Blob storage — same reasoning as
 * /api/batch/upload/blob-token: Vercel Functions have a hard ~4.5 MB request
 * body limit that no app-level config can raise, and a scanned receipt or
 * multi-page PDF can easily exceed it.
 *
 * `onUploadCompleted` is deliberately a no-op, the same way the batch route's
 * is — it's a server-to-server webhook from Vercel's infra that doesn't fire
 * reliably on localhost, so nothing here depends on it. The client creates
 * the actual document_attachments row itself, in a separate authenticated
 * call (POST /api/documents/attachments), once it has the uploaded blob's
 * URL back from this token flow.
 */
import { requireOrg, bad } from "@/lib/api";
import { docBelongsToOrg, ATTACHMENT_ALLOWED_TYPES, ATTACHMENT_MAX_BYTES, type AttachmentDocKind } from "@/lib/document-attachments";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";

export async function POST(request: Request): Promise<NextResponse> {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return bad("File attachments aren't configured yet — create a Blob store in Vercel and add the BLOB_READ_WRITE_TOKEN env var, then redeploy.", 503);
  }

  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayloadRaw) => {
        let payload: { docType?: AttachmentDocKind; docId?: string } = {};
        try { payload = JSON.parse(clientPayloadRaw || "{}"); } catch { /* falls through to the missing-field check */ }
        if (!payload.docType || !payload.docId) throw new Error("Missing document reference.");
        const belongs = await docBelongsToOrg(orgId!, payload.docType, payload.docId);
        if (!belongs) throw new Error("Document not found.");
        return {
          allowedContentTypes: ATTACHMENT_ALLOWED_TYPES,
          addRandomSuffix: true,
          maximumSizeInBytes: ATTACHMENT_MAX_BYTES,
        };
      },
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
