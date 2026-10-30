"use client";

/**
 * The purchase-order workflow's side drawers: send to the supplier, review the
 * supplier's proposal, stop expecting an item, reject, and manage stages.
 *
 * Every one is a form-kit Drawer with the primary action pinned in the footer
 * (CLAUDE.md "A form opens in a SIDE DRAWER"). Rules live in
 * lib/accounting/po-workflow.ts; nothing here decides what is allowed.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader, Trash2, Plus, Paperclip, Link2 } from "lucide-react";
import { Drawer, DrawerFooter, Field, SelectField, controlInset, controlMultiline } from "@/components/form-kit";
import { fmt, formatDate } from "@/lib/format";
import { CLOSE_REASONS } from "@/lib/accounting/po-workflow";
import { COLOR_OPTIONS } from "@/lib/stages";
import type { PoStageSet } from "@/components/po-stage-chip";

type Done = (message: string) => void;

async function post(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const d = await res.json().catch(() => ({}));
  return { ok: res.ok, d };
}

/* ───────────────────────── Stop expecting an item ───────────────────────── */

export interface CloseLineTarget {
  id: string; name: string; orderUom: string | null; baseUom: string | null;
  qty: number; receivedOrder: number; balanceOrder: number; balanceBase: number; rate: number;
}

export function ClosePoLineDrawer({ line, currency, onClose, onDone }: { line: CloseLineTarget; currency?: string | null; onClose: () => void; onDone: Done }) {
  const [code, setCode] = useState(CLOSE_REASONS[0].code);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const uom = line.orderUom || line.baseUom || "";
  const value = line.balanceOrder * line.rate;

  async function save() {
    setBusy(true); setErr("");
    const { ok, d } = await post(`/api/inventory/po-lines/${line.id}/close`, { code, note: note.trim() || null });
    setBusy(false);
    if (!ok) { setErr(d?.error || "Could not close the line."); return; }
    onDone(`Stopped expecting ${fmt.qty(line.balanceOrder)} ${uom} of ${line.name}.`);
  }

  return (
    <Drawer title="Stop expecting this item" subtitle={line.name} onClose={onClose}
      footer={<DrawerFooter saving={busy} onClose={onClose} onSave={save} saveLabel={`Close ${fmt.qty(line.balanceOrder)} ${uom}`.trim()} err={err} />}>
      <div className="grid grid-cols-3 gap-3 mb-5 rounded-lg border border-stone-800 bg-stone-950 p-3.5 text-[12px]">
        <div><div className="text-stone-500">Ordered</div><div className="mt-1 text-[15px] text-stone-100 tabular-nums">{fmt.qty(line.qty)} {uom}</div></div>
        <div><div className="text-stone-500">Received</div><div className="mt-1 text-[15px] text-stone-100 tabular-nums">{fmt.qty(line.receivedOrder)} {uom}</div></div>
        <div><div className="text-stone-500">Will be closed</div>
          <div className="mt-1 text-[15px] text-amber-300 tabular-nums">{fmt.qty(line.balanceOrder)} {uom}</div>
          {line.rate > 0 && <div className="text-stone-500 tabular-nums">{fmt.money(value, currency ?? undefined)}</div>}
        </div>
      </div>
      <div className="space-y-4">
        <Field label="Reason" required>
          <SelectField inset value={code} onChange={e => setCode(e.target.value)}>
            {CLOSE_REASONS.map(r => <option key={r.code} value={r.code}>{r.label}</option>)}
          </SelectField>
        </Field>
        <Field label="Note" hint="Optional — shown on the order's history.">
          <textarea className={controlMultiline} rows={3} value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
        </Field>
      </div>
      <ul className="mt-6 space-y-1.5 text-[12px] leading-relaxed text-stone-400 border-t border-stone-800 pt-4 list-disc pl-4">
        <li>The balance becomes 0 and the line leaves Receiving and delivery-risk alerts.</li>
        <li>What was already received stays and can still be billed.</li>
        <li>The ordered quantity is kept and the line shows as <b className="text-stone-200">Closed short</b>.</li>
        <li>You can reopen it later. The order closes once every line is received or closed.</li>
      </ul>
    </Drawer>
  );
}

/* ─────────────────────────── Send to the supplier ───────────────────────── */

interface SendDefaults {
  supplierName: string; to: string; subject: string; body: string; orgName: string;
  orders: { id: string; docNumber: string | null; total: number; currency: string | null }[];
}

