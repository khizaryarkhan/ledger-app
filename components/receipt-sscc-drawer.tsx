"use client";

/**
 * Record the SSCCs on a goods receipt (0143): the pallet / carton codes on the
 * supplier's labels. Type or scan (18 digits, "(00)…" or the raw "00…" scan);
 * the check digit is verified, so a misread label is caught at the dock.
 * Moves no stock. Rules: lib/inventory/sscc.ts.
 */

import { useEffect, useRef, useState } from "react";
import { Trash2, ScanLine, Loader } from "lucide-react";
import { Drawer, controlInset } from "@/components/form-kit";
import { normaliseSscc, showSscc } from "@/lib/inventory/sscc";

type Row = { id: string; sscc: string };

export function ReceiptSsccDrawer({ receipt, onClose }: { receipt: { id: string; receiptNo?: string | null; supplierLabel?: string | null }; onClose: () => void }) {
  const base = `/api/inventory/receiving/${receipt.id}/sscc`;
  const [rows, setRows] = useState<Row[] | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const input = useRef<HTMLInputElement>(null);

  async function load() {
    const r = await fetch(base);
    const d = await r.json().catch(() => null);
    if (!r.ok) { setErr(d?.error || "Could not load."); setRows([]); return; }
    setRows(Array.isArray(d) ? d : []);
  }
  useEffect(() => { load(); }, [receipt.id]);

  async function add() {
    const n = normaliseSscc(code);
    if (n.ok === false) { setErr(n.error); return; }
    setBusy(true); setErr("");
    const r = await fetch(base, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sscc: n.sscc }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not record it."); return; }
    setCode("");
    load();
    input.current?.focus();
  }

  async function remove(row: Row) {
    setErr("");
    const r = await fetch(`${base}?id=${row.id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not remove."); return; }
    load();
  }

  return (
    <Drawer title={`Pallet labels · ${receipt.receiptNo || "receipt"}`} subtitle={receipt.supplierLabel ?? undefined} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-[12px] text-stone-400">Scan or type the SSCC on each pallet or carton label the supplier sent. Press Enter after each one.</p>
        <div className="flex items-center gap-2">
          <input ref={input} autoFocus value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }}
            placeholder="(00) 18 digits" className={`${controlInset} font-mono`} aria-label="SSCC" />
          <button type="button" onClick={add} disabled={busy || !code.trim()} className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-medium disabled:opacity-50 shrink-0">
            {busy ? <Loader size={12} className="animate-spin" /> : <ScanLine size={13} />} Record
          </button>
        </div>
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        {rows === null && <p className="text-[12px] text-stone-500">Loading…</p>}
        {rows !== null && rows.length === 0 && <p className="text-[12px] text-stone-500">None recorded yet.</p>}
        {(rows ?? []).map(r => (
          <div key={r.id} className="flex items-center justify-between rounded-lg border border-stone-800 px-3 py-2">
            <span className="font-mono text-[12.5px] text-stone-200">{showSscc(r.sscc)}</span>
            <button type="button" onClick={() => remove(r)} className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400" title="Remove" aria-label={`Remove ${r.sscc}`}><Trash2 size={13} /></button>
          </div>
        ))}
        {rows !== null && rows.length > 0 && <p className="text-[11px] text-stone-500">{rows.length} recorded.</p>}
      </div>
    </Drawer>
  );
}
