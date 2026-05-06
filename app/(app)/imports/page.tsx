"use client";

import { useState } from "react";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import { Upload, AlertTriangle, Check } from "lucide-react";

const SAMPLE_CSV = `invoiceNumber,customerCode,projectCode,invoiceDate,dueDate,amount,taxAmount,currency,poNumber
INV-2025-2001,ATL001,ATL-FM25,2025-04-01,2025-05-01,15000,3450,EUR,PO-AT-9001
INV-2025-2002,NWI002,NWI-SCP,2025-04-05,2025-05-20,28000,5600,GBP,PO-NW-9002
INV-2025-2003,HTG003,HTG-CM2,2025-04-10,2025-05-10,42000,7980,EUR,PO-HT-9003`;

export default function ImportsPage() {
  const { importInvoices } = useData();
  const [csv, setCsv] = useState("");
  const [result, setResult] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);

  const parseCsv = (text: string) => {
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) return [];
    const headers = lines[0].split(",").map(h => h.trim());
    return lines.slice(1).map(line => {
      const cells = line.split(",").map(c => c.trim());
      const row: any = {};
      headers.forEach((h, i) => {
        const v = cells[i];
        if (h === "amount" || h === "taxAmount") row[h] = parseFloat(v) || 0;
        else row[h] = v;
      });
      return row;
    });
  };

  const handleImport = async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const rows = parseCsv(csv);
      if (rows.length === 0) { setResult({ error: "No rows to import. Check your CSV format." }); return; }
      const res = await importInvoices(rows);
      setResult(res);
      if (res.imported > 0) setCsv("");
    } catch (e: any) {
      setResult({ error: e.message || "Import failed" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Imports</h1>
        <p className="text-sm text-stone-500 mt-1">Bulk-import invoices from a CSV file</p>
      </div>

      <Card className="mb-4">
        <h3 className="text-sm font-semibold text-stone-900 mb-3">CSV format</h3>
        <p className="text-sm text-stone-600 mb-3">Required columns: <code className="font-mono text-xs bg-stone-100 px-1.5 py-0.5 rounded">invoiceNumber, customerCode, invoiceDate, dueDate, amount</code></p>
        <p className="text-sm text-stone-600 mb-3">Optional: <code className="font-mono text-xs bg-stone-100 px-1.5 py-0.5 rounded">projectCode, taxAmount, currency, poNumber</code></p>
        <Button variant="secondary" size="sm" onClick={() => setCsv(SAMPLE_CSV)}>Load sample data</Button>
      </Card>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-stone-900">Paste CSV</h3>
          <span className="text-[11px] text-stone-500">{csv ? `${csv.split(/\r?\n/).length - 1} rows` : "Empty"}</span>
        </div>
        <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={10}
          className="w-full text-xs rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none p-3 font-mono"
          placeholder="invoiceNumber,customerCode,..." />
        <div className="flex justify-end mt-3">
          <Button icon={Upload} onClick={handleImport} disabled={!csv.trim() || submitting}>{submitting ? "Importing…" : "Import"}</Button>
        </div>

        {result && (
          <div className="mt-4 pt-4 border-t border-stone-100">
            {result.error ? (
              <div className="flex items-start gap-2 bg-rose-50 ring-1 ring-rose-200 rounded-md p-3">
                <AlertTriangle size={16} className="text-rose-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-rose-800">{result.error}</div>
              </div>
            ) : (
              <>
                {result.imported > 0 && (
                  <div className="flex items-center gap-2 bg-emerald-50 ring-1 ring-emerald-200 rounded-md p-3 mb-2">
                    <Check size={16} className="text-emerald-600" />
                    <div className="text-sm text-emerald-800">Imported {result.imported} invoices</div>
                  </div>
                )}
                {result.errors && result.errors.length > 0 && (
                  <div className="bg-amber-50 ring-1 ring-amber-200 rounded-md p-3">
                    <div className="text-sm font-medium text-amber-800 mb-2">{result.errors.length} rows skipped:</div>
                    <ul className="text-xs text-amber-700 space-y-1">
                      {result.errors.slice(0, 10).map((e: any, i: number) => <li key={i}>Row {e.row}: {e.message}</li>)}
                      {result.errors.length > 10 && <li>...and {result.errors.length - 10} more</li>}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
