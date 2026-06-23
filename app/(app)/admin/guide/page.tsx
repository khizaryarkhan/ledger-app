"use client";

import { useEffect, useState, useCallback } from "react";
import {
  GuideLayout, GUIDE_ICON_NAMES, type GuideContent, type GuideSection, type GuideBlock,
} from "@/components/guide";
import { DEFAULT_GUIDES } from "@/lib/guide-content";
import {
  Plus, Trash2, ChevronUp, ChevronDown, Save, Eye, EyeOff, RotateCcw, Loader,
  GripVertical, Image as ImageIcon,
} from "lucide-react";

type Key = "customer" | "admin";

const slug = (s: string) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";

const inp = "w-full px-3 py-2 text-[13px] rounded-md bg-stone-800 border border-stone-700 text-stone-200 placeholder-stone-600 focus:outline-none focus:border-emerald-500";
const lbl = "text-[10px] font-semibold text-stone-500 uppercase tracking-wider block mb-1";

const BLOCK_TYPES: { type: GuideBlock["type"]; label: string }[] = [
  { type: "p", label: "Paragraph" },
  { type: "subhead", label: "Sub-heading" },
  { type: "steps", label: "Numbered steps" },
  { type: "bullets", label: "Bullet list" },
  { type: "callout", label: "Callout box" },
  { type: "figure", label: "Screenshot" },
];

function blankBlock(type: GuideBlock["type"]): GuideBlock {
  switch (type) {
    case "p": return { type: "p", text: "" };
    case "subhead": return { type: "subhead", text: "" };
    case "steps": return { type: "steps", items: [""] };
    case "bullets": return { type: "bullets", items: [""] };
    case "callout": return { type: "callout", tone: "tip", text: "" };
    case "figure": return { type: "figure", title: "", where: "", caption: "", image: "" };
  }
}

