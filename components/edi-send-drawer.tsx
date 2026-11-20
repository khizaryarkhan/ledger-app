"use client";

/**
 * "Send by EDI" for one purchase order (Phase 1, manual delivery). Shows the
 * partner and anything that stops the file, generates the X12 850, and lets
 * the person download it, deliver it through the partner's own channel, and
 * mark it sent. Rules: lib/edi/**.
 */

import { useEffect, useState } from "react";
import { Download, Check, Loader, FileCode2, Ban } from "lucide-react";
import { Drawer } from "@/components/form-kit";
import { fmt } from "@/lib/format";

type Problem = { lineNo: number | null; message: string };
type Msg = { id: string; status: string; ackStatus?: string | null; direction?: string; interchangeNo: number; fileName: string; test: boolean; createdAt: string; sentAt: string | null; voidReason: string | null };

/** What the drawer sends: a purchase order (850, the default), or a Sales Order (855) and later shipments and invoices. */
export type EdiSendKind = { path: string; doc: string; noun: string };
export const EDI_PO: EdiSendKind = { path: "purchase-orders", doc: "850", noun: "purchase order" };
export const EDI_SO_ACK: EdiSendKind = { path: "sales-orders", doc: "855", noun: "sales order" };

export function EdiSendDrawer({ po, kind = EDI_PO, onClose, onChanged }: { po: { id: string; docNumber: string | null; partyLabel?: string | null }; kind?: EdiSendKind; onClose: () => void; onChanged?: (msg: string) => void }) {
  const base = `/api/edi/${kind.path}/${po.id}`;
  const [data, setData] = useState<{ partner: any; problems: Problem[]; messages: Msg[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    const r = await fetch(base);
    const d = await r.json().catch(() => null);
    if (!r.ok) { setErr(d?.error || "Could not check this order."); setData({ partner: null, problems: [], messages: [] }); return; }
    setData(d);
  }
  useEffect(() => { load(); }, [po.id]);

  async function generate() {
    setBusy(true); setErr("");
    const r = await fetch(base, { method: "POST" });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d?.error || "Could not generate the file."); if (d?.problems) setData(x => x ? { ...x, problems: d.problems } : x); return; }
    load();
  }

  async function act(m: Msg, action: "sent" | "void") {
    let reason = "";
    if (action === "void") { reason = prompt("Why should this file not be sent?") ?? ""; if (!reason.trim()) return; }
    setErr("");
    const r = await fetch(`/api/edi/messages/${m.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not change the file."); return; }
    if (action === "sent") onChanged?.(`${po.docNumber ?? "Order"} marked sent by EDI.`);
    load();
  }

  const waiting = data?.messages.find(m => m.status === "generated") ?? null;
  const blocked = !data?.partner || (data?.problems.length ?? 0) > 0;

  return (
    <Drawer title={`Send by EDI · ${po.docNumber ?? kind.noun}`} subtitle={po.partyLabel ?? undefined} onClose={onClose} size="lg">
      <div className="space-y-4">
        {data === null && <p className="text-[12px] text-stone-500">Checking the order…</p>}
        {data?.partner && (
          <div className="text-[12px] text-stone-400">
            X12 {data.partner.version} to <span className="font-mono text-stone-300">{data.partner.receiverId}</span>
            {data.partner.mode === "test" ? <span className="ml-1.5 text-amber-400">test mode</span> : null}
            {" · "}you download the file and deliver it through the partner's own channel, then mark it sent.
          </div>
        )}
        {(data?.problems.length ?? 0) > 0 && (
          <div className="rounded-lg border border-amber-900/60 bg-amber-950/20 px-3.5 py-3 space-y-1.5">
            <div className="text-[12px] font-semibold text-amber-300">This {kind.noun} can't go by EDI yet</div>
            {data!.problems.map((p, i) => (
              <div key={i} className="text-[12px] text-stone-300">{p.lineNo != null ? <span className="text-stone-500">Line {p.lineNo}: </span> : null}{p.message}</div>
            ))}
          </div>
        )}
        {err && <p className="text-[12px] text-rose-400">{err}</p>}

        {data && !waiting && (
          <button onClick={generate} disabled={busy || blocked}
            className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary hover:bg-primary-hover text-white text-[12.5px] font-medium disabled:opacity-50">
            {busy ? <Loader size={13} className="animate-spin" /> : <FileCode2 size={14} />} Generate X12 {kind.doc}
          </button>
        )}

        {(data?.messages.length ?? 0) > 0 && (
          <div className="space-y-2">
            <h3 className="text-[11px] font-semibold text-stone-400 uppercase tracking-wider">Files for this order</h3>
            {data!.messages.map(m => (
              <div key={m.id} className="rounded-lg border border-stone-800 px-3 py-2.5 flex items-center justify-between gap-3">
                <div className="min-w-0 text-[12px]">
                  <div className="font-mono text-stone-200 truncate">{m.fileName}</div>
                  <div className="text-stone-500">
                    Control no. {m.interchangeNo}{m.test ? " · test" : ""} · {m.status === "sent" ? (m.ackStatus ? `sent, ${m.ackStatus === "accepted" ? "accepted by partner" : m.ackStatus.replace(/_/g, " ")}` : "sent, not acknowledged yet") : m.status === "void" ? `void${m.voidReason ? `: ${m.voidReason}` : ""}` : "waiting to be sent"}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <a href={`/api/edi/messages/${m.id}?download=1`} className="p-1.5 rounded hover:bg-stone-700 text-stone-400 hover:text-stone-200" title="Download the file" aria-label="Download"><Download size={14} /></a>
                  {m.status === "generated" && (
                    <>
                      <button onClick={() => act(m, "sent")} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-[11.5px] font-medium"><Check size={12} /> Mark sent</button>
                      <button onClick={() => act(m, "void")} className="p-1.5 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400" title="Void: this file must not be sent" aria-label="Void"><Ban size={13} /></button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {waiting && <p className="text-[11.5px] text-stone-500">Changed the order? Void the waiting file and generate a new one; each file keeps its own control number.</p>}
          </div>
        )}
      </div>
    </Drawer>
  );
}
