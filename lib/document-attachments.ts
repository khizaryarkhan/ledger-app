/**
 * Shared helper for the Attachments feature (QBO form-parity, Phase 4) — the
 * one place that checks a ledger/trade document id actually belongs to the
 * calling org, before any attachment is listed, created, downloaded or
 * deleted against it. Without this, a guessed UUID from another org could be
 * attached to or (via the list route) probed from outside that org.
 */
import { db } from "@/db";
import { journalEntries, tradeDocuments } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export type AttachmentDocKind = "ledger" | "trade";

export async function docBelongsToOrg(orgId: string, kind: AttachmentDocKind, id: string): Promise<boolean> {
  if (kind === "trade") {
    const [row] = await db.select({ id: tradeDocuments.id }).from(tradeDocuments)
      .where(and(eq(tradeDocuments.id, id), eq(tradeDocuments.orgId, orgId))).limit(1);
    return !!row;
  }
  const [row] = await db.select({ id: journalEntries.id }).from(journalEntries)
    .where(and(eq(journalEntries.id, id), eq(journalEntries.orgId, orgId))).limit(1);
  return !!row;
}

export const ATTACHMENT_ALLOWED_TYPES = [
  "application/pdf",
  "image/png", "image/jpeg", "image/webp", "image/heic",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];
export const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024; // matches QBO's own per-attachment ceiling
