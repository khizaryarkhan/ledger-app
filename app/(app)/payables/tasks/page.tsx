"use client";

import { useState, useEffect } from "react";
import { CheckSquare, Plus, AlertCircle, Clock, User } from "lucide-react";

interface ApTask {
  id: string;
  title: string;
  description?: string;
  assigneeId?: string;
  assigneeName?: string;
  dueDate?: string;
  priority: "Low" | "Medium" | "High";
  completed: boolean;
  entityType?: string;
  entityRef?: string;
  createdAt: string;
}

const PRIORITY_BADGE: Record<string, string> = {
  High: "bg-rose-500/15 text-rose-400",
  Medium: "bg-amber-500/15 text-amber-400",
  Low: "bg-stone-700 text-stone-400",
};

export default function PayablesTasksPage() {
  const [tasks, setTasks] = useState<ApTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "pending" | "completed">("pending");

  useEffect(() => {
    fetch("/api/tasks?scope=payables")
      .then(r => r.ok ? r.json() : [])
      .then(d => setTasks(Array.isArray(d) ? d : []))
      .catch(() => setTasks([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = tasks.filter(t => {
    if (filter === "pending") return !t.completed;
    if (filter === "completed") return t.completed;
    return true;
  });

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">Payables Tasks</h1>
          <p className="text-sm text-stone-400 mt-0.5">Action items related to AP workflows</p>
        </div>
        <button className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium px-3.5 py-2 rounded-lg transition-colors">
          <Plus size={15} />
          New Task
        </button>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-5 bg-stone-900 rounded-lg p-1 w-fit">
        {(["all", "pending", "completed"] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-md text-[13px] font-medium capitalize transition-colors ${
              filter === f ? "bg-stone-700 text-white" : "text-stone-400 hover:text-stone-200"
            }`}
          >
            {f}
            <span className="ml-1.5 text-[11px] bg-stone-800 text-stone-400 px-1.5 py-0.5 rounded">
              {f === "all" ? tasks.length : f === "pending" ? tasks.filter(t => !t.completed).length : tasks.filter(t => t.completed).length}
            </span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-stone-800 rounded-lg animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-stone-500">
          <CheckSquare size={32} className="mx-auto mb-3 opacity-50" />
          <p className="font-medium">No tasks</p>
          <p className="text-sm mt-1">All caught up!</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(task => (
            <div
              key={task.id}
              className={`bg-stone-900 border rounded-lg p-4 flex items-start gap-3 ${
                task.completed ? "border-stone-800 opacity-60" : "border-stone-800 hover:border-stone-700"
              }`}
            >
              <div className={`w-5 h-5 rounded border-2 shrink-0 mt-0.5 flex items-center justify-center ${
                task.completed ? "bg-violet-600 border-violet-600" : "border-stone-600"
              }`}>
                {task.completed && <CheckSquare size={12} className="text-white" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`text-sm font-medium ${task.completed ? "line-through text-stone-500" : "text-white"}`}>
                    {task.title}
                  </span>
                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_BADGE[task.priority]}`}>
                    {task.priority}
                  </span>
                  {task.entityRef && (
                    <span className="text-[10px] bg-violet-500/10 text-violet-400 px-1.5 py-0.5 rounded">
                      {task.entityRef}
                    </span>
                  )}
                </div>
                {task.description && (
                  <p className="text-xs text-stone-400 mt-0.5 truncate">{task.description}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5">
                  {task.assigneeName && (
                    <span className="flex items-center gap-1 text-[11px] text-stone-500">
                      <User size={10} /> {task.assigneeName}
                    </span>
                  )}
                  {task.dueDate && (
                    <span className={`flex items-center gap-1 text-[11px] ${
                      !task.completed && new Date(task.dueDate) < new Date() ? "text-rose-400" : "text-stone-500"
                    }`}>
                      <Clock size={10} /> Due {task.dueDate}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
