/**
 * POST /api/invoices/bulk-send — queue a bulk invoice send.
 *
 * The browser no longer sends the emails. It posts the selection and the
 * composed message; the server decides who gets which email, writes a
 * batch_jobs row, and hands it to the same Inngest chunk loop that drives
 * every other bulk operation. Closing the tab no longer stops the run, and
 * every email is recorded as it goes out.
 *
 * Grouping is deliberately NOT taken from the request. See lib/bulk-send.ts.
 */

import { requireOrg, ok, bad } from "@/lib/api";
import { z } from "zod";
import { db } from "@/db";
import { batchJobs, organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { inngest } from "@/lib/inngest";
import { buildSendGroups } from "@/lib/bulk-send";

const noCRLF = (min: number, max: number) =>
  z.string().min(min).max(max).refine(v => !/[\r\n]/.test(v), "Line breaks are not allowed here");

const Schema = z.object({
  invoiceIds: z.array(z.string().uuid()).min(1).max(5000),
  subject: noCRLF(1, 500),
  body: z.string().min(1).max(50_000),
  cc: noCRLF(0, 1000).optional(),
  attachPdf: z.boolean().default(true),
  attachStatement: z.boolean().default(true),
  includePortal: z.boolean().default(true),
  /** Corporate domains the user ticked to combine. Intersected server-side
   *  with the merges the server itself judged legitimate. */
  mergeDomains: z.array(z.string()).max(200).default([]),
  /** Per-group recipient overrides, keyed by group key. */
  toOverrides: z.record(z.string(), z.string()).default({}),
});

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  let data: z.infer<typeof Schema>;
  try { data = Schema.parse(await req.json()); }
  catch (e: any) { return bad(e?.issues?.[0]?.message ?? "Invalid request"); }

  const { groups, skippedNoEmail, notFound } =
    await buildSendGroups(orgId!, data.invoiceIds, data.mergeDomains, data.toOverrides);

  const sendable = groups.filter(g => g.to);
  if (!sendable.length) return bad("None of these invoices have an email address on file");

  const [org] = await db.select({ name: organisations.name, logoUrl: organisations.logoUrl })
    .from(organisations).where(eq(organisations.id, orgId!)).limit(1);

  const [job] = await db.insert(batchJobs).values({
    orgId: orgId!,
    operation: "send",
    entityId: "invoice-email",
    entityLabel: "Invoice emails",
    status: "running",
    totalRows: sendable.length,
    processedCount: 0,
    // Already-expired lease: the structural marker that tells the reaper and
    // the watchdog this job is chunk-resumable rather than a legacy whole-job
    // run. See app/api/batch/upload/start.
    leaseUntil: new Date(),
    input: {
      groups: sendable,
      options: {
        subject: data.subject,
        body: data.body,
        cc: data.cc,
        attachPdf: data.attachPdf,
        attachStatement: data.attachStatement,
        includePortal: data.includePortal,
        orgName: org?.name ?? "Organisation",
        logoUrl: org?.logoUrl ?? null,
      },
    },
  } as any).returning({ id: batchJobs.id });

  // Dual trigger, matching every other chunked start route: the event drives
  // the run, and the client also fires one best-effort nudge.
  await inngest.send({ name: "batch/chunk-run", data: { jobId: job.id, orgId: orgId! } }).catch(() => {});

  return ok({ jobId: job.id, emails: sendable.length, skippedNoEmail, notFound });
}
