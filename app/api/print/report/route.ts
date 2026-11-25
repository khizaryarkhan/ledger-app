/**
 * POST /api/print/report   body: { model, runDate? }
 *
 * Renders a report the browser already holds (a ReportExportModel built from
 * the on-screen data) to a PDF through the one shared engine. The model is
 * untrusted input: it is validated for shape and size, every string is
 * HTML-escaped by buildReportHtml, and the organisation's name and logo are
 * read from the organisation record — never from the body.
 *
 * A PDF made here is a rendering of what the user's screen showed, not an
 * attested document; the footer states who generated it and when.
 */
import { createHash } from "node:crypto";
import { bad, requireOrg } from "@/lib/api";
import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { logEvent } from "@/lib/audit";
import { rateLimit } from "@/lib/rate-limit";
import { isAiCall, sameOrigin, userIdOf } from "@/lib/pax/http";
import { parseReportModel } from "@/lib/reports/export-schema";
import { exportFileName, totalRows } from "@/lib/reports/export-model";
import { renderReportPdf } from "@/lib/reports/export-pdf";

// Headless Chromium cannot run on the Edge runtime.
export const runtime = "nodejs";
export const maxDuration = 60;

const MAX_BODY_BYTES = 4_000_000;

export async function POST(req: Request) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;
  if (isAiCall(session)) return bad("Report PDFs are not available to AI connections.", 403);
  if (!sameOrigin(req)) return bad("Cross-origin request refused", 403);

  const limited = await rateLimit(`report-pdf:${userIdOf(session)}`, 20, 60);
  if (!limited.ok) return bad("Too many exports. Wait a minute and try again.", 429);

  // Refuse on the declared size before buffering anything, then again on the real byte length.
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return bad("This report is too large for a PDF — use Excel.", 413);
  const text = await req.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return bad("This report is too large for a PDF — use Excel.", 413);
  let body: any;
  try { body = JSON.parse(text); } catch { return bad("Invalid report"); }

  const parsed = parseReportModel(body?.model);
  if (parsed.ok === false) return bad(parsed.error);
  const model = parsed.model;

  // The viewer's own local date, sent by the browser. Never the server's clock: that is UTC, and a report run
  // in the evening in New York would be stamped with tomorrow.
  const runDate: unknown = body?.runDate;
  if (typeof runDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return bad("A run date is required");

  const [org] = await db
    .select({ name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl })
    .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  const orgName = org?.displayName || org?.name || "";
  const actorName = (session?.user as any)?.name ?? null;

  try {
    const pdf = await renderReportPdf(model, { orgName, generatedOn: runDate, generatedBy: actorName, logoUrl: org?.logoUrl ?? null });
    logEvent({
      orgId: orgId!, eventType: "report_exported",
      actorId: (session?.user as any)?.id ?? null, actorName,
      // The hash lets a PDF in circulation be matched back to exactly what was submitted.
      meta: { report: model.title, format: "pdf", rows: totalRows(model), sha256: createHash("sha256").update(JSON.stringify(model)).digest("hex") },
    }).catch((e) => console.error("[audit] report_exported failed:", e));
    return new Response(pdf as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${exportFileName(model, runDate, "pdf")}"`,
        "Content-Length": pdf.byteLength.toString(),
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("Report PDF generation error:", e);
    return bad("Could not generate the PDF", 500);
  }
}
