"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card } from "@/components/ui";
import { ArrowLeft, Eye, EyeOff, Save, Info } from "lucide-react";
import { DEFAULT_STAGES, Stage, STAGE_COLOR_CLASSES, COLOR_OPTIONS } from "@/lib/stages";

export default function StagesSettingsPage() {
  const { orgSettings, refresh, toast } = useData() as any;
  const [stages, setStages] = useState<Stage[]>([]);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Initialise from orgSettings once loaded
  useEffect(() => {
    const src: Stage[] = (orgSettings?.stages?.length ? orgSettings.stages : DEFAULT_STAGES);
    setStages(src.map(s => ({ ...s })));
    setDirty(false);
  }, [orgSettings]);

  const update = (key: string, field: keyof Stage, value: any) => {
    setStages(prev => prev.map(s => {
      if (s.key !== key) {
        // Enforce single default / single closed
        if (field === "isDefault" && value === true) return { ...s, isDefault: false };
        if (field === "isClosed"  && value === true) return { ...s, isClosed: false };
        return s;
      }
      return { ...s, [field]: value };
    }));
    setDirty(true);
  };

  const handleSave = async () => {
    // Validate
    if (stages.filter(s => s.isDefault).length !== 1) { toast("Exactly one stage must be set as Default", "error"); return; }
    if (stages.filter(s => s.isClosed).length  !== 1) { toast("Exactly one stage must be set as Closed", "error"); return; }
    if (stages.some(s => !s.label.trim()))             { toast("All stages must have a label", "error"); return; }

    setSaving(true);
    try {
      const res = await fetch("/api/org/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stages }),
      });
      if (!res.ok) { const d = await res.json(); throw new Error(d.error ?? "Failed"); }
      await refresh();
      setDirty(false);
      toast("Stages saved");
    } catch (e: any) {
      toast(e.message ?? "Failed to save stages", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-[760px] mx-auto">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-sm text-stone-500 hover:text-stone-900 mb-5">
        <ArrowLeft size={14} /> Back to Settings
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Collection Stages</h1>
          <p className="text-sm text-stone-500 mt-1">
            Rename stages, change colours, and hide columns you don't use from the board.
          </p>
        </div>
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="flex items-center gap-2 px-4 py-2 bg-stone-900 text-white text-sm font-medium rounded-lg hover:bg-stone-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          <Save size={14} />
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>

      {/* Info banner */}
      <div className="flex items-start gap-2.5 px-4 py-3 bg-blue-50 ring-1 ring-blue-200 rounded-lg mb-5 text-[12px] text-blue-800">
        <Info size={13} className="mt-0.5 shrink-0 text-blue-600" />
        <span>
          Renaming a stage automatically updates all invoices using that stage — no data is lost.
          The <strong>structure</strong> (number of slots) is fixed; you can rename, recolour, and show/hide each one.
          One stage must be set as <strong>Default</strong> (where new invoices land) and one as <strong>Closed</strong>.
        </span>
      </div>

      <Card padding="none">
        {/* Header */}
        <div className="grid grid-cols-[28px_1fr_160px_80px_70px_70px] gap-3 px-4 py-2.5 border-b border-stone-200 bg-stone-50">
          <div />
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Stage Label</div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider">Colour</div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-center">Default</div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-center">Closed</div>
          <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider text-center">Visible</div>
        </div>

        {stages.map((stage, i) => {
          const cls = STAGE_COLOR_CLASSES[stage.color] ?? STAGE_COLOR_CLASSES.stone;
          return (
            <div
              key={stage.key}
              className={`grid grid-cols-[28px_1fr_160px_80px_70px_70px] gap-3 items-center px-4 py-3 border-b border-stone-100 last:border-0 ${!stage.visible ? "opacity-50" : ""}`}
            >
              {/* Row number */}
              <div className="text-[11px] text-stone-400 tabular-nums text-center">{i + 1}</div>

              {/* Label input */}
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cls.dot}`} />
                <input
                  type="text"
                  value={stage.label}
                  maxLength={40}
                  onChange={(e) => update(stage.key, "label", e.target.value)}
                  className="flex-1 h-8 px-2.5 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none bg-white"
                />
              </div>

              {/* Colour picker */}
              <div className="flex items-center gap-1 flex-wrap">
                {COLOR_OPTIONS.map(c => {
                  const cc = STAGE_COLOR_CLASSES[c];
                  return (
                    <button
                      key={c}
                      onClick={() => update(stage.key, "color", c)}
                      title={c}
                      className={`w-5 h-5 rounded-full transition-all ${cc.dot} ${stage.color === c ? "ring-2 ring-offset-1 ring-stone-700 scale-110" : "hover:scale-110"}`}
                    />
                  );
                })}
              </div>

              {/* Default radio */}
              <div className="flex items-center justify-center">
                <button
                  onClick={() => update(stage.key, "isDefault", true)}
                  className={`w-4 h-4 rounded-full border-2 transition-colors ${stage.isDefault ? "border-stone-900 bg-stone-900" : "border-stone-300 hover:border-stone-500"}`}
                >
                  {stage.isDefault && <span className="block w-1.5 h-1.5 bg-white rounded-full mx-auto" />}
                </button>
              </div>

              {/* Closed checkbox */}
              <div className="flex items-center justify-center">
                <button
                  onClick={() => update(stage.key, "isClosed", !stage.isClosed)}
                  className={`w-4 h-4 rounded border-2 transition-colors flex items-center justify-center ${stage.isClosed ? "border-stone-900 bg-stone-900" : "border-stone-300 hover:border-stone-500"}`}
                >
                  {stage.isClosed && (
                    <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
                      <path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </button>
              </div>

              {/* Visible toggle */}
              <div className="flex items-center justify-center">
                <button
                  onClick={() => update(stage.key, "visible", !stage.visible)}
                  title={stage.visible ? "Hide from board" : "Show on board"}
                  className="text-stone-400 hover:text-stone-700 transition-colors"
                >
                  {stage.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                </button>
              </div>
            </div>
          );
        })}
      </Card>

      {/* Legend */}
      <div className="flex items-center gap-6 mt-4 text-[11px] text-stone-400 px-1">
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded-full border-2 border-stone-900 bg-stone-900 flex items-center justify-center">
            <span className="block w-1 h-1 bg-white rounded-full" />
          </div>
          Default — new invoices start here
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3.5 h-3.5 rounded border-2 border-stone-900 bg-stone-900 flex items-center justify-center">
            <svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M1 4l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </div>
          Closed — end of lifecycle
        </div>
        <div className="flex items-center gap-1.5">
          <Eye size={13} />
          Visible — shows as column on board
        </div>
      </div>
    </div>
  );
}
