"use client";

/**
 * Supply Chain → EDI (module "edi"): the file log and the partner profiles.
 * Phase 1 delivery is manual: a file is generated from the purchase order
 * (Send by EDI on the PO list), downloaded, delivered through the partner's
 * own channel, and marked sent. Rules: lib/edi/**.
 */

import { useEffect, useState } from "react";
import { Plus, Download, RefreshCw, Pencil, Trash2, Upload, Loader } from "lucide-react";
import { Drawer, DrawerFooter, Field, SelectField, controlInset } from "@/components/form-kit";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { ISA_QUALIFIERS, X12_VERSIONS } from "@/lib/edi/partner";

type Tab = "files" | "partners";

export function EdiConsole() {
  const [tab, setTab] = useState<Tab>("files");
  const [files, setFiles] = useState<any[] | null>(null);
  const [partners, setPartners] = useState<any[] | null>(null);
  const [editing, setEditing] = useState<any | null>(null);
  const [uploading, setUploading] = useState(false);
  const [showing, setShowing] = useState<any | null>(null);
  const [err, setErr] = useState("");

  async function load() {
    setErr("");
    const [f, p] = await Promise.all([fetch("/api/edi/messages"), fetch("/api/edi/partners")]);
    const fd = await f.json().catch(() => null), pd = await p.json().catch(() => null);
    if (!f.ok || !p.ok) setErr(fd?.error || pd?.error || "Could not load EDI.");
    setFiles(Array.isArray(fd) ? fd : []); setPartners(Array.isArray(pd) ? pd : []);
  }
  useEffect(() => { load(); }, []);

  async function removePartner(p: any) {
    if (!confirm(`Delete the EDI profile for ${p.partyName}?`)) return;
    const r = await fetch(`/api/edi/partners/${p.id}`, { method: "DELETE" });
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not delete."); return; }
    load();
  }

  const pill = (t: Tab, label: string) => (
    <button onClick={() => setTab(t)} className={`h-8 px-3 rounded-md ring-1 text-[12px] ${tab === t ? "ring-stone-600 bg-stone-700 text-stone-100" : "ring-stone-700 bg-stone-800 text-stone-400 hover:text-stone-200"}`}>{label}</button>
  );

  return (
    <ListPage>
      <ListPageHeader title="EDI" subtitle="Purchase orders as X12 files for trading partners. Generate from the purchase order, download, deliver, mark sent; upload what the partner sends back.">
        {pill("files", "Files")}{pill("partners", "Partners")}
        <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh"><RefreshCw size={15} /></button>
        {tab === "files" && <button onClick={() => setUploading(true)} className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-[12px] font-medium"><Upload size={13} /> Upload a received file</button>}
        {tab === "partners" && <button onClick={() => setEditing({})} className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-primary hover:bg-primary-hover text-white text-[12px] font-medium"><Plus size={13} /> New partner</button>}
      </ListPageHeader>
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
        {err && <p className="text-[12.5px] text-rose-400">{err}</p>}
        {tab === "files" && (
          files === null ? <p className="text-[13px] text-stone-500">Loading…</p>
          : files.length === 0 ? <p className="text-[13px] text-stone-500 py-10 text-center">No files yet. Use Send by EDI on a purchase order.</p>
          : (
            <table className="w-full text-[12.5px]">
              <thead><tr className="text-left text-[12px] text-stone-400 border-b border-stone-800">
                <th className="py-2 pr-3">Partner</th><th className="py-2 pr-3">Way</th><th className="py-2 pr-3">Document</th><th className="py-2 pr-3">Control no.</th><th className="py-2 pr-3">Status</th><th className="py-2" />
              </tr></thead>
              <tbody>
                {files.map(m => (
                  <tr key={m.id} className="border-b border-stone-800/50">
                    <td className="py-2 pr-3 text-stone-200">{m.partyName || "—"}</td>
                    <td className="py-2 pr-3 text-stone-400">{m.direction === "in" ? "Received" : "Sent"}</td>
                    <td className="py-2 pr-3 text-stone-300">{m.docType} · {m.appDocNumber || "—"}{m.test ? <span className="ml-1.5 text-amber-400 text-[11px]">test</span> : null}</td>
                    <td className="py-2 pr-3 font-mono text-stone-400">{m.interchangeNo}</td>
                    <td className="py-2 pr-3">{statusCell(m, () => setShowing(m))}</td>
                    <td className="py-2 text-right"><a href={`/api/edi/messages/${m.id}?download=1`} className="inline-flex p-1.5 rounded hover:bg-stone-700 text-stone-400 hover:text-stone-200" title="Download" aria-label="Download"><Download size={14} /></a></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
        {tab === "partners" && (
          partners === null ? <p className="text-[13px] text-stone-500">Loading…</p>
          : partners.length === 0 ? <p className="text-[13px] text-stone-500 py-10 text-center">No partners yet. Add the supplier you exchange EDI with, using the IDs from their implementation guide.</p>
          : partners.map(p => (
            <article key={p.id} className="rounded-lg border border-stone-800 px-4 py-3 flex items-start justify-between gap-3">
              <div className="min-w-0 text-[12.5px]">
                <div className="text-stone-100 font-medium">{p.partyName}{!p.enabled && <span className="ml-2 text-[11px] text-stone-500">off</span>}{p.mode === "test" && <span className="ml-2 text-[11px] text-amber-400">test</span>}</div>
                <div className="text-stone-400 mt-0.5">X12 {p.version} · us <span className="font-mono">{p.senderQualifier}:{p.senderId}</span> → them <span className="font-mono">{p.receiverQualifier}:{p.receiverId}</span> · sends {(p.docsOut ?? []).join(", ")}</div>
                <div className="text-stone-500 mt-0.5">{p.requirePartNumber ? "their part number required" : "part number optional"}{p.requireGtin ? " · GTIN required" : ""}{Object.keys(p.unitOverrides ?? {}).length ? ` · ${Object.keys(p.unitOverrides).length} unit code(s)` : ""} · next control no. {p.nextControlNo}</div>
              </div>
              <div className="flex gap-1 shrink-0">
                <button onClick={() => setEditing(p)} className="p-1.5 rounded hover:bg-stone-700 text-stone-400 hover:text-stone-200" title="Edit" aria-label="Edit"><Pencil size={13} /></button>
                <button onClick={() => removePartner(p)} className="p-1.5 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400" title="Delete" aria-label="Delete"><Trash2 size={13} /></button>
              </div>
            </article>
          ))
        )}
      </div>
      {uploading && <UploadDrawer onClose={() => { setUploading(false); load(); }} />}
      {showing && <ResultDrawer message={showing} onClose={() => setShowing(null)} onChanged={() => { setShowing(null); load(); }} />}
      {editing && <PartnerDrawer partner={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </ListPage>
  );
}

const ACK_WORDS: Record<string, string> = { accepted: "accepted by partner", accepted_with_errors: "accepted with errors", partially_accepted: "partly accepted", rejected: "rejected by partner" };

/** One cell for both ways: an outbound file's send + acknowledgement, an inbound file's outcome. Colour only for what needs a person. */
function statusCell(m: any, open: () => void) {
  if (m.direction === "in") {
    const label = m.status === "processed" ? "applied" : m.status === "review" ? "needs review" : m.status === "ignored" ? "ignored (test file)" : m.status === "error" ? "failed" : m.status;
    const hot = m.status === "review" || m.status === "error";
    return <button onClick={open} className={`underline-offset-2 hover:underline ${hot ? "text-amber-400" : "text-stone-300"}`}>{label}</button>;
  }
  if (m.status === "generated") return <span className="text-amber-400">waiting to be sent</span>;
  if (m.status === "void") return <span className="text-stone-500">void{m.voidReason ? `: ${m.voidReason}` : ""}</span>;
  const ack = m.ackStatus ? ACK_WORDS[m.ackStatus] : "sent, not acknowledged yet";
  return <span className={m.ackStatus && m.ackStatus !== "accepted" ? "text-amber-400" : "text-stone-300"} title={m.error ?? undefined}>{ack}</span>;
}

/** Upload a file the partner sent. The result says what was done with each transaction set. */
function UploadDrawer({ onClose }: { onClose: () => void }) {
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<any | null>(null);

  async function pick(f: File | undefined) {
    setErr(""); setDone(null);
    if (!f) return;
    if (f.size > 2_000_000) { setErr("The file is larger than 2 MB."); return; }
    setFile({ name: f.name, content: await f.text() });
  }
  async function send() {
    if (!file) { setErr("Choose a file."); return; }
    setBusy(true); setErr("");
    const r = await fetch("/api/edi/inbound", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, content: file.content }) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setErr(d?.error || "Could not read the file."); return; }
    setDone(d);
  }
  return (
    <Drawer title="Upload a received file" subtitle="An X12 file your partner sent: a 997 acknowledgement or an 855 order acknowledgement." onClose={onClose} size="lg">
      <div className="space-y-4">
        <input type="file" accept=".x12,.edi,.txt,.dat,text/plain" onChange={e => pick(e.target.files?.[0])} className="text-[12.5px] text-stone-300" aria-label="X12 file" />
        {file && !done && (
          <button onClick={send} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md bg-primary hover:bg-primary-hover text-white text-[12.5px] font-medium disabled:opacity-50">
            {busy ? <Loader size={13} className="animate-spin" /> : <Upload size={14} />} Read {file.name}
          </button>
        )}
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        {done && (
          <div className="space-y-2">
            {done.duplicate && <p className="text-[12.5px] text-stone-300">This file was already received (same partner and interchange number), so nothing changed. Its first result:</p>}
            <Results results={done.results ?? []} />
          </div>
        )}
      </div>
    </Drawer>
  );
}

function Results({ results }: { results: any[] }) {
  if (!results.length) return <p className="text-[12.5px] text-stone-500">Nothing to report.</p>;
  return (
    <div className="space-y-2">
      {results.map((r, i) => (
        <div key={i} className={`rounded-lg border px-3.5 py-2.5 text-[12.5px] ${r.outcome === "review" ? "border-amber-900/60 bg-amber-950/20" : "border-stone-800"}`}>
          <div className="text-stone-200"><span className="font-mono text-stone-500 mr-1.5">{r.setId}</span>{r.summary}</div>
          {(r.reasons ?? []).map((x: string, j: number) => <div key={j} className="text-stone-400 mt-0.5">{x}</div>)}
        </div>
      ))}
    </div>
  );
}

function ResultDrawer({ message, onClose, onChanged }: { message: any; onClose: () => void; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function reprocess() {
    setBusy(true); setErr("");
    const r = await fetch(`/api/edi/messages/${message.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "reprocess" }) });
    setBusy(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not process it again."); return; }
    onChanged();
  }
  return (
    <Drawer title={`Received · ${message.fileName}`} subtitle={`${message.partyName ?? ""} · control no. ${message.interchangeNo}`} onClose={onClose} size="lg">
      <div className="space-y-3">
        <Results results={Array.isArray(message.result) ? message.result : []} />
        {message.status === "error" && (
          <button onClick={reprocess} disabled={busy} className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-md border border-stone-600 text-[12.5px] text-stone-200 hover:bg-stone-800 disabled:opacity-50">
            {busy && <Loader size={13} className="animate-spin" />} Process it again
          </button>
        )}
        {err && <p className="text-[12px] text-rose-400">{err}</p>}
        <a href={`/api/edi/messages/${message.id}?download=1`} className="inline-flex items-center gap-1.5 text-[12.5px] text-stone-400 hover:text-stone-200"><Download size={13} /> Download the file</a>
      </div>
    </Drawer>
  );
}

function PartnerDrawer({ partner, onClose, onSaved }: { partner: any; onClose: () => void; onSaved: () => void }) {
  const isNew = !partner.id;
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [f, setF] = useState(() => ({
    partyId: partner.partyId ?? "", enabled: partner.enabled ?? true, mode: partner.mode ?? "test", version: partner.version ?? "004010",
    senderQualifier: partner.senderQualifier ?? "ZZ", senderId: partner.senderId ?? "", receiverQualifier: partner.receiverQualifier ?? "ZZ", receiverId: partner.receiverId ?? "",
    senderAppId: partner.senderAppId ?? "", receiverAppId: partner.receiverAppId ?? "",
    requirePartNumber: partner.requirePartNumber ?? true, requireGtin: partner.requireGtin ?? false,
    units: Object.entries(partner.unitOverrides ?? {}).map(([k, v]) => `${k}=${v}`).join("\n"), notes: partner.notes ?? "",
  }));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => { if (isNew) fetch("/api/parties/suppliers?native=1").then(r => r.json()).then(r => setSuppliers(Array.isArray(r) ? r : [])).catch(() => {}); }, [isNew]);
  const set = (patch: Partial<typeof f>) => setF(x => ({ ...x, ...patch }));

  async function save() {
    const unitOverrides: Record<string, string> = {};
    for (const line of f.units.split("\n")) {
      const [k, v] = line.split("=").map(s => s?.trim());
      if (k) unitOverrides[k] = v ?? "";
    }
    const { units: _u, ...rest } = f;
    const body = { ...rest, unitOverrides, senderAppId: f.senderAppId || null, receiverAppId: f.receiverAppId || null, notes: f.notes || null };
    setSaving(true); setErr("");
    const r = await fetch(isNew ? "/api/edi/partners" : `/api/edi/partners/${partner.id}`, { method: isNew ? "POST" : "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setSaving(false);
    if (!r.ok) { setErr((await r.json().catch(() => ({})))?.error || "Could not save."); return; }
    onSaved();
  }

  const qual = (value: string, onChange: (v: string) => void, label: string) => (
    <SelectField inset value={value} onChange={e => onChange(e.target.value)} aria-label={label}>
      {ISA_QUALIFIERS.map(q => <option key={q.code} value={q.code}>{q.label}</option>)}
    </SelectField>
  );

  return (
    <Drawer title={isNew ? "New EDI partner" : `EDI partner · ${partner.partyName ?? ""}`} subtitle="Take every value from the partner's implementation guide." onClose={onClose} size="lg"
      footer={<DrawerFooter saving={saving} onClose={onClose} onSave={save} saveLabel={isNew ? "Add partner" : "Save"} err={err} />}>
      <div className="space-y-4">
        {isNew && (
          <Field label="Supplier">
            <SelectField inset value={f.partyId} onChange={e => set({ partyId: e.target.value })} aria-label="Supplier">
              <option value="">Choose a supplier</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </SelectField>
          </Field>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Mode"><SelectField inset value={f.mode} onChange={e => set({ mode: e.target.value })} aria-label="Mode"><option value="test">Test (ISA15 = T)</option><option value="live">Live (ISA15 = P)</option></SelectField></Field>
          <Field label="X12 version"><SelectField inset value={f.version} onChange={e => set({ version: e.target.value })} aria-label="Version">{X12_VERSIONS.map(v => <option key={v} value={v}>{v}</option>)}</SelectField></Field>
          <Field label="Switched on"><SelectField inset value={f.enabled ? "1" : "0"} onChange={e => set({ enabled: e.target.value === "1" })} aria-label="Switched on"><option value="1">Yes</option><option value="0">No</option></SelectField></Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Our ID qualifier">{qual(f.senderQualifier, v => set({ senderQualifier: v }), "Our ID qualifier")}</Field>
          <Field label="Our interchange ID" hint="ISA06, up to 15 characters."><input value={f.senderId} onChange={e => set({ senderId: e.target.value })} maxLength={15} className={`${controlInset} font-mono`} /></Field>
          <Field label="Their ID qualifier">{qual(f.receiverQualifier, v => set({ receiverQualifier: v }), "Their ID qualifier")}</Field>
          <Field label="Their interchange ID" hint="ISA08."><input value={f.receiverId} onChange={e => set({ receiverId: e.target.value })} maxLength={15} className={`${controlInset} font-mono`} /></Field>
          <Field label="Our application ID (GS02)" hint="Blank = our interchange ID."><input value={f.senderAppId} onChange={e => set({ senderAppId: e.target.value })} maxLength={15} className={`${controlInset} font-mono`} /></Field>
          <Field label="Their application ID (GS03)" hint="Blank = their interchange ID."><input value={f.receiverAppId} onChange={e => set({ receiverAppId: e.target.value })} maxLength={15} className={`${controlInset} font-mono`} /></Field>
        </div>
        <div className="space-y-2 text-[12.5px] text-stone-300">
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.requirePartNumber} onChange={e => set({ requirePartNumber: e.target.checked })} /> Every line must carry their part number</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={f.requireGtin} onChange={e => set({ requireGtin: e.target.checked })} /> Every line must carry a GTIN</label>
        </div>
        <Field label="Unit codes for this partner" hint="One per line: our unit = their 2-character X12 code (e.g. case=CS). Only where theirs differs from the standard.">
          <textarea value={f.units} onChange={e => set({ units: e.target.value })} rows={3} className={`${controlInset} font-mono h-auto py-2`} placeholder="case=CS" />
        </Field>
        <Field label="Notes"><textarea value={f.notes} onChange={e => set({ notes: e.target.value })} rows={2} className={`${controlInset} h-auto py-2`} placeholder="Contact, portal address, guide version…" /></Field>
      </div>
    </Drawer>
  );
}
