"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { useRouter } from "next/navigation";
import { CheckSquare, Phone, Mail, Send, Loader, ListTodo, AlertTriangle, Calendar } from "lucide-react";

type Task = {
  id: string; title: string; dueDate: string | null; priority: string; type: string;
  leadId: string; leadName: string | null; company: string | null;
  accountId: string | null; accountRef: string | null; accountName: string | null; lifecycle: string | null;
};

const TYPE_ICON: Record<string, any> = { call: Phone, email: Mail, follow_up: Send, todo: CheckSquare };
const PRIO: Record<string, string> = { high: "bg-rose-500", normal: "bg-stone-600", low: "bg-stone-700" };

const dayStart = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

export default function QueuePage() {
  const router = useRouter();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<"all" | "me">("all");
  const [doneIds, setDoneIds] = useState<Set<string>>(new Set());

  const [error, setError] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    setError("");
    fetch(`/api/admin/queue?owner=${scope}`)
      .then(async r => {
        if (!r.ok) throw new Error("Failed to load queue");
        return r.json();
      })
      .then(d => { setTasks(d.tasks ?? []); setDoneIds(new Set()); })
      .catch(() => setError("Failed to load task queue"))
      .finally(() => setLoading(false));
  }, [scope]);
  useEffect(() => { load(); }, [load]);

  const complete = async (t: Task) => {
    setDoneIds(prev => new Set(prev).add(t.id));
    try {
      const r = await fetch(`/api/admin/leads/${t.leadId}/tasks/${t.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ completed: true }),
      });
      if (!r.ok) setDoneIds(prev => { const n = new Set(prev); n.delete(t.id); return n; });
    } catch {
      setDoneIds(prev => { const n = new Set(prev); n.delete(t.id); return n; });
    }
  };

  const buckets = useMemo(() => {
    const now = new Date();
    const todayStart = dayStart(now);
    const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1);
    const b = { overdue: [] as Task[], today: [] as Task[], upcoming: [] as Task[], someday: [] as Task[] };
    const order = (t: Task) => (t.priority === "high" ? 0 : t.priority === "normal" ? 1 : 2);
    for (const t of tasks) {
      if (doneIds.has(t.id)) continue;
      if (!t.dueDate) { b.someday.push(t); continue; }
      const d = new Date(t.dueDate);
      if (d < todayStart) b.overdue.push(t);
      else if (d < todayEnd) b.today.push(t);
      else b.upcoming.push(t);
    }
    b.overdue.sort((a, c) => order(a) - order(c));
    b.today.sort((a, c) => order(a) - order(c));
    return b;
  }, [tasks, doneIds]);

  const total = buckets.overdue.length + buckets.today.length + buckets.upcoming.length + buckets.someday.length;

  const Row = ({ t }: { t: Task }) => {
    const Icon = TYPE_ICON[t.type] ?? CheckSquare;
    const due = t.dueDate ? new Date(t.dueDate) : null;
    return (
      <div className="flex items-center gap-3 px-4 py-3 border-b border-stone-800/50 hover:bg-stone-800/20 group">
        <button onClick={() => complete(t)} title="Mark done"
          className="w-5 h-5 rounded-md border border-stone-600 hover:border-emerald-500 hover:bg-emerald-500/10 flex items-center justify-center shrink-0">
          <CheckSquare size={12} className="text-stone-600 group-hover:text-emerald-400" />
        </button>
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PRIO[t.priority] ?? PRIO.normal}`} title={`${t.priority} priority`} />
        <Icon size={14} className="text-stone-500 shrink-0" />
        <div className="min-w-0 flex-1 cursor-pointer" onClick={() => t.accountId ? router.push(`/admin/accounts/${t.accountId}`) : router.push(`/admin/leads/${t.leadId}`)}>
          <div className="text-sm text-stone-100 truncate">{t.title}</div>
          <div className="text-[11px] text-stone-500 truncate">
            {t.accountName ?? t.leadName}{t.accountRef ? ` · ${t.accountRef}` : ""}
          </div>
        </div>
        {due && <span className="text-[11px] text-stone-500 shrink-0">{due.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}{due.getHours() || due.getMinutes() ? ` ${due.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>}
      </div>
    );
  };

  const Section = ({ title, icon: Icon, tone, items }: { title: string; icon: any; tone: string; items: Task[] }) => {
    if (!items.length) return null;
    return (
      <div className="rounded-xl border border-stone-800 overflow-hidden mb-4">
        <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-900/40 border-b border-stone-800">
          <Icon size={14} className={tone} />
          <span className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">{title}</span>
          <span className="text-[11px] text-stone-600">{items.length}</span>
        </div>
        <div>{items.map(t => <Row key={t.id} t={t} />)}</div>
      </div>
    );
  };

  return (
    <div className="max-w-[900px] mx-auto">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Today</h1>
          <p className="text-xs text-stone-500 mt-0.5">Your sales queue — every open task across the book, what needs doing now.</p>
        </div>
        <div className="flex items-center gap-1 p-1 rounded-lg bg-stone-900 border border-stone-800">
          {(["all", "me"] as const).map(s => (
            <button key={s} onClick={() => setScope(s)}
              className={`px-3 h-8 text-xs font-medium rounded-md ${scope === s ? "bg-stone-700 text-white" : "text-stone-400 hover:text-stone-200"}`}>
              {s === "all" ? "All" : "Mine"}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="mb-4 text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">{error}</div>
      )}

      {loading ? (
        <div className="h-64 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : total === 0 ? (
        <div className="py-20 text-center border border-stone-800 rounded-xl">
          <ListTodo size={26} className="text-stone-700 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Queue clear — nothing open.</p>
          <p className="text-xs text-stone-600 mt-1">Add tasks from any lead or account to see them here.</p>
        </div>
      ) : (
        <>
          <Section title="Overdue" icon={AlertTriangle} tone="text-rose-400" items={buckets.overdue} />
          <Section title="Today" icon={CheckSquare} tone="text-emerald-400" items={buckets.today} />
          <Section title="Upcoming" icon={Calendar} tone="text-sky-400" items={buckets.upcoming} />
          <Section title="No due date" icon={ListTodo} tone="text-stone-500" items={buckets.someday} />
        </>
      )}
    </div>
  );
}
