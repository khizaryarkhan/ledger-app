"use client";

import { useState } from "react";
import { Card, Badge } from "@/components/ui";
import { emailTemplates } from "@/lib/format";
import { FileEdit } from "lucide-react";

export default function TemplatesPage() {
  const [selected, setSelected] = useState(emailTemplates[0].id);
  const tpl = emailTemplates.find(t => t.id === selected)!;

  return (
    <div className="p-6 max-w-[1300px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Email Templates</h1>
        <p className="text-sm text-stone-500 mt-1">Pre-built reminder templates with merge variables</p>
      </div>

      <div className="grid grid-cols-12 gap-4">
        <div className="col-span-4">
          <div className="space-y-1">
            {emailTemplates.map(t => {
              const active = selected === t.id;
              return (
                <button key={t.id} onClick={() => setSelected(t.id)}
                  className={`w-full text-left px-3 py-2.5 rounded-md transition-colors flex items-start gap-2.5 ${active ? "bg-white ring-1 ring-stone-200 shadow-sm" : "hover:bg-stone-50"}`}>
                  <FileEdit size={14} className="text-stone-500 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-stone-900 truncate">{t.name}</div>
                    <div className="text-[11px] text-stone-500 truncate mt-0.5">{t.subject}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="col-span-8">
          <Card>
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-stone-900">{tpl.name}</h3>
                <Badge variant="green" size="sm">Active</Badge>
              </div>
            </div>
            <div className="mb-4">
              <div className="text-xs text-stone-500 mb-1">Subject</div>
              <div className="text-sm font-medium text-stone-900 bg-stone-50 rounded-md p-3 font-mono">{tpl.subject}</div>
            </div>
            <div>
              <div className="text-xs text-stone-500 mb-1">Body</div>
              <div className="text-sm text-stone-800 bg-stone-50 rounded-md p-4 whitespace-pre-wrap font-mono leading-relaxed">{tpl.body}</div>
            </div>
            <div className="mt-4 pt-4 border-t border-stone-200">
              <div className="text-xs font-medium text-stone-700 mb-2">Available variables</div>
              <div className="flex flex-wrap gap-1.5">
                {["contactName", "customerName", "invoiceNumber", "amount", "dueDate", "daysOverdue", "senderName"].map(v => (
                  <code key={v} className="text-[11px] font-mono bg-stone-100 text-stone-700 px-2 py-0.5 rounded">{`{${v}}`}</code>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
