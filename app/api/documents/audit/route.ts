/**
 * GET /api/documents/audit?docType=ledger|trade&docId=<uuid>
 *
 * QBO form-parity, Phase 5 — Audit history. Reads the existing audit_events
 * "track & trace" log (lib/audit.ts), filtered to one document via the same
 * (docType, docId) discriminator Print/Download, Email/Send and Attachments
 * already use — not a new table (see db/schema.ts's auditEvents comment).
 *
 * Actor name is always resolved fresh here, by joining `users`, rather than
 * trusting the `actorName` column some writers didn't set (lib/accounting/
 * documents.ts's create/edit/delete/reverse calls only have an actorId, not
 * a full session) — one consistent "who" for every row, regardless of which
 * write path logged it.
 */
import { db } from "@/db";
import { auditEvents, users } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { docBelongsToOrg, type AttachmentDocKind } from "@/lib/document-attachments";
import { and, eq, desc } from "drizzle-orm";

export async function GET(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const url = new URL(req.url);
  const docType = url.searchParams.get("docType") as AttachmentDocKind | null;
  const docId = url.searchParams.get("docId");
  if (!docType || !docId || (docType !== "ledger" && docType !== "trade")) {
    return bad("docType (ledger|trade) and docId are required");
  }
  // A deleted document's audit trail (document_deleted) is intentionally
  // still readable here even though docBelongsToOrg will say "no" for it —
  // see lib/accounting/documents.ts's deleteDocument comment. This route
  // still gates on it for every OTHER case (a live document), so the only
  // way past this check is for the document to have genuinely once existed
  // in this org — the events themselves are always org-scoped below anyway.
  const belongs = await docBelongsToOrg(orgId!, docType, docId);
  const [anyEvent] = belongs ? [] : await db.select({ id: auditEvents.id }).from(auditEvents)
    .where(and(eq(auditEvents.orgId, orgId!), eq(auditEvents.docType, docType), eq(auditEvents.docId, docId))).limit(1);
  if (!belongs && !anyEvent) return bad("Document not found", 404);

  const rows = await db.select({
    id: auditEvents.id, eventType: auditEvents.eventType, meta: auditEvents.meta,
    occurredAt: auditEvents.occurredAt, actorName: users.name,
  }).from(auditEvents)
    .leftJoin(users, eq(users.id, auditEvents.actorId))
    .where(and(eq(auditEvents.orgId, orgId!), eq(auditEvents.docType, docType), eq(auditEvents.docId, docId)))
    .orderBy(desc(auditEvents.occurredAt));

  return ok(rows);
}
