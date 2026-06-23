"use client";

import { useState, useEffect } from "react";
import { Modal, Button } from "@/components/ui";
import { Phone, Loader, GripVertical } from "lucide-react";

type Lead = { id: string; fullName: string; companyName?: string | null; email?: string; status: string; createdAt?: string };

const COLUMNS = [
  { key: "new",       label: "New",       color: "border-sky-500/40",     dot: "bg-sky-400" },
  { key: "contacted", label: "Contacted", color: "border-blue-500/40",    dot: "bg-blue-400" },
  { key: "qualified", label: "Qualified", color: "border-violet-500/40",  dot: "bg-violet-400" },
  { key: "converted", label: "Won",       color: "border-emerald-500/40", dot: "bg-emerald-400" },
  { key: "rejected",  label: "Lost",      color: "border-rose-500/40",    dot: "bg-rose-400" },
];

// outcome → suggested status + whether to schedule a next step
const OUTCOMES: { key: string; label: string; status: string; next: boolean }[] = [
  { key: "no_answer",  label: "No answer / VM", status: "contacted", next: true },
  { key: "connected",  label: "Connected",      status: "contacted", next: true },
  { key: "interested", label: "Interested",     status: "qualified", next: true },
  { key: "not_now",    label: "Not now",        status: "contacted", next: true },
  { key: "won",        label: "Won",            status: "converted", next: false },
  { key: "lost",       label: "Lost",           status: "rejected",  next: false },
];

function ageDays(createdAt?: string) {
  if (!createdAt) return null;
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000);
}

export function LeadsBoard({ leads, onOpen, onReload, onToast }: {
  leads: Lead[]; onOpen: (id: string) => void; onReload: () => void; onToast: (t: any) => void;
}) {
  const [local, setLocal] = useState<Lead[]>(leads);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dispo, setDispo] = useState<Lead | null>(null);

  useEffect(() => { setLocal(leads); }, [leads]);

  const move = async (id: string, status: string) => {
    const prev = local;
    setLocal(ls => ls.map(l => l.id === id ? { ...l, status } : l));   // optimistic
    try {
      const r = await fetch(`/api/admin/leads/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      if (!r.ok) throw new Error();
      onToast({ type: "success", message: `Moved to ${status}` });
    } catch {
      setLocal(prev); onToast({ type: "error", message: "Failed to move" });
    }
  };

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3 min-w-[1000px]">
        {COLUMNS.map(col => {
          const cards = local.filter(l => l.status === col.key);
          return (
            <div key={col.key}
              onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragId) { move(dragId, col.key); setDragId(null); } }}
              className={`flex-1 min-w-[190px] rounded-xl border ${col.color} bg-stone-900/40`}>
              <div className="px-3 py-2 border-b border-stone-800 flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${col.dot}`} />
                <span className="text-xs font-semibold text-white">{col.label}</span>
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-stone-800 text-stone-400">{cards.length}</span>
              </div>
              <div className="p-2 space-y-2 min-h-[120px] max-h-[60vh] overflow-y-auto">
                {cards.map(l => {
                  const age = ageDays(l.createdAt);
                  return (
                    <div key={l.id} draggable
                      onDragStart={() => setDragId(l.id)} onDragEnd={() => setDragId(null)}
                      className={`group rounded-lg border border-stone-800 bg-stone-900 p-2.5 cursor-grab active:cursor-grabbing hover:border-stone-600 ${dragId === l.id ? "opacity-50" : ""}`}>
                      <div className="flex items-start gap-1.5">
                        <GripVertical size={12} className="text-stone-700 mt-0.5 shrink-0" />
                        <button onClick={() => onOpen(l.id)} className="min-w-0 flex-1 text-left">
                          <p className="text-xs font-medium text-stone-200 truncate">{l.fullName}</p>
                          {l.companyName && <p className="text-[11px] text-stone-500 truncate">{l.companyName}</p>}
                        </button>
                      </div>
                      <div className="flex items-center justify-between mt-2 pl-4">
                        <span className="text-[10px] text-stone-600">{age != null ? `${age}d old` : ""}</span>
                        {(col.key === "new" || col.key === "contacted" || col.key === "qualified") && (
                          <button onClick={() => setDispo(l)}
                            className="text-[10px] flex items-center gap-1 px-1.5 py-0.5 rounded border border-stone-700 text-stone-400 hover:text-emerald-300 hover:border-emerald-700/50 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Phone size={9} /> Log
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
                {cards.length === 0 && <p className="text-[11px] text-stone-600 text-center py-4">Drop leads here</p>}
              </div>
            </div>
          );
        })}
      </div>

      {dispo && <DispositionModal lead={dispo} onClose={() => setDispo(null)} onDone={onReload} onToast={onToast} />}
    </div>
  );
}

// ── One-click disposition: log the call outcome, set status, schedule next step ──
function DispositionModal({ lead, onClose, onDone, onToast }: { lead: Lead; onClose: () => void; onDone: () => void; onToast: (t: any) => void }) {
  const [outcome, setOutcome] = useState(OUTCOMES[1]);
  const [note, setNote]       = useState("");
  const [days, setDays]       = useState("3");
  const [nextTitle, setNextTitle] = useState(`Follow up with ${lead.fullName}`);
  const [saving, setSaving]   = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const calls: Promise<any>[] = [];
      // 1. status
      calls.push(fetch(`/api/admin/leads/${lead.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: outcome.status }) }));
      // 2. note (the logged activity)
      const noteBody = `Call — ${outcome.label}${note.trim() ? `: ${note.trim()}` : ""}`;
      calls.push(fetch(`/api/admin/leads/${lead.id}/notes`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ body: noteBody }) }));
      // 3. next step (skip for won/lost)
      if (outcome.next && nextTitle.trim()) {
        const due = new Date(Date.now() + (parseInt(days) || 3) * 86400000).toISOString();
        calls.push(fetch(`/api/admin/leads/${lead.id}/tasks`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: nextTitle.trim(), dueDate: due }) }));
      }
      await Promise.all(calls);
      onToast({ type: "success", message: "Logged" + (outcome.next ? " · next step set" : "") });
      onDone(); onClose();
    } catch {
      onToast({ type: "error", message: "Failed to log" });
    } finally { setSaving(false); }
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-emerald-500 focus:outline-none";

  return (
    <Modal open onClose={onClose} title={`Log activity — ${lead.fullName}`}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={save} disabled={saving}>{saving && <Loader size={13} className="animate-spin mr-1" />}{saving ? "Saving…" : "Log & set next step"}</Button></>}>
      <div className="px-5 py-5 space-y-4">
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">Outcome</label>
          <div className="grid grid-cols-3 gap-1.5">
            {OUTCOMES.map(o => (
              <button key={o.key} onClick={() => setOutcome(o)}
                className={`h-8 text-[11px] rounded-md ring-1 ${outcome.key === o.key ? "ring-emerald-500 bg-emerald-500/10 text-emerald-300" : "ring-stone-700 text-stone-400 hover:text-stone-200"}`}>
                {o.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-stone-600 mt-1.5">Moves lead to <span className="text-stone-400">{outcome.status}</span>.</p>
        </div>
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">Note <span className="text-stone-600">(optional)</span></label>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="What was said…" className={inp} />
        </div>
        {outcome.next && (
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-stone-400 block mb-1.5">Next step</label>
              <input value={nextTitle} onChange={e => setNextTitle(e.target.value)} className={inp} />
            </div>
            <div>
              <label className="text-xs text-stone-400 block mb-1.5">In (days)</label>
              <input value={days} onChange={e => setDays(e.target.value)} inputMode="numeric" className={inp} />
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
