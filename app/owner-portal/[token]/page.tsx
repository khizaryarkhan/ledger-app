"use client";

/**
 * Owner escalation portal — no-login page for internal owners of escalated
 * invoices. Lists their assigned invoices (customer + project prominent) with
 * recent activity and a comment box per line. Comments land directly in the
 * invoice's activity feed in the collections system.
 */

import { useState, useEffect } from "react";

type Activity = { channel: string; sender: string | null; body: string | null; subject: string | null; sentAt: string };
type Inv = {
  id: string; invoiceNumber: string; customer: string; project: string | null;
  currency: string; total: number; outstanding: number; dueDate: string;
  daysOverdue: number; status: string | null; activity: Activity[];
};
type Data = { owner: string; org: { name: string; logoUrl: string | null } | null; invoices: Inv[] };

const money = (n: number, ccy: string) =>
  new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy || "EUR" }).format(n);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export default function OwnerPortalPage({ params }: { params: { token: string } }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  const [saved, setSaved] = useState<Record<string, string>>({}); // invoiceId → timestamp of last save
  const [openActivity, setOpenActivity] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetch(`/api/owner-portal/${params.token}`)
      .then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || "Failed to load");
        setData(d);
      })
      .catch(e => setError(e.message));
  }, [params.token]);

  async function submit(invId: string) {
    const text = (drafts[invId] ?? "").trim();
    if (!text) return;
    setSaving(invId);
    try {
      const res = await fetch(`/api/owner-portal/${params.token}`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invoiceId: invId, body: text }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.error || "Failed"); }
      setDrafts(p => ({ ...p, [invId]: "" }));
      setSaved(p => ({ ...p, [invId]: new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) }));
      // Optimistically append to the visible activity
      setData(p => p ? {
        ...p,
        invoices: p.invoices.map(i => i.id === invId
          ? { ...i, activity: [{ channel: "Portal", sender: p.owner, body: text, subject: "Owner update", sentAt: new Date().toISOString() }, ...i.activity] }
          : i),
      } : p);
    } catch (e: any) {
      alert(e.message || "Failed to save comment");
    } finally { setSaving(null); }
  }

  if (error) return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-10 text-center max-w-md">
        <div className="text-4xl mb-3">⏳</div>
        <h1 className="text-lg font-semibold text-stone-800 mb-1">Link unavailable</h1>
        <p className="text-sm text-stone-500">{error}. Please ask the accounts team to send you a fresh link.</p>
      </div>
    </div>
  );

  if (!data) return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-stone-300 border-t-emerald-600 rounded-full animate-spin" />
    </div>
  );

  const totals: Record<string, number> = {};
  data.invoices.forEach(i => { totals[i.currency] = (totals[i.currency] ?? 0) + i.outstanding; });

  return (
    <div className="min-h-screen bg-stone-100 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 mb-4">
          <div className="flex items-center gap-3 mb-1">
            {data.org?.logoUrl && <img src={data.org.logoUrl} alt="" className="h-8 w-auto" />}
            <span className="text-[13px] font-medium text-stone-400">{data.org?.name}</span>
          </div>
          <h1 className="text-xl font-bold text-stone-900">Escalated invoices — {data.owner}</h1>
          <p className="text-sm text-stone-500 mt-1">
            {data.invoices.length} invoice{data.invoices.length !== 1 ? "s" : ""} assigned to you ·{" "}
            <span className="font-semibold text-stone-700">
              {Object.entries(totals).map(([c, v]) => money(v, c)).join(" · ")}
            </span>{" "}
            outstanding
          </p>
          <p className="text-[13px] text-stone-500 mt-3 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            Please add an update on <strong>each invoice</strong> below — your comments go straight to the accounts team, no email needed.
          </p>
        </div>

        {data.invoices.length === 0 && (
          <div className="bg-white rounded-2xl shadow-sm border border-stone-200 p-10 text-center">
            <div className="text-4xl mb-3">🎉</div>
            <p className="text-stone-600 font-medium">Nothing outstanding — all your escalated invoices are resolved.</p>
          </div>
        )}

        {/* Grouped: Customer → Project → invoices, all sorted largest-first */}
        <div className="space-y-5">
          {(() => {
            type PG = { name: string; total: number; ccy: string; invoices: Inv[] };
            type CG = { name: string; total: number; ccy: string; count: number; projects: PG[] };
            const cm = new Map<string, { name: string; total: number; ccy: string; count: number; projects: Map<string, PG> }>();
            data.invoices.forEach(inv => {
              if (!cm.has(inv.customer)) cm.set(inv.customer, { name: inv.customer, total: 0, ccy: inv.currency, count: 0, projects: new Map() });
              const c = cm.get(inv.customer)!;
              c.total += inv.outstanding; c.count++;
              const pKey = inv.project ?? "";
              if (!c.projects.has(pKey)) c.projects.set(pKey, { name: inv.project ?? "No project", total: 0, ccy: inv.currency, invoices: [] });
              const p = c.projects.get(pKey)!;
              p.total += inv.outstanding;
              p.invoices.push(inv);
            });
            const groups: CG[] = [...cm.values()]
              .map(c => ({ ...c, projects: [...c.projects.values()].sort((a, b) => b.total - a.total).map(p => ({ ...p, invoices: [...p.invoices].sort((a, b) => b.outstanding - a.outstanding) })) }))
              .sort((a, b) => b.total - a.total);
            return groups.map(cg => (
              <div key={cg.name} className="space-y-2">
                {/* Customer header */}
                <div className="flex items-center justify-between bg-stone-800 text-white rounded-xl px-4 py-3">
                  <div className="font-semibold">{cg.name}</div>
                  <div className="text-right">
                    <div className="font-bold tabular-nums">{money(cg.total, cg.ccy)}</div>
                    <div className="text-[11px] text-stone-400">{cg.count} invoice{cg.count !== 1 ? "s" : ""}</div>
                  </div>
                </div>
                {cg.projects.map(pg => (
                  <div key={pg.name} className="space-y-2">
                    {(pg.name !== "No project" || cg.projects.length > 1) && (
                      <div className="flex items-center justify-between px-4 py-1.5 bg-stone-200/70 rounded-lg ml-3">
                        <span className="text-[13px] font-medium text-stone-600">{pg.name}</span>
                        <span className="text-[13px] font-semibold text-stone-700 tabular-nums">{money(pg.total, pg.ccy)}</span>
                      </div>
                    )}
                    {pg.invoices.map(inv => (
            <div key={inv.id} className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden ml-3">
              <div className="p-5">
                <div className="flex items-start justify-between gap-4 flex-wrap">
                  <div>
                    <div className="font-mono text-[13px] font-semibold text-stone-700">#{inv.invoiceNumber}</div>
                    <div className="text-[12px] text-stone-400 mt-0.5">{inv.customer}{inv.project ? ` · ${inv.project}` : ""}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold text-stone-900 tabular-nums">{money(inv.outstanding, inv.currency)}</div>
                    <div className="text-[12px] text-stone-500">
                      Due {fmtDate(inv.dueDate)}
                      {inv.daysOverdue > 0 && <span className={`ml-1 font-semibold ${inv.daysOverdue > 60 ? "text-rose-600" : "text-amber-600"}`}>· {inv.daysOverdue}d overdue</span>}
                    </div>
                    <a
                      href={`/api/owner-portal/${params.token}/pdf/${inv.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 mt-1.5 text-[12px] font-medium text-emerald-700 hover:text-emerald-800 border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 rounded-md px-2 py-1 transition-colors"
                    >
                      ↓ Invoice PDF
                    </a>
                  </div>
                </div>
                {inv.status && (
                  <div className="mt-2 inline-block text-[12px] font-medium bg-sky-50 text-sky-700 border border-sky-200 rounded-full px-2.5 py-0.5">{inv.status}</div>
                )}

                {/* Recent activity (collapsible) */}
                {inv.activity.length > 0 && (
                  <div className="mt-3">
                    <button onClick={() => setOpenActivity(p => ({ ...p, [inv.id]: !p[inv.id] }))}
                      className="text-[12px] font-medium text-stone-500 hover:text-stone-700">
                      {openActivity[inv.id] ? "▾" : "▸"} Recent activity ({inv.activity.length})
                    </button>
                    {openActivity[inv.id] && (
                      <div className="mt-2 space-y-1.5 border-l-2 border-stone-200 pl-3">
                        {inv.activity.map((a, i) => (
                          <div key={i} className="text-[12px]">
                            <span className="font-medium text-stone-600">{a.sender ?? "System"}</span>
                            <span className="text-stone-400"> · {fmtDate(a.sentAt)}</span>
                            <div className="text-stone-500">{a.channel === "StageChange" ? `Stage: ${a.subject}` : (a.body ?? a.subject ?? "")}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Comment box */}
              <div className="bg-stone-50 border-t border-stone-200 p-4">
                <div className="flex gap-2">
                  <input
                    value={drafts[inv.id] ?? ""}
                    onChange={e => setDrafts(p => ({ ...p, [inv.id]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") submit(inv.id); }}
                    placeholder="Your update — e.g. 'Spoke to their PM, payment approved for Friday'"
                    className="flex-1 text-sm border border-stone-300 rounded-lg px-3 py-2 bg-white outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                  />
                  <button
                    onClick={() => submit(inv.id)}
                    disabled={saving === inv.id || !(drafts[inv.id] ?? "").trim()}
                    className="text-sm font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 disabled:opacity-40 hover:bg-emerald-700 transition-colors">
                    {saving === inv.id ? "Saving…" : "Send"}
                  </button>
                </div>
                {saved[inv.id] && (
                  <div className="text-[11px] text-emerald-600 font-medium mt-1.5">✓ Update sent at {saved[inv.id]} — accounts team can see it now</div>
                )}
              </div>
            </div>
                    ))}
                  </div>
                ))}
              </div>
            ));
          })()}
        </div>

        <p className="text-center text-[11px] text-stone-400 mt-6">
          This is a private link for {data.owner}. Comments are logged in {data.org?.name ?? "the accounts"} collections system.
        </p>
      </div>
    </div>
  );
}
