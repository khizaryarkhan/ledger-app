/**
 * Browser-side "download statement" — fetches the PDF from
 * app/api/statements/export-pdf/route.ts instead of building it locally.
 *
 * Replaces the old client-side pdf-lib call: lib/statement-pdf.ts's
 * buildStatementPdf now renders through headless Chromium
 * (lib/pdf/render-html.ts), which is Node-only and cannot run in a browser
 * bundle — so the PDF has to come from the server. Same call signature as
 * the function this replaces, so components/board-list.tsx needed no other
 * changes besides its import path.
 */
import type { StatementRow } from "@/lib/statement-pdf";

export async function exportStatementPdf({
  orgName, rows,
}: { orgName: string; rows: StatementRow[]; logoUrl?: string | null }) {
  const res = await fetch("/api/statements/export-pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    // No logo in the body: the server reads it from the org record (an
    // uploaded logo is an inline image of up to ~600 KB, and the settings
    // context the Board passes can still be empty when this is clicked).
    body: JSON.stringify({ orgName, rows }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || "Could not generate the statement PDF");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Statement_${new Date().toISOString().slice(0, 10)}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
