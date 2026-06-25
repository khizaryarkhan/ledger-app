"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ChevronLeft, Loader, Building2, Mail, StickyNote, CheckSquare, Send, Trophy,
  FileText, CheckCircle2, User, ArrowRight, ExternalLink, CreditCard, Phone, Clock,
} from "lucide-react";
import { fmt } from "@/lib/format";

const STAGE: Record<string, { label: string; cls: string }> = {
  lead: { label: "Lead", cls: "bg-sky-500/15 text-sky-300" },
  prospect: { label: "Prospect", cls: "bg-blue-500/15 text-blue-300" },
  qualified: { label: "Qualified", cls: "bg-violet-500/15 text-violet-300" },
  customer: { label: "Customer", cls: "bg-emerald-500/15 text-emerald-300" },
  churned: { label: "Churned", cls: "bg-rose-500/15 text-rose-300" },
  archived: { label: "Archived", cls: "bg-stone-700 text-stone-400" },
};

// Activity type → icon + accent.
const ACT: Record<string, { icon: any; cls: string }> = {
  email_sent: { icon: Mail, cls: "text-sky-400" },
  email_received: { icon: Mail, cls: "text-emerald-400" },
  call_logged: { icon: Phone, cls: "text-violet-400" },
  note_added: { icon: StickyNote, cls: "text-amber-400" },
  task_created: { icon: CheckSquare, cls: "text-stone-400" },
  task_completed: { icon: CheckSquare, cls: "text-emerald-400" },
  status_changed: { icon: ArrowRight, cls: "text-stone-400" },
  sequence_enrolled: { icon: Send, cls: "text-blue-400" },
  sequence_sent: { icon: Send, cls: "text-sky-400" },
  sequence_stopped: { icon: Send, cls: "text-rose-400" },
  deal_created: { icon: Trophy, cls: "text-violet-400" },
  deal_moved: { icon: Trophy, cls: "text-stone-400" },
  deal_won: { icon: Trophy, cls: "text-emerald-400" },
  deal_lost: { icon: Trophy, cls: "text-rose-400" },
  invoice_issued: { icon: FileText, cls: "text-sky-400" },
  payment_received: { icon: CheckCircle2, cls: "text-emerald-400" },
  customer_activated: { icon: CheckCircle2, cls: "text-emerald-400" },
  owner_assigned: { icon: User, cls: "text-stone-400" },
  account_created: { icon: Building2, cls: "text-stone-400" },
};

const when = (t: string | number | null) => {
  if (!t) return "";
  const d = new Date(t);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "2-digit" }) + " · " +
    d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
};

