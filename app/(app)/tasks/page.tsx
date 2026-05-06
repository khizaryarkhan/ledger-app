"use client";

import { useState, useMemo } from "react";
import { useData } from "@/components/data-provider";
import { TasksList } from "@/components/feature";
import { Card, EmptyState } from "@/components/ui";
import { CheckSquare } from "lucide-react";

export default function TasksPage() {
  const { tasks } = useData();
  const [filter, setFilter] = useState<"open" | "completed" | "all">("open");

  const filtered = useMemo(() => {
    if (filter === "open") return tasks.filter(t => !t.completed);
    if (filter === "completed") return tasks.filter(t => t.completed);
    return tasks;
  }, [tasks, filter]);

  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Tasks</h1>
          <p className="text-sm text-stone-500 mt-1">{filtered.length} {filter} tasks</p>
        </div>
        <div className="flex bg-stone-100 rounded-md p-0.5 text-xs font-medium">
          {[["open", "Open"], ["completed", "Completed"], ["all", "All"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v as any)}
              className={`px-3 py-1.5 rounded ${filter === v ? "bg-white text-stone-900 shadow-sm" : "text-stone-600 hover:text-stone-900"}`}>{l}</button>
          ))}
        </div>
      </div>
      {filtered.length === 0 ? (
        <Card><EmptyState icon={CheckSquare} title="No tasks" description="Tasks created from invoices and customers will appear here." /></Card>
      ) : (
        <TasksList tasks={filtered} />
      )}
    </div>
  );
}
