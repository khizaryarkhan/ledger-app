"use client";

/**
 * Collections Board — Workspace view. A queue of customers on the left (who
 * needs me today, who is waiting and until when), the selected customer on the
 * right with its invoices and a way into the existing tools. Additive: it reads
 * the same rows the List view gets and the same next-action rules, and changes
 * nothing itself — every action opens a screen that already exists.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, CheckCircle2, Clock, Inbox, Moon } from "lucide-react";
import { fmt, formatDateShort, localToday } from "@/lib/format";
import type { BoardRow } from "@/components/board-list";
import {
  buildWorkspace, weekAhead, type WorkspaceCustomer, type WorkspaceInvoice, type WorkspaceSection,
} from "@/lib/workspace-queue";

const SECTION_META: Record<WorkspaceSection, { title: string; hint: string }> = {
  now:  { title: "Needs you today",   hint: "Something is waiting for a person" },
  done: { title: "Done today",        hint: "Chased today. Nothing more until they come back" },
  wait: { title: "Waiting",           hint: "Waiting on the customer or an owner" },
  idle: { title: "Nothing due yet",   hint: "No invoice has fallen due" },
};

/** The viewer's local calendar day of a timestamp, as YYYY-MM-DD. */
function localDay(ts: string): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function toWorkspaceInvoices(rows: BoardRow[], comments: any[]): WorkspaceInvoice[] {
  const chases: Record<string, number> = {};
  const lastOut: Record<string, number> = {};
  const lastIn: Record<string, number> = {};
  for (const c of comments ?? []) {
    if (!c.invoiceId || c.isDraft) continue;
    const t = new Date(c.sentAt ?? c.createdAt ?? 0).getTime();
    if (c.direction === "Outbound" && (c.channel === "Email" || c.channel === "Chase")) {
      chases[c.invoiceId] = (chases[c.invoiceId] ?? 0) + 1;
      lastOut[c.invoiceId] = Math.max(lastOut[c.invoiceId] ?? 0, t);
    } else if (c.direction === "Inbound") {
      lastIn[c.invoiceId] = Math.max(lastIn[c.invoiceId] ?? 0, t);
    }
  }
  return rows.map(r => {
    const id = r.inv.id as string;
    return {
      id,
      custId: r.custId,
      custName: r.custName,
      projName: r.projName,
      invoiceNumber: r.inv.invoiceNumber ?? "",
      bal: r.bal,
      currency: r.inv.currency ?? "USD",
      days: r.days,
      dueDate: r.inv.dueDate ?? null,
      email: r.email,
      stageLabel: r.stageLabel,
      promiseDate: r.inv.promiseDate ?? null,
      hasOpenDispute: !!r.inv.hasOpenDispute,
      escalatedToName: r.inv.escalatedToName ?? null,
      lastChaseDay: r.lastSent ? localDay(r.lastSent) : null,
      daysSinceChase: r.lastSent ? Math.max(0, Math.floor((Date.now() - new Date(r.lastSent).getTime()) / 86400000)) : null,
      chaseCount: chases[id] ?? 0,
      // A customer reply newer than our last outbound email is waiting for an answer.
      unreadReply: (lastIn[id] ?? 0) > (lastOut[id] ?? 0),
    };
  });
}