function Panel({ title, count, action, children }: { title: string; count?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-stone-800 bg-stone-900/40">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-stone-800">
        <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">{title}{count != null && <span className="ml-1.5 text-stone-600">{count}</span>}</span>
        {action}
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

export default function Account360Page() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    fetch(`/api/admin/accounts/${id}`).then(r => r.ok ? r.json() : null).then(d => setData(d)).finally(() => setLoading(false));
  }, [id]);
  useEffect(() => { if (id) load(); }, [id, load]);

  const assignOwner = async (ownerAdminId: string) => {
    setData((d: any) => ({ ...d, account: { ...d.account, ownerAdminId } }));
    await fetch(`/api/admin/accounts/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ownerAdminId: ownerAdminId || null }) }).catch(() => {});
  };

  if (loading) return <div className="max-w-[1300px] mx-auto"><div className="h-64 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" /></div>;
  if (!data?.account) return <div className="max-w-[1300px] mx-auto py-16 text-center text-stone-500">Account not found.</div>;

  const a = data.account;
  const s = STAGE[a.lifecycleStage] ?? { label: a.lifecycleStage, cls: "bg-stone-700 text-stone-400" };
  const sub = data.subscription;
  const money = (v: number, c?: string) => fmt.money(v ?? 0, (c ?? "USD").toUpperCase());

  return (
    <div className="max-w-[1300px] mx-auto">
      <Link href="/admin/accounts" className="inline-flex items-center gap-1 text-xs text-stone-500 hover:text-stone-300 mb-3"><ChevronLeft size={14} /> Accounts</Link>

      {/* Header */}
      <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-5 mb-4">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-stone-800 flex items-center justify-center text-stone-300 font-bold">{(a.name || "?").slice(0, 2).toUpperCase()}</div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-white">{a.name}</h1>
                <span className={`text-[11px] px-2 py-0.5 rounded ${s.cls}`}>{s.label}</span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-[12px] text-stone-500">
                <span className="font-mono">{a.ref}</span>
                {a.billingEmail && <span>{a.billingEmail}</span>}
                {a.country && <span>{a.country}</span>}
                {a.orgStatus && <span className={a.orgStatus === "Active" ? "text-emerald-400" : "text-amber-400"}>{a.orgStatus}</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <User size={13} className="text-stone-500" />
              <select value={a.ownerAdminId ?? ""} onChange={e => assignOwner(e.target.value)}
                className="h-8 px-2 text-xs rounded-lg bg-stone-900 border border-stone-700 text-stone-300">
                <option value="">Unassigned</option>
                {data.admins?.map((ad: any) => <option key={ad.id} value={ad.id}>{ad.name || ad.email}</option>)}
              </select>
            </div>
            {a.organisationId && <Link href={`/admin/customers/${a.organisationId}`} className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><CreditCard size={13} /> Billing</Link>}
            {a.leadId && <Link href={`/admin/leads/${a.leadId}`} className="flex items-center gap-1.5 h-8 px-3 text-xs rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800"><Mail size={13} /> Lead cockpit</Link>}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Left: relations */}
        <div className="space-y-4">
          <Panel title="Contacts" count={data.contacts?.length ?? 0}>
            {data.contacts?.length ? data.contacts.map((c: any) => (
              <div key={c.id} className="flex items-center gap-2 py-1.5">
                <div className="w-7 h-7 rounded-full bg-stone-800 flex items-center justify-center text-[10px] text-stone-300">{(c.name || "?").slice(0, 2).toUpperCase()}</div>
                <div className="min-w-0">
                  <div className="text-sm text-stone-200 truncate">{c.name}{c.isPrimary && <span className="ml-1.5 text-[9px] uppercase text-emerald-400">primary</span>}</div>
                  <div className="text-[11px] text-stone-500 truncate">{c.title ? `${c.title} · ` : ""}{c.email}</div>
                </div>
              </div>
            )) : <p className="text-xs text-stone-600 py-2">No contacts.</p>}
          </Panel>

          <Panel title="Opportunities" count={data.opportunities?.length ?? 0}>
            {data.opportunities?.length ? data.opportunities.map((o: any) => (
              <Link key={o.id} href="/admin/opportunities" className="flex items-center justify-between py-1.5 hover:bg-stone-800/30 rounded px-1 -mx-1">
                <div className="min-w-0">
                  <div className="text-sm text-stone-200 truncate">{o.title}</div>
                  <div className="text-[11px] text-stone-500 capitalize">{o.stage}{o.invoiceStatus ? ` · invoice ${o.invoiceStatus}` : ""}</div>
                </div>
                <span className="text-xs text-stone-300 tabular-nums shrink-0">{o.value ? money(o.value, o.currency) : "—"}</span>
              </Link>
            )) : <p className="text-xs text-stone-600 py-2">No deals.</p>}
          </Panel>

          <Panel title="Tasks" count={data.tasks?.length ?? 0}>
            {data.tasks?.length ? data.tasks.map((t: any) => (
              <div key={t.id} className="flex items-center gap-2 py-1.5">
                <CheckSquare size={13} className={t.completedAt ? "text-emerald-400" : "text-stone-600"} />
                <span className={`text-sm flex-1 truncate ${t.completedAt ? "text-stone-500 line-through" : "text-stone-200"}`}>{t.title}</span>
                {t.dueDate && <span className="text-[11px] text-stone-500 shrink-0">{when(t.dueDate).split(" · ")[0]}</span>}
              </div>
            )) : <p className="text-xs text-stone-600 py-2">No tasks.</p>}
          </Panel>

          <Panel title="Emails" count={data.emailThreads?.length ?? 0}>
            {data.emailThreads?.length ? data.emailThreads.slice(0, 8).map((t: any) => (
              <div key={t.threadKey} className="py-1.5 border-b border-stone-800/40 last:border-0">
                <div className="flex items-center gap-1.5">
                  <Mail size={11} className="text-stone-500 shrink-0" />
                  <span className="text-[13px] text-stone-200 truncate flex-1">{t.subject || "(no subject)"}</span>
                  {t.count > 1 && <span className="text-[10px] text-stone-600">{t.count}</span>}
                </div>
                {t.messages?.[0] && (
                  <p className="text-[11px] text-stone-500 truncate mt-0.5 pl-[18px]">
                    <span className={t.messages[0].direction === "inbound" ? "text-emerald-400" : "text-sky-400"}>{t.messages[0].direction === "inbound" ? "↓" : "↑"}</span> {t.messages[0].snippet || t.messages[0].fromAddr}
                  </p>
                )}
              </div>
            )) : <p className="text-xs text-stone-600 py-2">No emails yet.</p>}
          </Panel>

          {sub && (
            <Panel title="Billing">
              <div className="space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-stone-500 text-xs">Plan</span><span className="text-stone-200">{sub.planName ?? "—"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500 text-xs">Price</span><span className="text-stone-200">{sub.planAmount ? `${money(sub.planAmount / 100, sub.planCurrency)}${sub.planInterval ? `/${sub.planInterval}` : ""}` : "—"}</span></div>
                <div className="flex justify-between"><span className="text-stone-500 text-xs">Status</span><span className="text-stone-200 capitalize">{sub.status}</span></div>
                <div className="flex justify-between"><span className="text-stone-500 text-xs">Source</span><span className="text-stone-200 capitalize">{sub.source}</span></div>
              </div>
            </Panel>
          )}
        </div>

        {/* Right: activity timeline (spans 2 cols) */}
        <div className="lg:col-span-2">
          <Panel title="Activity timeline" count={data.activities?.length ?? 0}>
            {data.activities?.length ? (
              <div className="relative pl-5">
                <div className="absolute left-[7px] top-1 bottom-1 w-px bg-stone-800" />
                {data.activities.map((ev: any) => {
                  const cfg = ACT[ev.type] ?? { icon: Clock, cls: "text-stone-500" };
                  const Icon = cfg.icon;
                  return (
                    <div key={ev.id} className="relative pb-4 last:pb-0">
                      <div className="absolute -left-5 top-0.5 w-4 h-4 rounded-full bg-stone-900 border border-stone-700 flex items-center justify-center">
                        <Icon size={9} className={cfg.cls} />
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="text-sm text-stone-200">{ev.title}</p>
                        <span className="text-[11px] text-stone-600 shrink-0 whitespace-nowrap">{when(ev.occurredAt)}</span>
                      </div>
                      {ev.body && <p className="text-[12px] text-stone-500 mt-0.5">{ev.body}</p>}
                      {ev.actorName && <p className="text-[11px] text-stone-600 mt-0.5">{ev.actorName}</p>}
                    </div>
                  );
                })}
              </div>
            ) : <p className="text-xs text-stone-600 py-6 text-center">No activity yet. As emails, notes, tasks, deals and invoices happen, they'll appear here.</p>}
          </Panel>
        </div>
      </div>
    </div>
  );
}
