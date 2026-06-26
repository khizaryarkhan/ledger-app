"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { Bell, AlertTriangle, FileText, XCircle, CreditCard, ListTodo } from "lucide-react";

type Alert = { key: string; label: string; count: number; href: string; icon: any; tone: string };

export function AdminNotifications() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [overdueTasks, setOverdueTasks] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/overview").then(r => r.ok ? r.json() : null),
      fetch("/api/admin/queue?owner=all").then(r => r.ok ? r.json() : { tasks: [] }),
    ]).then(([overview, queue]) => {
      const s = overview?.stats ?? {};
      const items: Alert[] = [];
      if ((s.pendingCancellations ?? 0) > 0) items.push({ key: "cancellations", label: "Cancellation requests", count: s.pendingCancellations, href: "/admin/cancellations", icon: XCircle, tone: "text-amber-400" });
      if ((s.newLeads ?? 0) > 0) items.push({ key: "leads", label: "New leads", count: s.newLeads, href: "/admin/leads", icon: FileText, tone: "text-blue-400" });
      if ((s.failedPayments ?? 0) > 0) items.push({ key: "failed", label: "Failed payments", count: s.failedPayments, href: "/admin/subscriptions", icon: CreditCard, tone: "text-rose-400" });
      if ((s.pastDue ?? 0) > 0) items.push({ key: "pastdue", label: "Past-due subscriptions", count: s.pastDue, href: "/admin/subscriptions", icon: AlertTriangle, tone: "text-rose-400" });
      setAlerts(items);

      const now = new Date();
      const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
      const overdue = (queue?.tasks ?? []).filter((t: any) => t.dueDate && new Date(t.dueDate) < todayStart).length;
      setOverdueTasks(overdue);
    }).catch(() => {});
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  const total = alerts.reduce((n, a) => n + a.count, 0) + (overdueTasks > 0 ? overdueTasks : 0);

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)} aria-label="Notifications"
        className="relative w-9 h-9 rounded-xl flex items-center justify-center text-stone-500 hover:text-stone-200 transition-colors"
        style={{ background: "#111726", border: "0.5px solid #202A3E" }}>
        <Bell size={15} />
        {total > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 rounded-full bg-rose-500 text-[10px] font-bold text-white flex items-center justify-center">
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 rounded-xl shadow-xl z-50 overflow-hidden"
          style={{ background: "#111726", border: "0.5px solid #202A3E" }}>
          <div className="px-4 py-3 border-b border-stone-800">
            <p className="text-sm font-medium text-white">Notifications</p>
            <p className="text-[11px] text-stone-500 mt-0.5">Items that need your attention</p>
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {overdueTasks > 0 && (
              <Link href="/admin/queue" onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-800/40 transition-colors">
                <ListTodo size={14} className="text-rose-400" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-stone-200">Overdue tasks</p>
                  <p className="text-[11px] text-stone-500">{overdueTasks} task{overdueTasks !== 1 ? "s" : ""} past due</p>
                </div>
                <span className="text-xs font-semibold text-rose-400 tabular-nums">{overdueTasks}</span>
              </Link>
            )}
            {alerts.map(a => (
              <Link key={a.key} href={a.href} onClick={() => setOpen(false)}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-stone-800/40 transition-colors">
                <a.icon size={14} className={a.tone} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-stone-200">{a.label}</p>
                </div>
                <span className={`text-xs font-semibold tabular-nums ${a.tone}`}>{a.count}</span>
              </Link>
            ))}
            {total === 0 && (
              <p className="px-4 py-8 text-xs text-stone-600 text-center">All clear — nothing needs attention.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
