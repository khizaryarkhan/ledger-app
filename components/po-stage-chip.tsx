"use client";

/**
 * How an order's stage is drawn — the Collections Board's rule: colour means
 * EXCEPTION, nothing else. An exception stage earns a filled chip; every other
 * stage is quiet text with a hue dot. Both come from lib/stages.ts so the two
 * lists cannot drift.
 */
import { useCallback, useEffect, useState } from "react";
import { STAGE_CHIP_CLASSES, STAGE_COLOR_CLASSES } from "@/lib/stages";
import { SYSTEM_PO_STAGES, FULFILMENT_STAGES, isPoExceptionStage, type PoStageDef } from "@/lib/accounting/po-workflow";

export interface PoStageSet { system: PoStageDef[]; custom: PoStageDef[]; fulfilment: PoStageDef[] }

const FALLBACK: PoStageSet = { system: SYSTEM_PO_STAGES, custom: [], fulfilment: FULFILMENT_STAGES };

export function usePoStages(): { stages: PoStageSet; reload: () => void } {
  const [stages, setStages] = useState<PoStageSet>(FALLBACK);
  const reload = useCallback(() => {
    fetch("/api/trade-documents/stages").then(r => r.json()).then(d => { if (d?.system) setStages(d); }).catch(() => {});
  }, []);
  useEffect(reload, [reload]);
  return { stages, reload };
}

export function findStage(stages: PoStageSet, key: string): PoStageDef {
  return [...stages.system, ...stages.custom, ...stages.fulfilment].find(s => s.key === key)
    ?? { key, label: key, color: "stone", locked: false };
}

export function PoStageChip({ stageKey, stages, className = "" }: { stageKey: string; stages: PoStageSet; className?: string }) {
  const s = findStage(stages, stageKey);
  if (isPoExceptionStage(stageKey)) {
    return (
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STAGE_CHIP_CLASSES[s.color] ?? STAGE_CHIP_CLASSES.stone} ${className}`}>
        {s.label}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1.5 text-[12px] text-stone-300 ${className}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${STAGE_COLOR_CLASSES[s.color]?.dot ?? "bg-stone-400"}`} />
      {s.label}
    </span>
  );
}
