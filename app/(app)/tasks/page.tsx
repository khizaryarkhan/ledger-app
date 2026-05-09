"use client";

import { useState, useMemo } from "react";
import { useData } from "@/components/data-provider";
import { Card, EmptyState } from "@/components/ui";
import { useDataTable, ColHeader, ActiveFiltersBar, type ColDef } from "@/components/data-table";
import { CheckSquare, Circle, Check } from "lucide-react";
import { fmt } from "@/lib/format";

const PRIORITY_ORDER: Record<string, number> = { Urgent: 4, High: 3, Medium: 2, Low: 1 };

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: "bg-rose-50 text-rose-700 ring-rose-200",
  High: "bg-orange-50 text-orange-700 ring-orange-200",
  Medium: "bg-amber-50 text-amber-700 ring-amber-200",
  Low: "bg-stone-100 text-stone-600 ring-stone-200",
};

const TASK_COLS: ColDef[] = [
  { key: "title", label: "Task", sortValue: (r: any) => r.title, noFilter: true },
  { key: "priority", label: "Priority", sortValue: (r: any) => PRIORITY_ORDER[r.priority] ?? 0, filterLabel: (r: any) => r.priority ?? "Medium" },
  { key: "dueDate", label: "Due Date", sortValue: (r: any) => r.dueDate ?? "", noFilter: true },
];

export default function TasksPage() {
  const { tasks, toggleTask } = useData() as any;
  const [filter, setFilter] = useState<"open" | "completed" | "all">("open");

  const filtered = useMemo(() => {
    if (filter === "open") return tasks.filter((t: any) => !t.completed);
    if (filter === "completed") return tasks.filter((t: any) => t.completed);
    return tasks;
  }, [tasks, filter]);

  const dt = useDataTable(filtered, TASK_COLS, { defaultSort: "priority", defaultDir: "desc" });

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Tasks</h1>
          <p className="text-sm text-stone-500 mt-1">{dt.rows.length} {filter !== "all" ? filter : ""} tasks</p>
        </div>
        <div className="flex bg-stone-100 rounded-md p-0.5 text-xs font-medium">
          {(["open", "completed", "all"] as const).map((v) => {
            const label = v === "open" ? "Open" : v === "completed" ? "Completed" : "All";
            return (
              <button key={v} onClick={() => setFilter(v as any)}
                className={`px-3 py-1.5 rounded ${filter === v ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}>
                {label}
              </button>
            );
          })}
        </div>
      </div>

      {dt.rows.length === 0 ? (
        <Card>
          <EmptyState icon={CheckSquare} title="No tasks" description="Tasks created from invoices and customers will appear here." />
        </Card>
      ) : (
        <Card padding="none">
          <ActiveFiltersBar dt={dt} cols={TASK_COLS} />
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 bg-stone-50/50">
                {/* Checkbox column */}
                <th className="w-10 px-4 py-2.5" />
                {TASK_COLS.map(col => <ColHeader key={col.key} col={col} dt={dt} />)}
              </tr>
            </thead>
            <tbody>
              {dt.rows.map((t: any) => (
                <tr key={t.id} className={`border-b border-stone-100 last:border-0 hover:bg-stone-50 ${t.completed ? "opacity-60" : ""}`}>
                  <td className="px-4 py-3 w-10">
                    <button onClick={() => toggleTask(t.id, !t.completed)} className="flex-shrink-0 mt-0.5">
                      {t.completed
                        ? <Check size={16} className="text-emerald-600" />
                        : <Circle size={16} className="text-stone-300 hover:text-stone-500" />}
                    </button>
                  </td>
                  <td className="px-3 py-3">
                    <div className={`font-medium ${t.completed ? "text-stone-400 line-through" : "text-stone-900"}`}>{t.title}</div>
                    {t.description && <div className="text-[12px] text-stone-500 mt-0.5">{t.description}</div>}
                    {(t.labels ?? []).length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {(t.labels as string[]).map(l => (
                          <span key={l} className="text-[11px] px-1.5 py-0.5 rounded ring-1 ring-inset bg-stone-100 text-stone-600 ring-stone-200">{l}</span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    {t.priority && (
                      <span className={`text-[11px] px-2 py-0.5 rounded-md ring-1 ring-inset font-medium ${PRIORITY_COLORS[t.priority] ?? "bg-stone-100 text-stone-600 ring-stone-200"}`}>
                        {t.priority}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-[12px] text-stone-500 whitespace-nowrap">
                    {t.dueDate ? fmt.relative(t.dueDate) : <span className="text-stone-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