export function SendPoDrawer({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: Done }) {
  const [def, setDef] = useState<SendDefaults | null>(null);
  const [to, setTo] = useState("");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [loadErr, setLoadErr] = useState("");

  useEffect(() => {
    let live = true;
    fetch(`/api/trade-documents/purchase-orders/send?ids=${ids.join(",")}`).then(r => r.json()).then(d => {
      if (!live) return;
      if (d?.error) { setLoadErr(d.error); return; }
      setDef(d); setTo(d.to || ""); setSubject(d.subject); setBody(d.body);
    }).catch(() => live && setLoadErr("Could not load this email."));
    return () => { live = false; };
  }, [ids]);

  async function send() {
    if (!to.trim()) { setErr("Enter at least one recipient."); return; }
    setBusy(true); setErr("");
    const { ok, d } = await post("/api/trade-documents/purchase-orders/send", { ids, to: to.trim(), cc: cc.trim() || undefined, subject, body });
    setBusy(false);
    if (!ok) { setErr(d?.error || "Could not send the email."); return; }
    const nums = def?.orders.map(o => o.docNumber).filter(Boolean).join(", ");
    onDone(`Sent ${nums || "the order"} to ${to.trim()} — moved to Sent.`);
  }

  const total = def?.orders.reduce((s, o) => s + o.total, 0) ?? 0;
  return (
    <Drawer title={`Send purchase order${ids.length > 1 ? "s" : ""}`}
      subtitle={def ? `${def.orders.map(o => o.docNumber).filter(Boolean).join(", ")} · ${def.supplierName}${def.orders.length === 1 ? ` · ${fmt.money(total, def.orders[0].currency ?? undefined)}` : ""}` : "Loading…"}
      onClose={onClose}
      footer={<DrawerFooter saving={busy} onClose={onClose} onSave={send} saveLabel="Send to supplier" saveDisabled={!def} err={err} />}>
      {loadErr ? <div className="text-[12px] text-rose-400">{loadErr}</div>
        : !def ? <div className="text-[12px] text-stone-500 inline-flex items-center gap-1.5"><Loader size={12} className="animate-spin" /> Loading…</div> : (
          <div className="space-y-4">
            <Field label="From"><div className={`${controlInset} flex items-center text-stone-400`}>Your connected mailbox</div></Field>
            <Field label="To" required hint={ids.length > 1 ? "Several orders for one supplier go in a single email." : "Filled from the supplier's contact. Separate several addresses with commas."}>
              <input className={controlInset} value={to} onChange={e => setTo(e.target.value)} placeholder="orders@supplier.com" />
            </Field>
            <Field label="Cc"><input className={controlInset} value={cc} onChange={e => setCc(e.target.value)} placeholder="Optional" /></Field>
            <Field label="Subject" required hint="{ref} becomes the email's reference number when it is sent.">
              <input className={controlInset} value={subject} onChange={e => setSubject(e.target.value)} />
            </Field>
            <Field label="Message" required>
              <textarea className={controlMultiline} rows={8} value={body} onChange={e => setBody(e.target.value)} />
            </Field>
            <div>
              <div className="text-[12px] text-stone-400 mb-2">In this email</div>
              <div className="space-y-2">
                {def.orders.map(o => (
                  <div key={o.id} className="rounded-lg border border-stone-800 bg-stone-950 px-3 py-2.5 text-[12px]">
                    <div className="flex items-center gap-2 text-stone-200"><Paperclip size={12} className="text-stone-500" /> {o.docNumber}.pdf <span className="text-stone-500">· copy of the order</span></div>
                    <div className="flex items-center gap-2 mt-1.5 text-stone-200"><Link2 size={12} className="text-stone-500" /> Supplier portal button <span className="text-stone-500">· private page for this order · valid 30 days</span></div>
                  </div>
                ))}
              </div>
            </div>
            <p className="border-t border-stone-800 pt-4 text-[12px] leading-relaxed text-stone-400">
              After sending, each order moves from <b className="text-stone-200">Created</b> to <b className="text-stone-200">Sent</b> and the email is saved in its history.
            </p>
          </div>
        )}
    </Drawer>
  );
}

/* ───────────────────── Review what the supplier proposed ────────────────── */

interface ProposalLine {
  lineId: string; name: string; orderUom: string | null; rate: number; qty: number; date: string | null; amount: number;
  change: { proposedQty: number; proposedDate: string | null } | null;
}
interface Proposal { responseId: string; message: string | null; at: string; doc: { docNumber: string | null; partyLabel: string | null; currency: string | null; total: number }; lines: ProposalLine[] }

