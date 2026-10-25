/**
 * GET  /api/recurring-templates                — list this org's templates
 * POST /api/recurring-templates                — create one FROM an existing
 *        saved document: { sourceEntryId, templateName, frequency, interval,
 *        startDate, endType, endAfterCount?, endOnDate?, autoSend? }
 *
 * QBO form-parity, Phase 6 "Make Recurring". The template's `payload` is the
 * source document's own PostDocInput (via lib/accounting/documents.ts's
 * documentPayload — the same reconstruction logic the edit/reopen path
 * already uses), minus date/docNumber/dueDate: a fresh run always sets its
 * own date and gets a freshly allocated number; dueDate is dropped rather
 * than carried forward as a fixed date so termsDays (if the original had it)
 * keeps computing a due date relative to each new run's own date instead of
 * repeating one fixed date forever.
 */
import { db } from "@/db";
import { recurringTemplates, journalEntries } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { documentPayload } from "@/lib/accounting/documents";
import { RECURRABLE_TYPES } from "@/lib/accounting/recurring";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const rows = await db.select({
    id: recurringTemplates.id, sourceType: recurringTemplates.sourceType, templateName: recurringTemplates.templateName,
    frequency: recurringTemplates.frequency, interval: recurringTemplates.interval, startDate: recurringTemplates.startDate,
    endType: recurringTemplates.endType, endAfterCount: recurringTemplates.endAfterCount, endOnDate: recurringTemplates.endOnDate,
    occurrencesCreated: recurringTemplates.occurrencesCreated, nextRunDate: recurringTemplates.nextRunDate,
    active: recurringTemplates.active, autoSend: recurringTemplates.autoSend,
    lastRunAt: recurringTemplates.lastRunAt, lastRunEntryId: recurringTemplates.lastRunEntryId,
    createdAt: recurringTemplates.createdAt,
  }).from(recurringTemplates)
    .where(eq(recurringTemplates.orgId, orgId!))
    .orderBy(desc(recurringTemplates.createdAt));

  return ok(rows);
}

const PostSchema = z.object({
  sourceEntryId: z.string().uuid(),
  templateName: z.string().min(1).max(255),
  frequency: z.enum(["daily", "weekly", "monthly", "yearly"]),
  interval: z.number().int().min(1).max(365).default(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endType: z.enum(["never", "after", "on"]).default("never"),
  endAfterCount: z.number().int().min(1).max(999).optional(),
  endOnDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  autoSend: z.boolean().default(false),
});

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  let data: z.infer<typeof PostSchema>;
  try { data = PostSchema.parse(await req.json()); }
  catch (e: any) { return bad(e?.issues?.[0]?.message || "Invalid request"); }

  const [entry] = await db.select({ sourceType: journalEntries.sourceType }).from(journalEntries)
    .where(and(eq(journalEntries.id, data.sourceEntryId), eq(journalEntries.orgId, orgId!))).limit(1);
  if (!entry) return bad("Document not found", 404);
  if (!RECURRABLE_TYPES.has(entry.sourceType)) return bad(`A ${entry.sourceType} can't be made recurring.`);

  const doc = await documentPayload(orgId!, data.sourceEntryId);
  if (!doc?.payload) return bad("This document's details could not be read to build a template from it.");

  const { date: _date, docNumber: _docNumber, dueDate: _dueDate, ...templatePayload } = doc.payload;

  const [row] = await db.insert(recurringTemplates).values({
    orgId: orgId!, sourceType: entry.sourceType, templateName: data.templateName,
    payload: templatePayload, frequency: data.frequency, interval: data.interval,
    startDate: data.startDate, endType: data.endType,
    endAfterCount: data.endType === "after" ? data.endAfterCount ?? null : null,
    endOnDate: data.endType === "on" ? data.endOnDate ?? null : null,
    nextRunDate: data.startDate, autoSend: data.autoSend,
    createdBy: (session?.user as any)?.id ?? null,
  }).returning();

  return ok(row);
}
