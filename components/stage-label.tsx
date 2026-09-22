"use client";

import { AlertOctagon, AlertTriangle, ArrowUpRight, CalendarClock } from "lucide-react";
import { Stage, isExceptionStage, stageChipClass, stageDotClass } from "@/lib/stages";
import { fmt } from "@/lib/format";

/**
 * Read-only stage label for list screens, drawn by the Collections Board's
 * rule (lib/stages.ts): colour means EXCEPTION. Disputed / Escalated / On Hold
 * and a broken commitment get a filled chip; every other stage is quiet text
 * with a hue dot; a live commitment reads quiet with its date.
 *
 * Same priority order as the board's stage cell: Escalated → Disputed →
 * Broken commitment → Committed → plain stage.
 */
export function StageLabel({ label, stages, hasOpenDispute, disputeReason, promiseDate, escalationType, today }: {
  label: string;
  stages: Stage[];
  hasOpenDispute?: boolean | null;
  disputeReason?: string | null;
  promiseDate?: string | null;
  escalationType?: string | null;
  /** Local YYYY-MM-DD (localToday()) — a commitment is broken once its date has passed. */
  today: string;
}) {
  const base = "inline-flex items-center gap-1.5 text-[11px] font-medium";
  const chip = (l: string) => `${base} rounded-full px-2 py-0.5 ${stageChipClass(l, stages)}`;

  if (label === "Escalated") {
    return (
      <span className={chip("Escalated")} title={escalationType ? `Escalated — ${escalationType}` : "Escalated"}>
        <ArrowUpRight size={10} className="shrink-0" /> Escalated
        {escalationType && <span className="text-rose-300/70 truncate max-w-[130px]">· {escalationType}</span>}
      </span>
    );
  }
  if (hasOpenDispute) {
    return (
      <span className={chip("Disputed")} title={`Disputed${disputeReason ? " — " + disputeReason : ""}`}>
        <AlertOctagon size={10} className="shrink-0" /> Disputed
        {disputeReason && <span className="text-rose-300/70 max-w-[110px] truncate">· {disputeReason}</span>}
      </span>
    );
  }
  if (promiseDate && promiseDate < today) {
    return (
      <span className={`${base} rounded-full px-2 py-0.5 bg-rose-600/25 text-rose-200 border border-rose-700`} title={`Broken commitment — was promised ${promiseDate}`}>
        <AlertTriangle size={10} className="shrink-0" /> Broken <span className="text-rose-300/80 tabular-nums">· was {fmt.shortDate(promiseDate)}</span>
      </span>
    );
  }
  if (promiseDate) {
    return (
      <span className={`${base} px-1.5 py-0.5 text-stone-300`} title={`Committed to pay ${promiseDate}`}>
        <CalendarClock size={10} className="shrink-0 text-stone-500" /> Committed <span className="text-stone-500 tabular-nums">· {fmt.shortDate(promiseDate)}</span>
      </span>
    );
  }
  if (isExceptionStage(label, stages)) return <span className={chip(label)}>{label}</span>;
  return (
    <span className={`${base} px-1.5 py-0.5 text-stone-300`}>
      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${stageDotClass(label, stages)}`} /> {label}
    </span>
  );
}
