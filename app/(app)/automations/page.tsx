"use client";

import { Card, Badge } from "@/components/ui";
import { Zap, Mail, Clock, AlertOctagon } from "lucide-react";

const RULES = [
  { name: "Pre-due reminder", trigger: "3 days before due date", action: "Send 'Friendly reminder' template", status: "active" },
  { name: "First overdue notice", trigger: "1 day after due date", action: "Send 'First overdue' template", status: "active" },
  { name: "Second overdue notice", trigger: "8 days after due date", action: "Send 'Second overdue' template", status: "active" },
  { name: "Final notice", trigger: "21 days after due date", action: "Send 'Final notice' template, escalate", status: "active" },
  { name: "Auto-escalate (30 days)", trigger: "30+ days overdue", action: "Move stage to Escalated", status: "active" },
  { name: "Pause on dispute", trigger: "Stage = Disputed", action: "Pause all reminders", status: "active" },
  { name: "Pause on promise", trigger: "Stage = Promise to Pay", action: "Pause until promise date", status: "active" },
];

export default function AutomationsPage() {
  return (
    <div className="p-6 max-w-[1100px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Automations</h1>
        <p className="text-sm text-stone-500 mt-1">Reminder rules that run automatically each day</p>
      </div>

      <Card className="mb-4 bg-amber-50 ring-amber-200">
        <div className="flex items-start gap-3">
          <AlertOctagon size={18} className="text-amber-700 mt-0.5 flex-shrink-0" />
          <div className="text-sm text-amber-900">
            <div className="font-medium mb-1">Email sending requires Microsoft 365 connection</div>
            <div>Reminder rules are configured but emails won't actually send until you connect Microsoft 365 in Settings. The 30-day auto-escalation rule runs daily and works without M365.</div>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <div className="px-4 py-3 border-b border-stone-200">
          <h3 className="text-sm font-semibold text-stone-900">Active rules</h3>
        </div>
        {RULES.map((r, i) => (
          <div key={i} className="px-4 py-3 border-b border-stone-100 last:border-0 flex items-start gap-3">
            <div className="w-8 h-8 rounded-md bg-stone-100 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Zap size={14} className="text-stone-600" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <div className="text-sm font-medium text-stone-900">{r.name}</div>
                <Badge variant="green" size="sm">Active</Badge>
              </div>
              <div className="text-xs text-stone-600 flex items-center gap-1.5">
                <Clock size={11} className="text-stone-400" /> {r.trigger}
              </div>
              <div className="text-xs text-stone-600 flex items-center gap-1.5 mt-0.5">
                <Mail size={11} className="text-stone-400" /> {r.action}
              </div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}
