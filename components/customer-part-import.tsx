"use client";

/**
 * Paste a customer's whole part-number list into the customer drawer: "our item or SKU, their part number[, level]"
 * per line. Preview first (nothing is saved and every line says what it matches or why not), then save the lines that
 * matched. Rules and matching: lib/inventory/part-numbers-bulk(-server).ts.
 */

import { useState } from "react";
import { Tags } from "lucide-react";
import { controlInset } from "@/components/form-kit";

type Result = { line: number; ref: string; code: string; level: string; ok: boolean; message: string; target?: string };
type Reply = { committed: boolean; problems: { line: number; message: string }[]; results: Result[]; summary: { lines: number; matched: number; failed: number } };

export function CustomerPartImport({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run(commit: boolean) {
    setBusy(true); setErr("");
    const r = await fetch("/api/inventory/customer-part-numbers/bulk", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ customerId, text, commit }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d?.error || "Could not read the list."); return; }
    setReply(d);
  }

  if (!open) {
    return <button type="button" onClick={() => setOpen(true)} className="flex items-center gap-1.5 text-[12px] font-medium text-emerald-400 hover:text-emerald-300"><Tags size={13} /> Import their part numbers</button>;
  }
  return (
    <div className="space-y-2">
      <div className="text-[12px] font-semibold text-stone-300">Their part numbers</div>
      <p className="text-[11px] text-stone-500">One line each: our item name or SKU code, their part number, and optionally the level (unit, inner, outer). Paste from a spreadsheet.</p>
      <textarea value={text} onChange={e => { setText(e.target.value); setReply(null); }} rows={5} className={`${controlInset} font-mono`} placeholder={"Salted peanuts 500g\tAB-1001\nPEANUT-CASE\tAB-1001-C\touter"} aria-label="Part number list" />
      {err && <p className="text-[12px] text-rose-400">{err}</p>}
      {reply && (
        <div className="rounded-lg border border-stone-800 max-h-56 overflow-auto">
          <table className="w-full text-[12px]"><tbody>
            {reply.problems.map(p => <tr key={`p${p.line}`} className="border-b border-stone-800/50"><td className="px-2 py-1 text-stone-500">Line {p.line}</td><td className="px-2 py-1 text-rose-400" colSpan={2}>{p.message}</td></tr>)}
            {reply.results.map(r => (
              <tr key={r.line} className="border-b border-stone-800/50">
                <td className="px-2 py-1 text-stone-500">Line {r.line}</td>
                <td className="px-2 py-1 font-mono text-stone-200">{r.code}</td>
                <td className={`px-2 py-1 ${r.ok ? "text-stone-300" : "text-rose-400"}`}>{r.ok ? `${reply.committed ? "Saved: " : "Matches "}${r.target}` : r.message}</td>
              </tr>
            ))}
          </tbody></table>
        </div>
      )}
      {reply && <p className="text-[11px] text-stone-400">{reply.summary.matched} of {reply.summary.lines} lines {reply.committed ? "saved" : "match"}{reply.summary.failed ? `, ${reply.summary.failed} need attention` : ""}.</p>}
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => run(false)} disabled={busy || !text.trim()} className="h-8 px-3 rounded-md bg-stone-700 hover:bg-stone-600 text-white text-[12px] font-medium disabled:opacity-50">{busy ? "Reading…" : "Check the list"}</button>
        <button type="button" onClick={() => run(true)} disabled={busy || !reply || reply.committed || reply.summary.matched === 0} className="h-8 px-3 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[12px] font-medium disabled:opacity-50">Save the matched lines</button>
        <button type="button" onClick={() => { setOpen(false); setReply(null); setErr(""); }} className="text-[12px] text-stone-400 hover:text-stone-200">Close</button>
      </div>
    </div>
  );
}
