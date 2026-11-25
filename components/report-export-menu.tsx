"use client";

/**
 * The Export menu every report gets from ReportShell: Excel, PDF, Print.
 * All three are produced from the same ReportExportModel the report page
 * built from its on-screen data (lib/reports/builders/*), so what is exported
 * is what is shown. Disabled until the report has loaded.
 */
import { useEffect, useRef, useState } from "react";
import { Download, FileSpreadsheet, FileText, Printer, Loader2 } from "lucide-react";
import { useData } from "@/components/data-provider";
import { localToday } from "@/lib/format";
import { tell } from "@/lib/dialogs";
import { EXPORT_LIMITS, exportFileName, totalRows, type ReportExportModel } from "@/lib/reports/export-model";
import { buildReportHtml } from "@/lib/reports/export-html";
import { downloadReportExcel } from "@/lib/reports/export-excel";

type Busy = "pdf" | "xlsx" | null;

function printModel(model: ReportExportModel, ctx: { orgName: string; generatedOn: string; logoUrl: string | null }) {
  const { html } = buildReportHtml(model, ctx);
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0";
  frame.srcdoc = html;
  frame.onload = () => {
    const w = frame.contentWindow;
    if (!w) { frame.remove(); return; }
    w.addEventListener("afterprint", () => frame.remove());
    w.focus();
    w.print();
    // Some browsers never fire afterprint; do not leave the frame behind.
    setTimeout(() => frame.remove(), 120_000);
  };
  document.body.appendChild(frame);
}

async function downloadPdf(model: ReportExportModel, runDate: string) {
  const res = await fetch("/api/print/report", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, runDate }),
  });
  if (!res.ok) {
    const j = await res.json().catch(() => null);
    throw new Error(j?.error || "Could not create the PDF");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFileName(model, runDate, "pdf");
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Excel and Print happen in the browser; tell the server so the audit log still records the export. */
function logExport(model: ReportExportModel, format: "xlsx" | "print") {
  fetch("/api/print/report/audit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: model.title, format, rows: totalRows(model) }),
  }).catch(() => { /* the export already happened; a lost audit ping must not undo it */ });
}

/** `pdf={false}` hides PDF where the caller cannot reach the server route (the employee portal's logins are refused by it). */
export function ReportExportMenu({ model, pdf = true }: { model: ReportExportModel | null; pdf?: boolean }) {
  let org: { name: string; displayName: string | null; logoUrl: string | null } | null = null;
  try { org = useData().orgSettings; } catch { org = null; }
  const orgName = org ? (org.displayName || org.name) : "";

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);

  const ready = model !== null;
  const rows = model ? totalRows(model) : 0;
  const pdfTooLong = rows > EXPORT_LIMITS.pdfRows;
  const runDate = localToday();

  async function run(kind: "xlsx" | "pdf" | "print") {
    if (!model) return;
    setOpen(false);
    try {
      if (kind === "print") {
        printModel(model, { orgName, generatedOn: runDate, logoUrl: org?.logoUrl ?? null });
        logExport(model, "print");
        return;
      }
      setBusy(kind);
      if (kind === "xlsx") {
        await downloadReportExcel(model, { orgName, generatedOn: runDate });
        logExport(model, "xlsx");
      } else {
        await downloadPdf(model, runDate);
      }
    } catch (e: any) {
      tell(e?.message || "The export did not complete. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const item = "w-full text-left px-3 py-2 text-[12px] text-stone-200 hover:bg-stone-800 flex items-center gap-2 disabled:opacity-40 disabled:hover:bg-transparent";
  return (
    <div className="relative shrink-0" ref={root}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={!ready || busy !== null}
        aria-haspopup="menu"
        aria-expanded={open}
        className="h-8 px-3 text-[12px] rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 hover:text-stone-100 inline-flex items-center gap-1.5 disabled:opacity-50"
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />} Export
      </button>
      {open && (
        <div role="menu" className="absolute right-0 mt-1 w-48 rounded-lg bg-stone-900 ring-1 ring-stone-700 shadow-lg z-30 py-1">
          <button role="menuitem" type="button" className={item} onClick={() => run("xlsx")}><FileSpreadsheet size={13} /> Excel (.xlsx)</button>
          {pdf && (
            <button
              role="menuitem" type="button" className={item} onClick={() => run("pdf")} disabled={pdfTooLong}
              title={pdfTooLong ? `Too long for a PDF (over ${EXPORT_LIMITS.pdfRows.toLocaleString()} rows) — use Excel` : undefined}
            ><FileText size={13} /> PDF</button>
          )}
          <button role="menuitem" type="button" className={item} onClick={() => run("print")} disabled={pdfTooLong}
            title={pdfTooLong ? "Too long to print — use Excel" : undefined}
          ><Printer size={13} /> Print</button>
        </div>
      )}
    </div>
  );
}