export function ReviewProposalDrawer({ docId, onClose, onDone }: { docId: string; onClose: () => void; onDone: Done }) {
  const [p, setP] = useState<Proposal | null | undefined>(undefined);
  const [accept, setAccept] = useState<Record<string, boolean>>({});
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch(`/api/trade-documents/purchase-orders/${docId}/workflow?view=proposal`).then(r => r.json()).then((d: Proposal | null) => {
      setP(d);
      if (d) setAccept(Object.fromEntries(d.lines.filter(l => l.change).map(l => [l.lineId, true])));
    }).catch(() => setP(null));
  }, [docId]);

  const newNet = useMemo(() => (p?.lines ?? []).reduce((s, l) => s + (l.change && accept[l.lineId] ? l.change.proposedQty * l.rate : l.amount), 0), [p, accept]);
  const oldNet = useMemo(() => (p?.lines ?? []).reduce((s, l) => s + l.amount, 0), [p]);
  const accepted = Object.values(accept).filter(Boolean).length;

  async function decide() {
    if (!p) return;
    setBusy(true); setErr("");
    const { ok, d } = await post(`/api/trade-documents/purchase-orders/${docId}/workflow`, { action: "decide", responseId: p.responseId, accept, reply: reply.trim() || null });
    setBusy(false);
    if (!ok) { setErr(d?.error || "Could not save your decision."); return; }
    onDone(d.accepted ? `Accepted ${d.accepted} change${d.accepted === 1 ? "" : "s"} on ${p.doc.docNumber ?? "the order"}.` : `Kept ${p.doc.docNumber ?? "the order"} as originally ordered.`);
  }

  const ccy = p?.doc.currency ?? undefined;
  return (
    <Drawer title="Supplier proposed changes" size="lg"
      subtitle={p ? `${p.doc.docNumber ?? ""} · ${p.doc.partyLabel ?? ""} · via supplier portal` : undefined} onClose={onClose}
      footer={<DrawerFooter saving={busy} onClose={onClose} onSave={decide} saveDisabled={!p} saveLabel={accepted ? "Accept changes" : "Keep original"} err={err} />}>
      {p === undefined ? <div className="text-[12px] text-stone-500 inline-flex items-center gap-1.5"><Loader size={12} className="animate-spin" /> Loading…</div>
        : p === null ? <div className="text-[12px] text-stone-400">Nothing is waiting for your decision on this order.</div> : (
          <div className="space-y-3">
            {p.lines.map(l => !l.change ? (
              <div key={l.lineId} className="flex items-center justify-between rounded-lg border border-stone-800 bg-stone-950 px-4 py-3 text-[12px]">
                <div className="text-stone-200">{l.name}</div>
                <div className="text-stone-500 tabular-nums">{fmt.qty(l.qty)} {l.orderUom} · {l.date ? formatDate(l.date) : "no date"} · no change</div>
              </div>
            ) : (
              <div key={l.lineId} className="rounded-lg border border-amber-800/60 bg-stone-950 p-4">
                <div className="flex items-start justify-between">
                  <div className="text-[13px] font-semibold text-stone-100">{l.name}</div>
                  <span className="rounded-full border border-amber-800/60 px-2 py-0.5 text-[11px] text-amber-400">Changed</span>
                </div>
                <div className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
                  <div><div className="text-stone-500">Quantity</div>
                    <div className="mt-1 tabular-nums"><span className="text-stone-500 line-through">{fmt.qty(l.qty)} {l.orderUom}</span> <b className="ml-1 text-stone-100">{fmt.qty(l.change.proposedQty)} {l.orderUom}</b></div></div>
                  <div><div className="text-stone-500">Delivery date</div>
                    <div className="mt-1 tabular-nums"><span className="text-stone-500 line-through">{l.date ? formatDate(l.date) : "—"}</span> <b className="ml-1 text-stone-100">{l.change.proposedDate ? formatDate(l.change.proposedDate) : "—"}</b></div></div>
                  <div className="text-right"><div className="text-stone-500">Line total</div>
                    <div className="mt-1 tabular-nums"><span className="text-stone-500 line-through">{fmt.money(l.amount, ccy)}</span> <b className="ml-1 text-stone-100">{fmt.money(l.change.proposedQty * l.rate, ccy)}</b></div></div>
                </div>
                <div className="mt-3 flex gap-5 text-[13px]">
                  {([true, false] as const).map(v => (
                    <label key={String(v)} className="inline-flex items-center gap-2 cursor-pointer text-stone-200">
                      <input type="radio" name={`d-${l.lineId}`} checked={accept[l.lineId] === v} onChange={() => setAccept(a => ({ ...a, [l.lineId]: v }))} className="accent-emerald-500" />
                      {v ? "Accept" : "Keep original"}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            {p.message && <div className="rounded-lg bg-stone-950 px-4 py-3 text-[12px] text-stone-300">Supplier note: “{p.message}”</div>}
            <div className="flex items-center justify-between px-1 pt-1 text-[13px]">
              <span className="text-stone-400">Order total after your decision (before tax)</span>
              <span className="tabular-nums font-semibold text-stone-100">
                {Math.abs(newNet - oldNet) > 0.004 && <span className="mr-2 text-[12px] font-normal text-stone-500 line-through">{fmt.money(oldNet, ccy)}</span>}{fmt.money(newNet, ccy)}
              </span>
            </div>
            <Field label="Reply to supplier" hint="Optional — emailed from your mailbox.">
              <textarea className={controlMultiline} rows={3} value={reply} onChange={e => setReply(e.target.value)} />
            </Field>
            <p className="border-t border-stone-800 pt-4 text-[12px] leading-relaxed text-stone-400">
              Accepting updates the quantities and total, keeps the original in the order's history, and moves it to <b className="text-stone-200">Confirmed</b>. Keeping the original leaves the order unchanged and the supplier's link open.
            </p>
          </div>
        )}
    </Drawer>
  );
}

/* ───────────────────────────────── Reject ───────────────────────────────── */

export function RejectPoDrawer({ docId, docNumber, onClose, onDone }: { docId: string; docNumber: string | null; onClose: () => void; onDone: Done }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    if (!reason.trim()) { setErr("A reason is required."); return; }
    setBusy(true); setErr("");
    const { ok, d } = await post(`/api/trade-documents/purchase-orders/${docId}/workflow`, { action: "reject", reason });
    setBusy(false);
    if (!ok) { setErr(d?.error || "Could not reject the order."); return; }
    onDone(`${docNumber ?? "The order"} marked Rejected.`);
  }
  return (
    <Drawer title="Reject this order" subtitle={docNumber ?? undefined} onClose={onClose}
      footer={<DrawerFooter saving={busy} onClose={onClose} onSave={save} saveLabel="Reject order" err={err} />}>
      <Field label="Reason" required hint="Kept on the order. You can reopen a rejected order later.">
        <textarea className={controlMultiline} rows={4} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
      </Field>
    </Drawer>
  );
}

/* ─────────────────────────────── Manage stages ──────────────────────────── */

export function ManageStagesDrawer({ stages, onClose, onChanged }: { stages: PoStageSet; onClose: () => void; onChanged: () => void }) {
  const [label, setLabel] = useState("");
  const [color, setColor] = useState("blue");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function run(method: string, body: unknown) {
    setBusy(true); setErr("");
    const { ok, d } = await post("/api/trade-documents/stages", body, method);
    setBusy(false);
    if (!ok) { setErr(d?.error || "Could not save."); return false; }
    onChanged();
    return true;
  }

  return (
    <Drawer title="Manage stages" subtitle="Your own stages sit beside the workflow's. Fulfilment stages are worked out from receipts." onClose={onClose}
      footer={<div className="flex items-center justify-end gap-3"><span className="mr-auto text-[12px] text-rose-400">{err}</span><button onClick={onClose} className="text-[13px] text-stone-400 hover:text-stone-200">Done</button></div>}>
      <div className="space-y-6">
        <section>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-stone-500">Set by the workflow</div>
          <div className="flex flex-wrap gap-2">
            {[...stages.system.filter(s => s.locked), ...stages.fulfilment].map(s => (
              <span key={s.key} className="rounded-full border border-stone-700 px-2.5 py-1 text-[12px] text-stone-300">{s.label}</span>
            ))}
          </div>
          <p className="mt-2 text-[12px] text-stone-500">These move on their own — when you send, when the supplier answers, when goods arrive.</p>
        </section>
        <section>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-stone-500">Stages you can pick</div>
          <div className="space-y-2">
            {[...stages.system.filter(s => !s.locked), ...stages.custom].map(s => {
              const custom = stages.custom.some(c => c.key === s.key);
              return (
                <div key={s.key} className="flex items-center gap-2">
                  <input className={`${controlInset} flex-1`} defaultValue={s.label} disabled={busy}
                    onBlur={e => { const v = e.target.value.trim(); if (v && v !== s.label) run("PATCH", { key: s.key, label: v }); }} />
                  {custom && (
                    <button onClick={() => confirm(`Delete the stage "${s.label}"?`) && run("DELETE", { key: s.key })} disabled={busy}
                      className="rounded p-2 text-stone-500 hover:bg-stone-800 hover:text-rose-400" aria-label={`Delete ${s.label}`}><Trash2 size={14} /></button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section>
          <div className="mb-2 text-[11px] uppercase tracking-wider text-stone-500">Add a stage</div>
          <div className="flex items-center gap-2">
            <input className={`${controlInset} flex-1`} placeholder="e.g. In transit" value={label} onChange={e => setLabel(e.target.value)} maxLength={40} />
            <div className="w-28"><SelectField inset value={color} onChange={e => setColor(e.target.value)} aria-label="Colour">
              {COLOR_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
            </SelectField></div>
            <button disabled={busy || !label.trim()} onClick={async () => { if (await run("POST", { label, color })) setLabel(""); }}
              className="inline-flex h-9 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-[13px] font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"><Plus size={14} /> Add</button>
          </div>
        </section>
      </div>
    </Drawer>
  );
}
