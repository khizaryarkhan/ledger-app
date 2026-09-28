"use client";

import { useState, useMemo } from "react";
import { useData } from "@/components/data-provider";
import { Circle, Check } from "lucide-react";
import { fmt } from "@/lib/format";
import {
  useListView, ListPage, ListPageHeader, ListToolbar, ListChips, ListScroll, ListHead, ListFoot,
  listTable, listRow, type ListColumn,
} from "@/components/list-view";

const PRIORITY_ORDER: Record<string, number> = { Urgent: 4, High: 3, Medium: 2, Low: 1 };

const PRIORITY_COLORS: Record<string, string> = {
  Urgent: "bg-rose-500/15 text-rose-300 ring-rose-500/30",
  High: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  Medium: "bg-amber-500/15 text-amber-300 ring-amber-500/30",
  Low: "bg-stone-800 text-stone-400 ring-stone-700",
};

const FILTERS = ["open", "completed", "all"] as const;
type TaskFilter = (typeof FILTERS)[number];

export default function TasksPage() {
  const { tasks, toggleTask } = useData() as any;
  const [filter, setFilter] = useState<TaskFilter>("open");

  const filtered = useMemo(() => {
    if (filter === "open") return tasks.filter((t: any) => !t.completed);
    if (filter === "completed") return tasks.filter((t: any) => t.completed);
    return tasks;
  }, [tasks, filter]);

  const TASK_COLS = useMemo<ListColumn<any>[]>(() => [
    {
      key: "task", label: "Task", sort: r => r.title,
      // The toggle-complete control lives inside this cell rather than a
      // separate leading column — ListHead has no slot for a column before
      // the sortable/filterable ones, only `trailing` ones after.
      // (See the handback report — this is the one gap that would need a
      // list-view.tsx change, which is out of scope here.)
    },
    { key: "priority", label: "Priority", sort: r => PRIORITY_ORDER[r.priority] ?? 0, descFirst: true,
      filter: { kind: "multi", value: r => r.priority ?? "Medium" } },
    { key: "dueDate", label: "Due Date", sort: r => r.dueDate ?? "" },
  ], []);

  const lv = useListView(filtered, TASK_COLS, { storageKey: "tasks", defaultSort: "priority", defaultDir: "desc" });

  return (
    <ListPage>
      <ListPageHeader title="Tasks" subtitle={<>{lv.rows.length} {filter !== "all" ? filter : ""} task{lv.rows.length !== 1 ? "s" : ""}</>}>
        <div className="flex bg-stone-800 rounded-md p-0.5 text-xs font-medium">
          {FILTERS.map((v) => {
            const label = v === "open" ? "Open" : v === "completed" ? "Completed" : "All";
            return (
              <button key={v} onClick={() => setFilter(v)}
                className={`px-3 py-1.5 rounded ${filter === v ? "bg-stone-700 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>
                {label}
              </button>
            );
          })}
        </div>
      </ListPageHeader>

      <ListToolbar lv={lv} noun="task" filtered={filter !== "all"} />
      <ListChips lv={lv} />

      <ListScroll lv={lv} empty={tasks.length === 0 ? "No tasks — tasks created from invoices and customers will appear here." : "No tasks match the current filters."}>
        <table className={listTable}>
          <ListHead lv={lv} />
          <tbody>
            {lv.rows.map((t: any) => (
              <tr key={t.id} className={listRow()}>
                <td className="px-2 py-2">
                  <div className={`flex items-start gap-2 ${t.completed ? "opacity-60" : ""}`}>
                    <button onClick={() => toggleTask(t.id, !t.completed)} className="flex-shrink-0 mt-0.5" aria-label={t.completed ? "Mark incomplete" : "Mark complete"}>
                      {t.completed
                        ? <Check size={16} className="text-emerald-500" />
                        : <Circle size={16} className="text-stone-600 hover:text-stone-400" />}
                    </button>
                    <div>
                      <div className={`font-medium text-[13px] ${t.completed ? "text-stone-500 line-through" : "text-stone-200"}`}>{t.title}</div>
                      {t.description && <div className="text-[12px] text-stone-500 mt-0.5">{t.description}</div>}
                      {(t.labels ?? []).length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {(t.labels as string[]).map(l => (
                            <span key={l} className="text-[11px] px-1.5 py-0.5 rounded ring-1 ring-inset bg-stone-800 text-stone-400 ring-stone-700">{l}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-2 py-2">
                  {t.priority && (
                    <span className={`text-[11px] px-2 py-0.5 rounded-md ring-1 ring-inset font-medium ${PRIORITY_COLORS[t.priority] ?? "bg-stone-800 text-stone-400 ring-stone-700"}`}>
                      {t.priority}
                    </span>
                  )}
                </td>
                <td className="px-2 py-2 text-[12px] text-stone-500 whitespace-nowrap">
                  {t.dueDate ? fmt.relative(t.dueDate) : <span className="text-stone-700">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
          {lv.rows.length > 0 && <ListFoot lv={lv} noun="task" />}
        </table>
      </ListScroll>
    </ListPage>
  );
}
