"use client";

/**
 * Rep portal — My Escalations page. Session-authenticated sibling of the
 * token-based owner portal: same Customer → Project grouped list view, but
 * for logged-in users. Comments post through the standard communications API
 * so they land in the invoice chatbox like any internal note.
 */

import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { ChevronLeft, RefreshCw } from "lucide-react";

type Activity = {
  channel: string; direction?: string; sender: string | null; recipients?: string | null;
  body: string | null; subject: string | null; sentAt: string;
};
type Inv = {
  id: string; invoiceNumber: string; customerId: string; projectId: string | null;
  customer: string; project: string | null;
  currency: string; total: number; outstanding: number; dueDate: string;
  daysOverdue: number; status: string | null; activity: Activity[];
};

const money = (n: number, ccy: string) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy || "EUR" }).format(n);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" });

const fmtDateTime = (d: string) => {
  const t = new Date(d);
  return `${t.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" })} ${t.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
};

function activityCfg(a: Activity, meName: string) {
  switch (a.channel) {
    case "Email":
      return a.direction === "Inbound"
        ? { icon: "↩", border: "border-emerald-500", label: `Reply from ${a.sender || "customer"}`, labelCls: "text-emerald-400", bg: "bg-emerald-950/25" }
        : { icon: "✉", border: "border-blue-500", label: `Email sent to ${a.recipients || "customer"}`, labelCls: "text-blue-400", bg: "bg-blue-950/20" };
    case "Chase":
      return { icon: "↗", border: "border-amber-500", label: `${a.sender || "Staff"} · chased outside app`, labelCls: "text-amber-400", bg: "bg-amber-950/20" };
    case "StageChange":
      return { icon: "⚑", border: "border-indigo-500", label: `${a.sender || "Staff"} · stage updated`, labelCls: "text-indigo-400", bg: "bg-indigo-950/15" };
    case "Portal":
      return { icon: "◍", border: "border-emerald-500", label: `${a.sender || "Customer"} · via portal`, labelCls: "text-emerald-400", bg: "bg-emerald-950/25" };
    case "Dispute":
      return { icon: "⚠", border: "border-rose-500", label: a.sender || "Staff", labelCls: "text-rose-400", bg: "bg-rose-950/20" };
    case "Promise":
      return { icon: "◷", border: "border-sky-500", label: a.sender || "Staff", labelCls: "text-sky-400", bg: "bg-sky-950/20" };
    default:
      return a.sender === meName
        ? { icon: "●", border: "border-emerald-500", label: "You", labelCls: "text-emerald-400", bg: "bg-emerald-950/25" }
        : { icon: "✎", border: "border-stone-600", label: `${a.sender || "Staff"} · internal note`, labelCls: "text-stone-400", bg: "bg-stone-900/40" };
  }
}

export default function EscalationsPage() {
  const { data: session } = useSession();
  const meName = session?.user?.name || "Me";

  const [invoices, setInvoices] = useState<Inv[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedProj, setCollapsedProj] = useState<Set<string>>(new Set());
  const [zipBusy, setZipBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    fetch("/api/me/escalations")
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed to load");
        setInvoices(d.invoices ?? []);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  async function submit(inv: Inv) {
    const text = (drafts[inv.id] ?? "").trim();
    if (!text) return;
    setSaving(inv.id);
    try {
      const res = await fetch("/api/communications", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerId: inv.customerId, invoiceId: inv.id, projectId: inv.projectId ?? null,
          direction: "Outbound", channel: "Note",
          subject: "Escalation update", body: text,
          sender: meName, matchedBy: "Manual",
        }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Failed"); }
      setDrafts(p => ({ ...p, [inv.id]: "" }));
      setSaved(p => ({ ...p, [inv.id]: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) }));
      setInvoices(p => p ? p.map(i => i.id === inv.id
        ? { ...i, activity: [{ channel: "Note", sender: meName, body: text, subject: "Escalation update", sentAt: new Date().toISOString() }, ...i.activity] }
        : i) : p);
    } catch (e: any) {
      alert(e.message || "Failed to save comment");
    } finally { setSaving(null); }
  }

  async function downloadZip(name: string, ids: string[]) {
    setZipBusy(name);
    try {
      const res = await fetch("/api/invoices/download-pdfs", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceIds: ids }),
      });
      if (!res.ok) { alert("Failed to download PDFs"); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `${name.replace(/[^\w\- ]+/g, "")}-invoices.zip`; a.click();
      URL.revokeObjectURL(url);
    } finally { setZipBusy(null); }
  }

  if (error) return (
    <div className="min-h-screen bg-stone-950 flex items-center justify-center p-6">
      <div className="bg-stone-900 rounded-2xl border border-stone-800 p-10 text-center max-w-md">
        <h1 className="text-lg font-semibold text-white mb-1">Couldn't load escalations</h1>
        <p className="text-sm text-stone-400">{error}</p>
      </div>
    </div>
  );

  if (loading || invoices === null) return (
    <div className="min-h-screen bg-stone-950 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-stone-700 border-t-emerald-500 rounded-full animate-spin" />
    </div>
  );

  const totals: Record<string, number> = {};
  invoices.forEach(i => { totals[i.currency] = (totals[i.currency] ?? 0) + i.outstanding; });

  type PG = { name: string; total: number; ccy: string; invoices: Inv[] };
  const cm = new Map<string, { name: string; total: number; ccy: string; count: number; projects: Map<string, PG> }>();
  invoices.forEach(inv => {
    if (!cm.has(inv.customer)) cm.set(inv.customer, { name: inv.customer, total: 0, ccy: inv.currency, count: 0, projects: new Map() });
    const c = cm.get(inv.customer)!;
    c.total += inv.outstanding; c.count++;
    const pKey = inv.project ?? "";
    if (!c.projects.has(pKey)) c.projects.set(pKey, { name: inv.project ?? "No project", total: 0, ccy: inv.currency, invoices: [] });
    const p = c.projects.get(pKey)!;
    p.total += inv.outstanding;
    p.invoices.push(inv);
  });
  const groups = [...cm.values()]
    .map(c => ({ ...c, projects: [...c.projects.values()].sort((a, b) => b.total - a.total).map(p => ({ ...p, invoices: [...p.invoices].sort((a, b) => b.outstanding - a.outstanding) })) }))
    .sort((a, b) => b.total - a.total);

  const thCls = "px-3 py-2.5 text-[11px] font-semibold text-stone-400 uppercase tracking-wider whitespace-nowrap text-left";

  return (
    <div className="min-h-screen bg-stone-950 text-stone-200">
      <div className="border-b border-stone-800 bg-stone-950 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-end justify-between flex-wrap gap-3">
          <div>
            <Link href="/rep-portal" className="inline-flex items-center gap-1 text-[12px] text-stone-500 hover:text-stone-300 mb-1">
              <ChevronLeft size={13} /> Back to portal
            </Link>
            <h1 className="text-lg font-bold text-white">My Escalations</h1>
            <p className="text-[13px] text-stone-400 mt-0.5">
              {invoices.length} invoice{invoices.length !== 1 ? "s" : ""} escalated to you ·{" "}
              <span className="font-semibold text-stone-200">{Object.entries(totals).map(([c, v]) => money(v, c)).join(" · ") || "—"}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={load} className="p-2 rounded-lg hover:bg-stone-800 text-stone-500" title="Refresh">
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            {groups.length > 0 && (
              <button
                onClick={() => setCollapsed(p => p.size > 0 ? new Set() : new Set(groups.map(g => g.name)))}
                className="text-[12px] font-medium text-stone-400 hover:text-white border border-stone-700 rounded-lg px-3 py-1.5 hover:bg-stone-800 transition-colors whitespace-nowrap">
                {collapsed.size > 0 ? "Expand all" : "Collapse all"}
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-5">
        {invoices.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-4xl mb-3">🎉</div>
            <p className="text-stone-400 font-medium">Nothing escalated to you right now.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-stone-800">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="bg-stone-900">
                <tr className="border-b border-stone-800">
                  <th className={thCls}>Invoice</th>
                  <th className={thCls}>Due</th>
                  <th className={`${thCls} text-right`}>Overdue</th>
                  <th className={thCls}>Status</th>
                  <th className={thCls}>Latest update</th>
                  <th className={`${thCls} text-right`}>Outstanding</th>
                  <th className={`${thCls} text-center`}>PDF</th>
                  <th className={`${thCls} text-center`}>Update</th>
                </tr>
              </thead>
              <tbody className="bg-stone-950">
                {groups.map(cg => (
                  <Frag key={cg.name}>
                    <tr className="bg-stone-800/90 cursor-pointer hover:bg-stone-800 select-none"
                      onClick={() => setCollapsed(p => { const n = new Set(p); n.has(cg.name) ? n.delete(cg.name) : n.add(cg.name); return n; })}>
                      <td colSpan={5} className="px-3 py-2.5 font-semibold text-white">
                        <span className="inline-block w-4 text-stone-400">{collapsed.has(cg.name) ? "▸" : "▾"}</span>
                        {cg.name}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-white tabular-nums whitespace-nowrap">{money(cg.total, cg.ccy)}</td>
                      <td colSpan={2} className="px-3 py-2.5 text-[11px] text-stone-400 text-center">{cg.count} inv</td>
                    </tr>
                    {!collapsed.has(cg.name) && cg.projects.map(pg => {
                      const projKey = `${cg.name}|${pg.name}`;
                      const hasProjRow = pg.name !== "No project" || cg.projects.length > 1;
                      const projFolded = hasProjRow && collapsedProj.has(projKey);
                      return (
                        <Frag key={pg.name}>
                          {hasProjRow && (
                            <tr className="bg-stone-900/70 cursor-pointer hover:bg-stone-900 select-none"
                              onClick={() => setCollapsedProj(p => { const n = new Set(p); n.has(projKey) ? n.delete(projKey) : n.add(projKey); return n; })}>
                              <td colSpan={5} className="pl-6 pr-3 py-1.5 text-[12px] font-medium text-stone-400">
                                <span className="inline-block w-4 text-stone-500">{projFolded ? "▸" : "▾"}</span>
                                {pg.name}
                                <span className="text-stone-600 ml-1.5">· {pg.invoices.length} inv</span>
                              </td>
                              <td className="px-3 py-1.5 text-right text-[12px] font-semibold text-stone-300 tabular-nums whitespace-nowrap">{money(pg.total, pg.ccy)}</td>
                              <td className="px-3 py-1.5 text-center" onClick={e => e.stopPropagation()}>
                                <button onClick={() => downloadZip(pg.name, pg.invoices.map(i => i.id))}
                                  disabled={zipBusy === pg.name}
                                  className="text-emerald-400 hover:text-emerald-300 text-[11px] font-medium whitespace-nowrap disabled:opacity-50">
                                  {zipBusy === pg.name ? "…" : "↓ ZIP"}
                                </button>
                              </td>
                              <td />
                            </tr>
                          )}
                          {!projFolded && pg.invoices.map(inv => {
                            const latest = inv.activity[0];
                            const expanded = openId === inv.id;
                            return (
                              <Frag key={inv.id}>
                                <tr className={`border-b border-stone-800/70 hover:bg-stone-900/60 cursor-pointer ${expanded ? "bg-stone-900/60" : ""}`}
                                  onClick={() => setOpenId(expanded ? null : inv.id)}>
                                  <td className="pl-6 pr-3 py-2 font-mono text-[12px] text-stone-300 whitespace-nowrap">#{inv.invoiceNumber}</td>
                                  <td className="px-3 py-2 text-[12px] text-stone-400 whitespace-nowrap">{fmtDate(inv.dueDate)}</td>
                                  <td className={`px-3 py-2 text-right text-[12px] font-medium tabular-nums ${inv.daysOverdue > 60 ? "text-rose-400" : inv.daysOverdue > 0 ? "text-amber-400" : "text-stone-500"}`}>
                                    {inv.daysOverdue > 0 ? `+${inv.daysOverdue}d` : "—"}
                                  </td>
                                  <td className="px-3 py-2 text-[12px]">
                                    {inv.status
                                      ? <span className="inline-block bg-sky-500/10 text-sky-300 border border-sky-900 rounded-full px-2 py-0.5 text-[11px]">{inv.status}</span>
                                      : <span className="text-stone-600">No response</span>}
                                  </td>
                                  <td className="px-3 py-2 text-[12px] text-stone-500 max-w-[240px] truncate">
                                    {latest
                                      ? latest.channel === "StageChange" ? `Stage: ${latest.subject}`
                                      : latest.channel === "Email" && latest.direction === "Outbound" ? `✉ ${latest.subject ?? "Email sent"}`
                                      : `${latest.sender ? latest.sender + ": " : ""}${latest.body ?? latest.subject ?? ""}`
                                      : "—"}
                                  </td>
                                  <td className="px-3 py-2 text-right font-semibold text-white tabular-nums whitespace-nowrap">{money(inv.outstanding, inv.currency)}</td>
                                  <td className="px-3 py-2 text-center" onClick={e => e.stopPropagation()}>
                                    <a href={`/api/invoices/${inv.id}/pdf`} target="_blank" rel="noopener noreferrer"
                                      className="text-emerald-400 hover:text-emerald-300 text-[12px] font-medium">↓ PDF</a>
                                  </td>
                                  <td className="px-3 py-2 text-center">
                                    <span className={`text-[12px] font-medium ${expanded ? "text-emerald-400" : saved[inv.id] ? "text-emerald-500" : "text-stone-500 hover:text-stone-300"}`}>
                                      {saved[inv.id] ? "✓ Sent" : expanded ? "Close" : "Comment"}
                                    </span>
                                  </td>
                                </tr>
                                {expanded && (
                                  <tr className="bg-stone-900/40 border-b border-stone-800">
                                    <td colSpan={8} className="px-6 py-3">
                                      {inv.activity.length > 0 && (
                                        <div className="mb-3 space-y-1.5 max-h-72 overflow-y-auto pr-1">
                                          <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
                                            Full history · {inv.activity.length} event{inv.activity.length !== 1 ? "s" : ""}
                                          </div>
                                          {inv.activity.map((a, i) => {
                                            const cfg = activityCfg(a, meName);
                                            return (
                                              <div key={i} className={`rounded-lg px-3 py-2 border-l-2 ${cfg.border} ${cfg.bg}`}>
                                                <div className="flex items-center justify-between gap-2">
                                                  <div className={`flex items-center gap-1.5 text-[10px] font-semibold ${cfg.labelCls}`}>
                                                    <span>{cfg.icon}</span>
                                                    <span>{cfg.label}</span>
                                                  </div>
                                                  <span className="text-[10px] text-stone-600 tabular-nums shrink-0">{fmtDateTime(a.sentAt)}</span>
                                                </div>
                                                {a.channel === "StageChange" ? (
                                                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                                                    {(a.subject ?? "").split(" → ").map((s, j, arr) => (
                                                      <span key={j} className="flex items-center gap-1.5">
                                                        <span className={`text-[10px] font-medium rounded-full px-2 py-0.5 border ${j === arr.length - 1 ? "bg-indigo-500/15 text-indigo-300 border-indigo-800" : "bg-stone-800 text-stone-400 border-stone-700"}`}>{s}</span>
                                                        {j < arr.length - 1 && <span className="text-[10px] text-stone-600 font-bold">→</span>}
                                                      </span>
                                                    ))}
                                                    {a.body && <span className="text-[11px] text-rose-300">· assigned to {a.body.split(" · ")[0]}</span>}
                                                  </div>
                                                ) : a.channel === "Email" && a.direction === "Outbound" ? (
                                                  a.subject && <div className="text-[12px] text-stone-400 mt-0.5 italic truncate">"{a.subject}"</div>
                                                ) : (
                                                  <>
                                                    {a.subject && a.channel === "Email" && <div className="text-[11px] font-medium text-stone-300 mt-0.5">{a.subject}</div>}
                                                    {a.body && <div className="text-[12px] text-stone-300 mt-0.5 whitespace-pre-wrap leading-relaxed">{a.body}</div>}
                                                  </>
                                                )}
                                              </div>
                                            );
                                          })}
                                        </div>
                                      )}
                                      <div className="flex gap-2">
                                        <input
                                          value={drafts[inv.id] ?? ""}
                                          autoFocus
                                          onChange={e => setDrafts(p => ({ ...p, [inv.id]: e.target.value }))}
                                          onKeyDown={e => { if (e.key === "Enter") submit(inv); }}
                                          placeholder="Your update — e.g. 'Spoke to their PM, payment approved for Friday'"
                                          className="flex-1 text-[13px] border border-stone-700 rounded-lg px-3 py-2 bg-stone-950 text-stone-200 placeholder-stone-600 outline-none focus:ring-1 focus:ring-emerald-500"
                                        />
                                        <button
                                          onClick={() => submit(inv)}
                                          disabled={saving === inv.id || !(drafts[inv.id] ?? "").trim()}
                                          className="text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 disabled:opacity-40 hover:bg-emerald-700 transition-colors">
                                          {saving === inv.id ? "Saving…" : "Send"}
                                        </button>
                                      </div>
                                      {saved[inv.id] && (
                                        <div className="text-[11px] text-emerald-400 font-medium mt-1.5">✓ Update sent at {saved[inv.id]} — the accounts team can see it now</div>
                                      )}
                                    </td>
                                  </tr>
                                )}
                              </Frag>
                            );
                          })}
                        </Frag>
                      );
                    })}
                  </Frag>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Frag({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