export default function AdminGuideEditor() {
  const [key, setKey] = useState<Key>("customer");
  const [guide, setGuide] = useState<GuideContent>(DEFAULT_GUIDES.customer);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState(true);
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [source, setSource] = useState<"db" | "default">("default");

  const load = useCallback((k: Key) => {
    setLoading(true);
    fetch(`/api/admin/guide/${k}`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (d?.sections) { setGuide({ title: d.title, subtitle: d.subtitle, sections: d.sections }); setSource(d._source === "db" ? "db" : "default"); }
        else setGuide(DEFAULT_GUIDES[k]);
      })
      .catch(() => setGuide(DEFAULT_GUIDES[k]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(key); }, [key, load]);

  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 3500); return () => clearTimeout(t); } }, [toast]);

  // ── Immutable updaters ──
  const patch = (p: Partial<GuideContent>) => setGuide(g => ({ ...g, ...p }));
  const setSections = (fn: (s: GuideSection[]) => GuideSection[]) => setGuide(g => ({ ...g, sections: fn(g.sections) }));
  const updateSection = (i: number, p: Partial<GuideSection>) =>
    setSections(s => s.map((sec, j) => (j === i ? { ...sec, ...p } : sec)));
  const moveSection = (i: number, dir: -1 | 1) =>
    setSections(s => { const a = [...s]; const j = i + dir; if (j < 0 || j >= a.length) return s; [a[i], a[j]] = [a[j], a[i]]; return a; });
  const addSection = () =>
    setSections(s => [...s, { id: `section-${s.length + 1}`, title: "New section", icon: "BookOpen", intro: "", blocks: [] }]);
  const delSection = (i: number) => setSections(s => s.filter((_, j) => j !== i));

  const setBlocks = (si: number, fn: (b: GuideBlock[]) => GuideBlock[]) =>
    updateSection(si, { blocks: fn(guide.sections[si].blocks) });
  const updateBlock = (si: number, bi: number, b: GuideBlock) =>
    setSections(s => s.map((sec, j) => j === si ? { ...sec, blocks: sec.blocks.map((bl, k) => k === bi ? b : bl) } : sec));
  const moveBlock = (si: number, bi: number, dir: -1 | 1) =>
    setBlocks(si, b => { const a = [...b]; const j = bi + dir; if (j < 0 || j >= a.length) return b; [a[bi], a[j]] = [a[j], a[bi]]; return a; });
  const addBlock = (si: number, type: GuideBlock["type"]) => setBlocks(si, b => [...b, blankBlock(type)]);
  const delBlock = (si: number, bi: number) => setBlocks(si, b => b.filter((_, j) => j !== bi));

  const save = async () => {
    setSaving(true);
    // Ensure section ids are present & unique-ish (anchors).
    const seen = new Set<string>();
    const sections = guide.sections.map(s => {
      let id = (s.id && s.id.trim()) || slug(s.title);
      while (seen.has(id)) id = `${id}-x`;
      seen.add(id);
      return { ...s, id };
    });
    try {
      const r = await fetch(`/api/admin/guide/${key}`, {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: guide.title, subtitle: guide.subtitle, sections }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) { setToast({ ok: true, msg: "Guide saved" }); setSource("db"); setGuide(g => ({ ...g, sections })); }
      else setToast({ ok: false, msg: d.error ?? "Save failed" });
    } catch {
      setToast({ ok: false, msg: "Save failed" });
    } finally { setSaving(false); }
  };

  const resetToDefault = () => {
    if (!confirm("Replace the editor contents with the built-in default? You'll still need to Save to apply it.")) return;
    setGuide(DEFAULT_GUIDES[key]);
  };

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
        <div>
          <h1 className="text-xl font-bold text-white">Guide editor</h1>
          <p className="text-xs text-stone-500 mt-0.5">Edit the in-app help. Changes go live for everyone as soon as you save.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setPreview(p => !p)}
            className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 transition-colors">
            {preview ? <EyeOff size={14} /> : <Eye size={14} />} {preview ? "Hide preview" : "Show preview"}
          </button>
          <button onClick={resetToDefault}
            className="flex items-center gap-1.5 h-9 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-400 hover:bg-stone-800 transition-colors">
            <RotateCcw size={14} /> Reset to default
          </button>
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-stone-700 text-white transition-colors">
            {saving ? <Loader size={14} className="animate-spin" /> : <Save size={14} />} Save
          </button>
        </div>
      </div>

      {/* Guide selector */}
      <div className="flex items-center gap-2 mb-4">
        {(["customer", "admin"] as Key[]).map(k => (
          <button key={k} onClick={() => setKey(k)}
            className={`h-8 px-3.5 text-xs font-medium rounded-lg transition-colors ${
              key === k ? "bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40" : "text-stone-400 hover:bg-stone-800"}`}>
            {k === "customer" ? "Customer app guide" : "Admin & sales guide"}
          </button>
        ))}
        {source === "default" && (
          <span className="text-[11px] text-amber-400 ml-2">Showing built-in default — Save to make it editable.</span>
        )}
      </div>

      {loading ? (
        <div className="h-64 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : (
        <div className={`grid gap-5 ${preview ? "lg:grid-cols-2" : "grid-cols-1"}`}>
          {/* ── Editor pane ── */}
          <div className="space-y-4 min-w-0">
            {/* Guide meta */}
            <div className="rounded-xl border border-stone-800 bg-stone-900/40 p-4 space-y-3">
              <div><label className={lbl}>Guide title</label>
                <input className={inp} value={guide.title} onChange={e => patch({ title: e.target.value })} /></div>
              <div><label className={lbl}>Subtitle</label>
                <textarea className={inp} rows={2} value={guide.subtitle} onChange={e => patch({ subtitle: e.target.value })} /></div>
            </div>

            {guide.sections.map((sec, si) => (
              <div key={si} className="rounded-xl border border-stone-800 bg-stone-900/40">
                {/* Section header */}
                <div className="flex items-center gap-2 px-3 py-2 border-b border-stone-800">
                  <GripVertical size={14} className="text-stone-600" />
                  <span className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Section {si + 1}</span>
                  <span className="flex-1" />
                  <button onClick={() => moveSection(si, -1)} disabled={si === 0} className="p-1 rounded hover:bg-stone-800 text-stone-500 disabled:opacity-30"><ChevronUp size={14} /></button>
                  <button onClick={() => moveSection(si, 1)} disabled={si === guide.sections.length - 1} className="p-1 rounded hover:bg-stone-800 text-stone-500 disabled:opacity-30"><ChevronDown size={14} /></button>
                  <button onClick={() => delSection(si)} className="p-1 rounded hover:bg-rose-500/15 text-stone-500 hover:text-rose-400"><Trash2 size={14} /></button>
                </div>

                <div className="p-3 space-y-3">
                  <div className="grid grid-cols-[1fr_auto] gap-2">
                    <div><label className={lbl}>Title</label>
                      <input className={inp} value={sec.title} onChange={e => updateSection(si, { title: e.target.value })} /></div>
                    <div><label className={lbl}>Icon</label>
                      <select className={`${inp} w-36`} value={sec.icon ?? ""} onChange={e => updateSection(si, { icon: e.target.value })}>
                        <option value="">None</option>
                        {GUIDE_ICON_NAMES.map(n => <option key={n} value={n}>{n}</option>)}
                      </select></div>
                  </div>
                  <div><label className={lbl}>Anchor id <span className="text-stone-600 normal-case">(URL #link; auto from title if blank)</span></label>
                    <input className={inp} value={sec.id} onChange={e => updateSection(si, { id: e.target.value })} placeholder={slug(sec.title)} /></div>
                  <div><label className={lbl}>Intro</label>
                    <textarea className={inp} rows={2} value={sec.intro ?? ""} onChange={e => updateSection(si, { intro: e.target.value })} /></div>

                  {/* Blocks */}
                  <div className="space-y-2">
                    {sec.blocks.map((b, bi) => (
                      <BlockEditor key={bi} block={b}
                        onChange={nb => updateBlock(si, bi, nb)}
                        onUp={() => moveBlock(si, bi, -1)} onDown={() => moveBlock(si, bi, 1)}
                        onDelete={() => delBlock(si, bi)}
                        first={bi === 0} last={bi === sec.blocks.length - 1} />
                    ))}
                  </div>

                  {/* Add block */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <span className="text-[11px] text-stone-500">Add:</span>
                    {BLOCK_TYPES.map(bt => (
                      <button key={bt.type} onClick={() => addBlock(si, bt.type)}
                        className="text-[11px] px-2 py-1 rounded border border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-500 transition-colors">
                        + {bt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ))}

            <button onClick={addSection}
              className="w-full flex items-center justify-center gap-2 h-10 text-xs font-medium rounded-xl border border-dashed border-stone-700 text-stone-400 hover:text-stone-200 hover:border-stone-500 transition-colors">
              <Plus size={15} /> Add section
            </button>
          </div>

          {/* ── Preview pane ── */}
          {preview && (
            <div className="min-w-0 rounded-xl border border-stone-800 bg-stone-950 overflow-hidden">
              <div className="px-3 py-2 border-b border-stone-800 text-[10px] font-semibold text-stone-500 uppercase tracking-wider">Live preview</div>
              <div className="overflow-y-auto max-h-[calc(100vh-180px)]">
                <GuideLayout title={guide.title} subtitle={guide.subtitle} sections={guide.sections} />
              </div>
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className={`fixed bottom-5 right-5 z-50 px-4 py-2.5 rounded-lg text-sm font-medium shadow-xl ${
          toast.ok ? "bg-emerald-600 text-white" : "bg-rose-600 text-white"}`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ── Per-block editor ──────────────────────────────────────────────────────────
function BlockEditor({ block, onChange, onUp, onDown, onDelete, first, last }: {
  block: GuideBlock; onChange: (b: GuideBlock) => void;
  onUp: () => void; onDown: () => void; onDelete: () => void; first: boolean; last: boolean;
}) {
  const typeLabel = BLOCK_TYPES.find(t => t.type === block.type)?.label ?? block.type;
  const setItems = (items: string[]) => onChange({ ...block, items } as GuideBlock);

  return (
    <div className="rounded-lg border border-stone-800 bg-stone-900/60 p-2.5">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="text-[10px] font-semibold text-emerald-400/80 uppercase tracking-wider">{typeLabel}</span>
        <span className="flex-1" />
        <button onClick={onUp} disabled={first} className="p-0.5 rounded hover:bg-stone-800 text-stone-500 disabled:opacity-30"><ChevronUp size={12} /></button>
        <button onClick={onDown} disabled={last} className="p-0.5 rounded hover:bg-stone-800 text-stone-500 disabled:opacity-30"><ChevronDown size={12} /></button>
        <button onClick={onDelete} className="p-0.5 rounded hover:bg-rose-500/15 text-stone-500 hover:text-rose-400"><Trash2 size={12} /></button>
      </div>

      {(block.type === "p" || block.type === "subhead") && (
        <textarea className={inp} rows={block.type === "p" ? 3 : 1}
          placeholder={block.type === "subhead" ? "Sub-heading text" : "Paragraph text (HTML like <b>bold</b> allowed)"}
          value={block.text} onChange={e => onChange({ ...block, text: e.target.value })} />
      )}

      {block.type === "callout" && (
        <div className="space-y-2">
          <select className={inp} value={block.tone ?? "tip"} onChange={e => onChange({ ...block, tone: e.target.value as any })}>
            <option value="tip">Tip (green)</option>
            <option value="warn">Important (amber)</option>
            <option value="info">Note (blue)</option>
          </select>
          <textarea className={inp} rows={2} placeholder="Callout text" value={block.text} onChange={e => onChange({ ...block, text: e.target.value })} />
        </div>
      )}

      {(block.type === "steps" || block.type === "bullets") && (
        <div className="space-y-1.5">
          {block.items.map((it, i) => (
            <div key={i} className="flex gap-1.5">
              <textarea className={inp} rows={1} value={it}
                onChange={e => setItems(block.items.map((x, j) => (j === i ? e.target.value : x)))} />
              <button onClick={() => setItems(block.items.filter((_, j) => j !== i))}
                className="shrink-0 p-1.5 rounded hover:bg-rose-500/15 text-stone-500 hover:text-rose-400"><Trash2 size={12} /></button>
            </div>
          ))}
          <button onClick={() => setItems([...block.items, ""])}
            className="text-[11px] px-2 py-1 rounded border border-stone-700 text-stone-400 hover:text-stone-200">+ Add item</button>
        </div>
      )}

      {block.type === "figure" && (
        <div className="space-y-2">
          <div><label className={lbl}>Title</label>
            <input className={inp} value={block.title} onChange={e => onChange({ ...block, title: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className={lbl}>Capture hint (screen/URL)</label>
              <input className={inp} value={block.where ?? ""} onChange={e => onChange({ ...block, where: e.target.value })} placeholder="/dashboard" /></div>
            <div><label className={lbl}>Caption</label>
              <input className={inp} value={block.caption ?? ""} onChange={e => onChange({ ...block, caption: e.target.value })} /></div>
          </div>
          <div><label className={lbl}>Image URL <span className="text-stone-600 normal-case">(https… — leave blank to show a placeholder)</span></label>
            <div className="flex items-center gap-2">
              <input className={inp} value={block.image ?? ""} onChange={e => onChange({ ...block, image: e.target.value })} placeholder="https://…/screenshot.png" />
              {block.image
                ? // eslint-disable-next-line @next/next/no-img-element
                  <img src={block.image} alt="" className="w-12 h-10 object-cover rounded border border-stone-700" />
                : <span className="shrink-0 w-12 h-10 rounded border border-dashed border-stone-700 flex items-center justify-center text-stone-600"><ImageIcon size={14} /></span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
