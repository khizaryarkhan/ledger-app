/**
 * GET /api/production/mos/[id]/report → the Manufacturing Order report as a PDF.
 *
 * Same engine as the customer statement (lib/statement-pdf.ts → lib/pdf/render-html.ts), so it needs the Node
 * runtime: headless Chromium cannot run on Edge. Read-only; any user who can open the order can print it.
 */
import { requireOrg } from "@/lib/api";
import { requireModule } from "@/lib/modules-server";
import { loadMoReport } from "@/lib/inventory/mo-report-server";
import { buildMoReportPdf } from "@/lib/inventory/mo-report";

export const runtime = "nodejs";
export const maxDuration = 60;

/** `?download=1` saves the file (the list's download icon); without it the PDF opens inline. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const { error: modErr } = await requireModule(orgId!, "manufacturing");
  if (modErr) return modErr;

  const data = await loadMoReport(orgId!, params.id);
  if (!data) return Response.json({ error: "MO not found" }, { status: 404 });
  try {
    const pdf = await buildMoReportPdf(data);
    const file = `MO-${data.mo.moNo}`.replace(/[^A-Za-z0-9._-]+/g, "_");
    return new Response(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `${new URL(req.url).searchParams.get("download") === "1" ? "attachment" : "inline"}; filename="${file}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e: any) {
    console.error("MO report PDF error:", e);
    return Response.json({ error: "Could not generate the report PDF" }, { status: 500 });
  }
}
