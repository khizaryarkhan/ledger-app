// ─────────────────────────────────────────────────────────────────────────────
// Stage definitions — shared between API, DataProvider, and UI
// ─────────────────────────────────────────────────────────────────────────────

export interface Stage {
  key: string;        // immutable internal key (= original label on creation)
  label: string;      // display name — org can rename this
  color: string;      // tailwind color name: stone|blue|violet|rose|amber|orange|emerald|cyan|purple|pink
  isDefault: boolean; // new invoices land here (only one per org)
  isClosed: boolean;  // end-of-lifecycle stage (only one per org)
  visible: boolean;   // show as a column on the board
}

export const DEFAULT_STAGES: Stage[] = [
  { key: "New",           label: "New",           color: "stone",   isDefault: true,  isClosed: false, visible: true },
  { key: "Scheduled",     label: "Scheduled",     color: "blue",    isDefault: false, isClosed: false, visible: true },
  { key: "Reminder Sent", label: "Reminder Sent", color: "blue",    isDefault: false, isClosed: false, visible: true },
  { key: "Second Notice", label: "Second Notice", color: "violet",  isDefault: false, isClosed: false, visible: true },
  { key: "Final Notice",  label: "Final Notice",  color: "violet",  isDefault: false, isClosed: false, visible: true },
  { key: "Awaiting",      label: "Awaiting",      color: "amber",   isDefault: false, isClosed: false, visible: true },
  { key: "Promised",      label: "Promised",      color: "amber",   isDefault: false, isClosed: false, visible: true },
  { key: "Disputed",      label: "Disputed",      color: "rose",    isDefault: false, isClosed: false, visible: true },
  { key: "Escalated",     label: "Escalated",     color: "rose",    isDefault: false, isClosed: false, visible: true },
  { key: "On Hold",       label: "On Hold",       color: "orange",  isDefault: false, isClosed: false, visible: true },
  { key: "Closed",        label: "Closed",        color: "emerald", isDefault: false, isClosed: true,  visible: true },
];

// Tailwind classes per color
export const STAGE_COLOR_CLASSES: Record<string, { badge: string; dot: string; bg: string }> = {
  stone:   { badge: "bg-stone-100 text-stone-700",   dot: "bg-stone-400",   bg: "bg-stone-50"   },
  blue:    { badge: "bg-blue-100 text-blue-700",     dot: "bg-blue-500",    bg: "bg-blue-50"    },
  violet:  { badge: "bg-violet-100 text-violet-700", dot: "bg-violet-500",  bg: "bg-violet-50"  },
  rose:    { badge: "bg-rose-100 text-rose-700",     dot: "bg-rose-500",    bg: "bg-rose-50"    },
  amber:   { badge: "bg-amber-100 text-amber-700",   dot: "bg-amber-500",   bg: "bg-amber-50"   },
  orange:  { badge: "bg-orange-100 text-orange-700", dot: "bg-orange-500",  bg: "bg-orange-50"  },
  emerald: { badge: "bg-emerald-100 text-emerald-700", dot: "bg-emerald-500", bg: "bg-emerald-50" },
  cyan:    { badge: "bg-cyan-100 text-cyan-700",     dot: "bg-cyan-500",    bg: "bg-cyan-50"    },
  purple:  { badge: "bg-purple-100 text-purple-700", dot: "bg-purple-500",  bg: "bg-purple-50"  },
  pink:    { badge: "bg-pink-100 text-pink-700",     dot: "bg-pink-500",    bg: "bg-pink-50"    },
};

export const COLOR_OPTIONS = ["stone", "blue", "violet", "rose", "amber", "orange", "emerald", "cyan", "purple", "pink"];

/** Resolve a collectionStage DB value to the current label using org stages */
export function resolveStageLabel(value: string | null | undefined, stages: Stage[]): string {
  if (!value) return stages.find(s => s.isDefault)?.label ?? "New";
  // Exact label match (most common — post-rename invoices)
  if (stages.find(s => s.label === value)) return value;
  // Key match (pre-rename invoices)
  const byKey = stages.find(s => s.key === value);
  if (byKey) return byKey.label;
  // Legacy label mappings for old DB values
  const LEGACY: Record<string, string> = {
    "Reminder Scheduled": "Scheduled",
    "Awaiting Reply":     "Awaiting",
    "Promise to Pay":     "Promised",
  };
  const legacyKey = LEGACY[value];
  if (legacyKey) {
    const s = stages.find(st => st.key === legacyKey || st.label === legacyKey);
    if (s) return s.label;
  }
  return value;
}