function Money({ total }: { total: Record<string, number> }) {
  const entries = Object.entries(total).filter(([, v]) => v > 0);
  return <>{entries.map(([c, v], i) => <span key={c}>{i > 0 && " · "}{fmt.money(v, c)}</span>)}</>;
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
function weekdayOf(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

export function BoardWorkspace({ rows, comments }: { rows: BoardRow[]; comments: any[] }) {
  const today = localToday();
  const customers = useMemo(
    () => buildWorkspace(toWorkspaceInvoices(rows, comments), today),
    [rows, comments, today],
  );
  const [picked, setPicked] = useState<string | null>(null);
  const selected = customers.find(c => c.custId === picked) ?? customers.find(c => c.section === "now") ?? customers[0] ?? null;
  const week = useMemo(() => weekAhead(customers, today), [customers, today]);

  const counts = useMemo(() => {
    const n: Record<WorkspaceSection, number> = { now: 0, done: 0, wait: 0, idle: 0 };
    customers.forEach(c => { n[c.section]++; });
    return n;
  }, [customers]);

  if (customers.length === 0) {
    return <div className="flex-1 flex items-center justify-center text-[13px] text-stone-400">No open invoices match the current filters.</div>;
  }

  const sections: WorkspaceSection[] = ["now", "done", "wait", "idle"];

  return (
    <div className="flex-1 min-h-0 flex">
      <aside className="w-[380px] flex-shrink-0 border-r border-stone-800 overflow-y-auto" aria-label="Customer queue">
        <div className="p-4 border-b border-stone-800">
          {counts.now > 0 ? (
            <p className="text-[13px] text-stone-200"><span className="font-semibold text-white">{counts.now}</span> customer{counts.now === 1 ? "" : "s"} need you today.</p>
          ) : (
            <p className="text-[13px] text-stone-200 flex items-center gap-2"><CheckCircle2 size={14} className="text-emerald-400" /> You are all caught up for today.</p>
          )}
          <div className="mt-3 grid grid-cols-7 gap-1" aria-label="Week ahead">
            {week.map(col => (
              <div key={col.date} className="rounded-md bg-stone-900 border border-stone-800 px-1 py-1.5 text-center" title={col.names.join(", ") || "No one comes back this day"}>
                <div className="text-[11px] text-stone-400">{col.date === today ? "Today" : weekdayOf(col.date)}</div>
                <div className={`text-[13px] font-semibold tabular-nums ${col.names.length ? "text-white" : "text-stone-500"}`}>{col.names.length}</div>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-stone-400 mt-1.5">Customers coming back each day</p>
        </div>

        {sections.map(sec => {
          const list = customers.filter(c => c.section === sec);
          if (list.length === 0) return null;
          return (
            <section key={sec}>
              <div className="px-4 pt-3 pb-1">
                <div className="text-[12px] font-semibold text-stone-300 uppercase tracking-wider">{SECTION_META[sec].title} <span className="text-stone-500">{list.length}</span></div>
                <div className="text-[11px] text-stone-500">{SECTION_META[sec].hint}</div>
              </div>
              {list.map(c => <QueueItem key={c.custId} c={c} active={selected?.custId === c.custId} onPick={() => setPicked(c.custId)} today={today} />)}
            </section>
          );
        })}
      </aside>

      <main className="flex-1 min-w-0 overflow-y-auto">
        {selected && <CustomerPanel c={selected} today={today} />}
      </main>
    </div>
  );
}

function QueueItem({ c, active, onPick, today }: { c: WorkspaceCustomer; active: boolean; onPick: () => void; today: string }) {
  const Icon = c.section === "done" ? CheckCircle2 : c.section === "wait" ? Clock : c.section === "idle" ? Moon : Inbox;
  return (
    <button onClick={onPick} aria-current={active ? "true" : undefined}
      className={`w-full text-left px-4 py-2.5 border-l-2 transition-colors ${active ? "border-emerald-500 bg-stone-900" : "border-transparent hover:bg-stone-900/60"}`}>
      <div className="flex items-center gap-2">
        <Icon size={13} className="text-stone-400 flex-shrink-0" />
        <span className="text-[15px] font-semibold text-white truncate">{c.name}</span>
        <span className="ml-auto text-[13px] tabular-nums text-stone-300 whitespace-nowrap"><Money total={c.total} /></span>
      </div>
      <div className="text-[13px] text-stone-400 mt-0.5 pl-[21px]">
        {c.section === "now" ? c.top.label + (c.top.detail ? ` · ${c.top.detail}` : "") : c.wake ? (c.wake.date ? `Back ${formatDateShort(c.wake.date)}${c.wake.date === today ? " (today)" : ""}` : c.wake.why) : c.top.label}
      </div>
      {c.wake?.pct != null && c.section !== "now" && (
        <div className="mt-1.5 ml-[21px] h-1 rounded-full bg-stone-800 overflow-hidden" aria-hidden="true">
          <div className="h-full bg-emerald-500" style={{ width: `${c.wake.pct}%` }} />
        </div>
      )}
    </button>
  );
}

function CustomerPanel({ c, today }: { c: WorkspaceCustomer; today: string }) {
  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[20px] font-semibold text-white tracking-tight">{c.name}</h2>
          <p className="text-[13px] text-stone-400 mt-0.5"><Money total={c.total} /> · {c.items.length} open invoice{c.items.length === 1 ? "" : "s"}</p>
        </div>
        <Link href={`/customers/${c.custId}`} className="inline-flex items-center gap-1 h-8 px-3 rounded-md text-[12px] font-medium bg-stone-800 ring-1 ring-stone-700 text-stone-200 hover:text-white">
          Open customer <ChevronRight size={12} />
        </Link>
      </div>

      <div className="mt-4 rounded-lg border border-stone-800 bg-stone-900 p-4">
        {c.section === "now" ? (
          <>
            <div className="text-[12px] uppercase tracking-wider text-stone-400">Do this next</div>
            <div className="text-[18px] font-semibold text-white mt-0.5">{c.top.label}{c.top.detail ? <span className="text-stone-400 font-normal"> · {c.top.detail}</span> : null}</div>
            <p className="text-[13px] text-stone-400 mt-1">Open the customer to send the email, log the call or record what they said. Everything you do there is saved as before.</p>
          </>
        ) : (
          <>
            <div className="text-[12px] uppercase tracking-wider text-stone-400">{c.section === "done" ? "Done for today" : "Nothing to do right now"}</div>
            <div className="text-[15px] font-semibold text-white mt-0.5">
              {c.wake?.date ? `Back ${formatDateShort(c.wake.date)}${c.wake.date === today ? " (today)" : ""}` : c.wake?.why ?? c.top.label}
            </div>
            {c.wake?.date && <p className="text-[13px] text-stone-400 mt-1">{c.wake.why}</p>}
          </>
        )}
      </div>

      <h3 className="text-[12px] font-semibold text-stone-300 uppercase tracking-wider mt-6 mb-2">Invoices</h3>
      <ul className="divide-y divide-stone-800 rounded-lg border border-stone-800">
        {c.items.map(({ inv, action }) => (
          <li key={inv.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <Link href={`/invoices/${inv.id}`} className="text-[13px] font-medium text-white hover:underline">{inv.invoiceNumber || "Invoice"}</Link>
              <div className="text-[13px] text-stone-400 truncate">
                {inv.projName ? `${inv.projName} · ` : ""}{inv.days > 0 ? `${inv.days} days over` : inv.dueDate ? `Due ${formatDateShort(inv.dueDate)}` : "Not due"} · {inv.stageLabel}
              </div>
            </div>
            <div className="text-[13px] text-stone-300 whitespace-nowrap">{action.type === "none" && action.label === "—" ? "No action" : action.label}</div>
            <div className="text-[13px] tabular-nums text-white whitespace-nowrap">{fmt.money(inv.bal, inv.currency)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
