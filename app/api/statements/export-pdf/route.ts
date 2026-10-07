/**
 * POST /api/statements/export-pdf
 *
 * Server-side counterpart to lib/statement-export-client.ts's
 * exportStatementPdf() — the browser can no longer build this PDF itself
 * (lib/statement-pdf.ts's buildStatementPdf now renders through headless
 * Chromium, a Node-only engine), so the already-computed row selection the
 * board already holds client-side is posted here and rendered server-side.
 */
import { requireOrg } from "@/lib/api";
import { buildStatementPdf, type StatementRow } from "@/lib/statement-pdf";
import { z } from "zod";

// Headless Chromium (lib/pdf/render-html.ts) cannot run on the Edge runtime.
export const runtime = "nodejs";

const StatementRowSchema = z.object({
  inv: z.object({
    invoiceNumber: z.string(),
    invoiceDate: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    currency: z.string().nullable().optional(),
    total: z.coerce.number().nullable().optional(),
  }),
  custName: z.string(),
  projName: z.string().nullable(),
  bal: z.coerce.number(),
  days: z.coerce.number(),
  isCreditMemo: z.boolean().optional(),
});

const BodySchema = z.object({
  orgName: z.string().min(1).max(200),
  rows: z.array(StatementRowSchema).min(1).max(2000),
  logoUrl: z.string().url().nullable().optional(),
});

export async function POST(req: Request) {
  const { error } = await requireOrg();
  if (error) return error;

  const parsed = BodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Invalid statement data" }, { status: 400 });
  }
  const { orgName, logoUrl } = parsed.data;
  // Rebuilt explicitly, field by field — this project's tsconfig runs with
  // `strict: false` (no strictNullChecks), under which zod's own inferred
  // output type marks every field optional regardless of schema (its
  // internal `undefined extends T[K]` check is always true with null checks
  // off), so a direct structural assignment to StatementRow[] doesn't
  // type-check even though the runtime shape is already validated above.
  const rows: StatementRow[] = parsed.data.rows.map(r => ({
    inv: {
      invoiceNumber: r.inv.invoiceNumber,
      invoiceDate: r.inv.invoiceDate ?? null,
      dueDate: r.inv.dueDate ?? null,
      currency: r.inv.currency ?? null,
      total: r.inv.total ?? null,
    },
    custName: r.custName,
    projName: r.projName,
    bal: r.bal,
    days: r.days,
    isCreditMemo: r.isCreditMemo,
  }));

  try {
    const pdf = await buildStatementPdf({ orgName, rows, logoUrl: logoUrl ?? null });
    return new Response(pdf as unknown as BodyInit, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="Statement.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e: any) {
    console.error("Statement PDF generation error:", e);
    return Response.json({ error: "Could not generate the statement PDF" }, { status: 500 });
  }
}
