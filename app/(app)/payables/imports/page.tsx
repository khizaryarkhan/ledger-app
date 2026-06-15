"use client";

import { useState } from "react";
import { Upload, FileText, CheckCircle, AlertCircle, Download } from "lucide-react";

const IMPORT_TYPES = [
  {
    id: "suppliers",
    label: "Suppliers",
    description: "Import suppliers/vendors from a CSV file",
    fields: ["Name*", "Code", "Email", "Phone", "Currency", "Payment Terms", "Country", "Tax Number"],
    template: "/templates/ap-suppliers-template.csv",
  },
  {
    id: "purchase-orders",
    label: "Purchase Orders",
    description: "Bulk import purchase orders (header only — lines must be added manually)",
    fields: ["PO Number*", "Supplier Code*", "PO Date*", "Currency", "Total", "Notes"],
    template: "/templates/ap-purchase-orders-template.csv",
  },
];

export default function PayablesImportsPage() {
  const [activeType, setActiveType] = useState(IMPORT_TYPES[0]);
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ created: number; updated: number; errors: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setResult(null);
    setError(null);
  }

  async function handleImport() {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("type", activeType.id);
      const res = await fetch("/api/payables/import", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Import failed");
      setResult(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-white">Payables Imports</h1>
        <p className="text-sm text-stone-400 mt-0.5">Bulk import payables data from CSV files</p>
      </div>

      {/* Import type selector */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        {IMPORT_TYPES.map(t => (
          <button
            key={t.id}
            onClick={() => { setActiveType(t); setFile(null); setResult(null); setError(null); }}
            className={`text-left p-4 rounded-lg border transition-colors ${
              activeType.id === t.id
                ? "border-violet-500 bg-violet-500/10"
                : "border-stone-800 bg-stone-900 hover:border-stone-700"
            }`}
          >
            <div className="text-sm font-semibold text-white">{t.label}</div>
            <div className="text-xs text-stone-400 mt-0.5">{t.description}</div>
          </button>
        ))}
      </div>

      {/* Template download */}
      <div className="flex items-center gap-2 mb-6 p-3 bg-stone-900 border border-stone-800 rounded-lg">
        <Download size={14} className="text-stone-400 shrink-0" />
        <span className="text-xs text-stone-400 flex-1">
          Download the CSV template for <span className="text-white font-medium">{activeType.label}</span> to see required columns.
        </span>
        <a
          href={activeType.template}
          className="text-xs text-violet-400 hover:text-violet-300 font-medium shrink-0"
        >
          Download template
        </a>
      </div>

      {/* Required fields */}
      <div className="mb-6">
        <h3 className="text-xs font-semibold text-stone-500 uppercase tracking-wider mb-2">Required columns</h3>
        <div className="flex flex-wrap gap-1.5">
          {activeType.fields.map(f => (
            <span key={f} className={`text-[11px] px-2 py-0.5 rounded ${
              f.endsWith("*") ? "bg-violet-500/15 text-violet-400 font-medium" : "bg-stone-800 text-stone-400"
            }`}>
              {f.replace("*", "")} {f.endsWith("*") && <span className="text-violet-400">*</span>}
            </span>
          ))}
        </div>
        <p className="text-[11px] text-stone-600 mt-2">* Required field</p>
      </div>

      {/* File upload */}
      <div className="mb-6">
        <label className="block">
          <div className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            file ? "border-violet-500 bg-violet-500/5" : "border-stone-700 hover:border-stone-600"
          }`}>
            {file ? (
              <>
                <FileText size={24} className="mx-auto mb-2 text-violet-400" />
                <p className="text-sm font-medium text-white">{file.name}</p>
                <p className="text-xs text-stone-400 mt-1">{(file.size / 1024).toFixed(1)} KB · Click to change</p>
              </>
            ) : (
              <>
                <Upload size={24} className="mx-auto mb-2 text-stone-500" />
                <p className="text-sm text-stone-400">Drop your CSV here or <span className="text-violet-400">browse</span></p>
                <p className="text-xs text-stone-600 mt-1">CSV files only, max 5 MB</p>
              </>
            )}
          </div>
          <input type="file" accept=".csv" className="hidden" onChange={handleFile} />
        </label>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg mb-4 text-sm text-rose-400">
          <AlertCircle size={15} className="shrink-0 mt-0.5" />
          {error}
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="p-4 bg-stone-900 border border-stone-800 rounded-lg mb-4">
          <div className="flex items-center gap-2 mb-3">
            <CheckCircle size={16} className="text-emerald-400" />
            <span className="text-sm font-semibold text-white">Import complete</span>
          </div>
          <div className="flex gap-4 text-sm">
            <div><span className="text-stone-400">Created:</span> <span className="text-white font-medium">{result.created}</span></div>
            <div><span className="text-stone-400">Updated:</span> <span className="text-white font-medium">{result.updated}</span></div>
            {result.errors.length > 0 && (
              <div><span className="text-rose-400">{result.errors.length} error(s)</span></div>
            )}
          </div>
          {result.errors.length > 0 && (
            <ul className="mt-3 space-y-1">
              {result.errors.map((e, i) => (
                <li key={i} className="text-xs text-rose-400">• {e}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <button
        onClick={handleImport}
        disabled={!file || uploading}
        className="w-full bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2"
      >
        {uploading ? (
          <>
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            Importing…
          </>
        ) : (
          <>
            <Upload size={15} />
            Import {activeType.label}
          </>
        )}
      </button>
    </div>
  );
}
