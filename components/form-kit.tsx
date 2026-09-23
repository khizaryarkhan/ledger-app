"use client";

/**
 * Form kit — the shared field system for every entry form in the app
 * (New Document form + Receiving / Shipping / BOM / Products / MO drawers).
 *
 * Design goals (polished dark):
 *  - Inputs sit ON the surface (bg-stone-900 over a stone-950 panel) so fields
 *    read as distinct controls, not flat rectangles that vanish into the page.
 *  - One consistent field anatomy: micro-label → control → hint/error.
 *  - Real focus affordance (emerald ring), hover feedback, smooth transitions.
 *  - Line-item tables use "ghost" cell controls that read like a clean ledger:
 *    transparent until hovered/focused, so a grid of inputs stops looking boxy.
 *
 * These are the single source of truth — don't hand-roll input class strings in
 * feature components; compose from here so every form stays consistent.
 */

import { ReactNode, SelectHTMLAttributes, useEffect } from "react";
import { ChevronDown, X, Check, Loader } from "lucide-react";

// ── Typography ────────────────────────────────────────────────────────────
/**
 * The type system, measured from the customer portal (app/portal/[token]),
 * which is the most finished-looking surface in the product.
 *
 * The portal is inline-styled and LIGHT; the app is Tailwind and DARK, so its
 * colours cannot be copied across. What transfers is the typography — and it
 * turned out form-kit's controls already matched it (13px body, 11px uppercase
 * micro-label, 10px table head). The inconsistency everyone can see comes from
 * the ~2/3 of components that bypass form-kit and reach for Tailwind's named
 * sizes instead, so the same "body text" lands at 12px, 13px or 14px depending
 * on which screen you are looking at.
 *
 * Portal scale, by frequency:  13px (body, dominant) · 12px (secondary) ·
 * 11px (label) · 10px (micro) · 15/18/20px (headings)
 * Weights: 600 for emphasis, 700 for strong, 500 for quiet.
 * Uppercase + 0.07–0.08em tracking ONLY on 10–11px micro-labels.
 *
 * ONE deliberate deviation: the portal sets weight 700 on those micro-labels;
 * these use 600. The portal is dark-text-on-light, this app is light-text-on-
 * dark, and light type on a dark ground optically gains weight (halation) — so
 * 700 here reads heavier than 700 there. 600 reproduces the portal's intended
 * weight rather than its literal number.
 *
 * USE THESE INSTEAD OF text-sm / text-xs / text-base. Those are 14px and 12px
 * on a different rhythm and are what makes screens look unfinished next to
 * each other.
 */
export const t = {
  /** 20px — page title. Slight negative tracking, as the portal does on large text. */
  pageTitle:  "text-[20px] font-semibold tracking-[-0.01em] text-stone-100",
  /** 18px — section title inside a page. */
  title:      "text-[18px] font-semibold tracking-[-0.01em] text-stone-100",
  /** 15px — card / panel heading. */
  heading:    "text-[15px] font-semibold text-stone-100",
  /** 13px — body. The default for almost everything. */
  body:       "text-[13px] text-stone-200",
  /** 13px, 600 — body that needs emphasis (a name, a primary cell). */
  bodyStrong: "text-[13px] font-semibold text-stone-100",
  /** 12px — secondary text: dates, sub-labels, inline hints. */
  secondary:  "text-[12px] text-stone-400",
  /** 12px — quiet helper text under a field or beside a control. */
  hint:       "text-[12px] text-stone-500",
  /** 11px, 700, uppercase, wide — the micro-label. Matches `fieldLabel`. */
  label:      "text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-500",
  /** 10px, 700, uppercase, wide — table headers and the smallest captions. */
  micro:      "text-[10px] font-semibold uppercase tracking-[0.07em] text-stone-500",
} as const;

/**
 * The text-colour ramp, mapped from the portal's four greys so the app has the
 * same sense of hierarchy rather than picking a stone step per component.
 *   portal #111827 → strong · #374151 → body · #6B7280 → secondary
 *   #9CA3AF → muted · #D1D5DB → faint
 */
export const ink = {
  strong:    "text-stone-100",
  body:      "text-stone-200",
  secondary: "text-stone-400",
  muted:     "text-stone-500",
  faint:     "text-stone-600",
} as const;

/**
 * Numbers. The portal sets `fontVariantNumeric: tabular-nums` on every money
 * figure, which is why its columns line up and ours sometimes do not — with
 * proportional digits a column of amounts visibly ragged-edges.
 * Always right-align money; always use tabular figures.
 */
export const num = {
  /** Any quantity or amount in a table cell. */
  cell:     "text-[13px] tabular-nums text-stone-200 text-right",
  /** A money amount that carries weight (a total, a balance). */
  money:    "text-[13px] font-semibold tabular-nums text-stone-100 text-right",
  /** A total row / grand total. */
  total:    "text-[13px] font-bold tabular-nums text-stone-100 text-right",
  /** Money that is good news — paid, received, in credit. */
  positive: "text-[13px] font-semibold tabular-nums text-emerald-400 text-right",
  /** Money that needs attention — overdue, negative, a variance. */
  negative: "text-[13px] font-semibold tabular-nums text-rose-400 text-right",
  /** A zero or absent value: present, but not competing for attention. */
  zero:     "text-[13px] tabular-nums text-stone-600 text-right",
} as const;

/**
 * Identifiers — invoice numbers, lot codes, document numbers, SKUs.
 * The portal renders these monospace, which is what makes a column of
 * "INV-0012 / INV-0013" scannable instead of a wall of similar shapes.
 */
export const idText = "font-mono text-[12px] tracking-tight text-stone-300";

/**
 * Radius scale, from the portal: 5px inputs, 6px buttons, 8px cards. Tailwind's
 * nearest are rounded-md (6) and rounded-lg (8); `rounded-xl` and above are
 * deliberately absent — nothing in the portal is rounder than 8.
 */
export const radius = {
  control: "rounded-md",
  button:  "rounded-md",
  card:    "rounded-lg",
} as const;

// ── Control class tokens ──────────────────────────────────────────────────
/** Standard boxed control (text / number / date / native select). h-9 ≈ 36px. */
export const control =
  "w-full h-9 rounded-lg bg-stone-900 border border-stone-700/70 px-3 text-[13px] text-stone-100 " +
  "placeholder:text-stone-600 outline-none transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:border-stone-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";
/** Native <select> variant — hide the OS arrow (we draw our own chevron). */
export const controlSelect = control + " appearance-none pr-9 cursor-pointer";
/** Micro field label. Same values as `t.label` — kept as its own export
 *  because it adds the block/margin a <label> needs. */
export const fieldLabel = "block " + t.label + " mb-1.5";

/**
 * Inset variants — for surfaces that are already stone-900 (the side drawers).
 * Here the control sits BELOW the surface (bg-stone-950) so it still separates.
 */
export const controlInset =
  "w-full h-9 rounded-lg bg-stone-950 border border-stone-700/70 px-3 text-[13px] text-stone-100 " +
  "placeholder:text-stone-600 outline-none transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:border-stone-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";
export const controlSelectInset = controlInset + " appearance-none pr-9 cursor-pointer";

/**
 * Multi-line control (textarea). Same anatomy as `controlInset` but without the
 * fixed h-9, which would clip a textarea to one line. Split out rather than
 * left to callers to patch, because "controlInset + h-auto" was exactly the
 * kind of local tweak that grew into the competing class strings this kit
 * exists to replace.
 */
export const controlMultiline =
  "w-full min-h-[76px] rounded-md bg-stone-950 border border-stone-700/70 px-3 py-2 text-[13px] text-stone-100 " +
  "placeholder:text-stone-600 outline-none resize-y transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:border-stone-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 " +
  "disabled:opacity-50 disabled:cursor-not-allowed";

/**
 * Compact control for inline filters — the "As of <date>" and "Search…" boxes
 * that sit in a report header rather than in a form. h-8 instead of h-9 so the
 * row stays tight; everything else matches, so a filter still looks like it
 * belongs to the same product as the form below it.
 */
export const controlCompact =
  "h-8 rounded-md bg-stone-950 border border-stone-700/70 px-2.5 text-[13px] text-stone-100 " +
  "placeholder:text-stone-600 outline-none transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:border-stone-600 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20";

/** Compact control carrying a leading icon — adds room for it. */
export const controlCompactIcon = controlCompact + " pl-8";

/** Ghost table-cell control — chrome only on hover/focus, reads like a ledger. */
export const cell =
  "w-full h-8 rounded-md bg-transparent border border-transparent px-2 text-[13px] text-stone-100 " +
  "placeholder:text-stone-600 outline-none transition-[border-color,box-shadow,background-color] duration-150 " +
  "hover:bg-stone-900/70 hover:border-stone-700/70 focus:bg-stone-900 focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/15";
export const cellSelectCls = cell + " appearance-none pr-6 cursor-pointer";
/**
 * The header ROW of a table. Six variants of this existed across 31 tables —
 * 10px vs 11px, tracking-wider vs 0.07em, one with no divider at all — because
 * the type styling sits on the <tr> (a sound DRY choice: one declaration per
 * row rather than per cell) and nothing ever named it. The <th> cells below
 * carry only alignment and padding, which is why fixing this is 31 rows rather
 * than the 194 cells a first count suggested.
 */
export const tableHead = t.micro + " border-b border-stone-800";

/** Table header cell. Same values as `t.micro`, plus cell padding. */
export const th = "text-left " + t.micro + " px-2.5 py-2.5";

// ── Field wrapper: label → control → hint/error ───────────────────────────
export function Field({
  label, required, hint, error, htmlFor, className = "", children,
}: {
  label?: ReactNode; required?: boolean; hint?: ReactNode; error?: ReactNode;
  htmlFor?: string; className?: string; children: ReactNode;
}) {
  return (
    <div className={className}>
      {label != null && (
        <label htmlFor={htmlFor} className={fieldLabel}>
          {label}{required && <span className="text-emerald-500/80 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error != null ? (
        <p className="mt-1 text-[11px] text-rose-400">{error}</p>
      ) : hint != null ? (
        <p className="mt-1 text-[11px] text-stone-500">{hint}</p>
      ) : null}
    </div>
  );
}

// ── Native select with our own chevron (boxed variant) ────────────────────
export function SelectField({
  className = "", inset = false, children, ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { inset?: boolean; children: ReactNode }) {
  return (
    <div className="relative">
      <select className={`${inset ? controlSelectInset : controlSelect} ${className}`} {...props}>{children}</select>
      <ChevronDown size={14} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-500" />
    </div>
  );
}

// ── Quantity + unit in ONE control (inset) ────────────────────────────────
/**
 * "[ 500 | bucket ▾ ]" — a number and the unit it counts, drawn as one field.
 * Two separate controls side by side read as two unrelated inputs and each
 * gets squeezed; a quantity and its pack type are one fact. One border, one
 * focus ring (focus-within), a hairline between the halves. Inset variant,
 * for stone-900 drawer panels like the rest of `controlInset`.
 */
export function QtyUnitField({
  qty, onQty, unit, onUnit, options, unitPlaceholder = "Select…", qtyPlaceholder = "0", disabled, qtyLabel, unitLabel, variant = "inset", qtyWidth,
}: {
  qty: string; onQty: (v: string) => void; unit: string; onUnit: (v: string) => void;
  /** Plain strings, or { value, label } when the stored key differs from what is shown. */
  options: readonly (string | { value: string; label: string })[];
  unitPlaceholder?: string | null; qtyPlaceholder?: string; disabled?: boolean;
  qtyLabel?: string; unitLabel?: string;
  /** "inset" = drawer field (h-9); "cell" = line-item table cell (h-8, quieter). */
  variant?: "inset" | "cell";
  qtyWidth?: string;
}) {
  const isCell = variant === "cell";
  const shell = isCell
    ? "flex items-stretch w-full h-8 rounded-md bg-stone-950/60 border border-stone-700/60 overflow-hidden transition-[border-color,box-shadow] duration-150 hover:border-stone-600 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/15"
    : "flex items-stretch w-full h-9 rounded-lg bg-stone-950 border border-stone-700/70 overflow-hidden transition-[border-color,box-shadow] duration-150 hover:border-stone-600 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/20";
  const pad = isCell ? "px-2" : "px-3";
  return (
    <div className={`${shell} ${disabled ? "opacity-50" : ""}`}>
      <input type="number" step="any" min="0" value={qty} onChange={e => onQty(e.target.value)} placeholder={qtyPlaceholder} disabled={disabled} aria-label={qtyLabel}
        className={`${qtyWidth ?? (isCell ? "w-20" : "w-28")} shrink-0 bg-transparent ${pad} text-right tabular-nums text-[13px] text-stone-100 placeholder:text-stone-600 outline-none disabled:cursor-not-allowed`} />
      <span className="w-px my-1.5 bg-stone-700/70" />
      <div className="relative flex-1 min-w-0">
        <select value={unit} onChange={e => onUnit(e.target.value)} disabled={disabled} aria-label={unitLabel}
          className={`w-full h-full appearance-none bg-transparent pl-2 pr-7 ${isCell ? "text-[12px] text-stone-300" : "text-[13px] text-stone-100"} outline-none cursor-pointer disabled:cursor-not-allowed truncate`}>
          {unitPlaceholder != null && <option value="">{unitPlaceholder}</option>}
          {options.map(o => typeof o === "string"
            ? <option key={o} value={o}>{o}</option>
            : <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <ChevronDown size={isCell ? 12 : 14} className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-stone-500" />
      </div>
    </div>
  );
}

// ── Ghost cell select with a compact chevron (for line-item tables) ───────
export function CellSelect({
  className = "", children, ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { children: ReactNode }) {
  return (
    <div className="relative">
      <select className={`${cellSelectCls} ${className}`} {...props}>{children}</select>
      <ChevronDown size={12} className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-stone-600" />
    </div>
  );
}

// ── Titled section: groups related fields with a quiet heading ────────────
export function Section({
  title, desc, right, className = "", children,
}: {
  title?: ReactNode; desc?: ReactNode; right?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <section className={`space-y-3.5 ${className}`}>
      {(title != null || right != null) && (
        <div className="flex items-end justify-between gap-3">
          <div className="min-w-0">
            {title != null && <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-400">{title}</h3>}
            {desc != null && <p className="text-[11px] text-stone-500 mt-0.5">{desc}</p>}
          </div>
          {right != null && <div className="shrink-0">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

/** A quiet card surface to sit a section on (raises it off the panel). */
export function Panel({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`rounded-lg border border-stone-800/80 bg-stone-900/40 p-4 ${className}`}>
      {children}
    </div>
  );
}

// ── Side drawer ───────────────────────────────────────────────────────────
/**
 * THE way this app opens a form. A drawer, not a centred dialog.
 *
 * Why a drawer: the list you came from stays visible behind it, so you keep
 * your place; it is full height, so a long form has room; and the primary
 * action is PINNED under the scrolling body rather than floating at the end of
 * the content, where on a long form it ends up below the fold. That last point
 * is not a preference — it was a real defect on the Send Invoices dialog,
 * where "Send 228 invoices" sat off-screen.
 *
 * This was defined SEVEN times, once per console, before it lived here, and
 * the copies had already drifted: `wide` meant max-w-md in one file, max-w-lg
 * in another and max-w-2xl in a third, and exactly one of the seven had the
 * pinned footer. Import it; do not write an eighth.
 * `tests/architecture.test.ts` enforces that.
 *
 * The one thing that is NOT a drawer: a short yes/no confirmation with no form
 * in it ("Delete this?"). A three-line confirm in a full-height side panel is
 * worse than a centred box, and the drawer's whole justification — room for a
 * long form, a pinned action, context behind — buys it nothing.
 */
export function Drawer({
  title, subtitle, onClose, children, footer, wide, size, pad = true,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** Pinned under the scrolling body, so the primary action is never scrolled
   *  out of reach. Use it — that is the point of the drawer. */
  footer?: ReactNode;
  /** Legacy alias for size="lg". Prefer `size`. */
  wide?: boolean;
  size?: "md" | "lg" | "xl" | "2xl";
  /** Body padding, on by default. Set false when the caller's content brings
   *  its own padding — otherwise it is padded twice. */
  pad?: boolean;
}) {
  useEffect(() => {
    const on = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [onClose]);
  const s = size ?? (wide ? "lg" : "md");
  // "xl" is for grids — five columns of cells do not fit in 32rem. "2xl" is
  // for the few panels that are genuinely a table (a plan comparison, an
  // invoice list); anything wider stops being a side panel.
  const width = s === "2xl" ? "max-w-4xl" : s === "xl" ? "max-w-3xl" : s === "lg" ? "max-w-lg" : "max-w-md";
  return (
    <div className="fixed inset-0 z-50 flex justify-end" onMouseDown={onClose}>
      <div className="absolute inset-0 bg-black/50" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative bg-stone-900 border-l border-stone-800 h-full w-full ${width} shadow-2xl flex flex-col`}
        onMouseDown={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 py-4 border-b border-stone-800 shrink-0">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-stone-100 truncate">{title}</h2>
            {subtitle && <div className="text-[12px] text-stone-500 mt-0.5">{subtitle}</div>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg hover:bg-stone-800 text-stone-500 shrink-0"><X size={17} /></button>
        </div>
        <div className={`flex-1 overflow-y-auto${pad ? " p-5" : ""}`}>{children}</div>
        {footer && <div className="shrink-0 border-t border-stone-800 px-5 py-3 bg-stone-900">{footer}</div>}
      </div>
    </div>
  );
}

/** Standard Cancel + primary pair for `Drawer`'s `footer` slot. Carries no
 *  margins or top border of its own — the slot supplies both. */
export function DrawerFooter({
  saving, onClose, onSave, saveLabel = "Save", err, pendingMsg, saveDisabled, icon, extra,
}: {
  saving: boolean;
  onClose: () => void;
  onSave: () => void;
  saveLabel?: string;
  /** Shown beside the primary button, where the eye already is when it fails. */
  err?: string | null;
  /** Work already committed: the form is spent, so the only action is Done. */
  pendingMsg?: string;
  saveDisabled?: boolean;
  icon?: ReactNode;
  /** Left-aligned slot for a secondary action (Delete), kept away from the
   *  primary button so it cannot be hit by accident. */
  extra?: ReactNode;
}) {
  if (pendingMsg) {
    return (
      <div className="flex items-center gap-2">
        <p className="flex-1 text-[12px] text-stone-400 leading-snug">{pendingMsg}</p>
        <button onClick={onClose} className="text-[13px] font-semibold bg-stone-800 text-stone-200 rounded-lg px-4 py-2 hover:bg-stone-700">Done</button>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2">
      {extra}
      {err ? <p className="flex-1 text-[12px] text-rose-400 leading-snug">{err}</p> : <div className="flex-1" />}
      <button onClick={onClose} className="text-[13px] font-medium text-stone-300 px-3.5 py-2 rounded-lg hover:bg-stone-800">Cancel</button>
      <button onClick={onSave} disabled={saving || saveDisabled}
        className="flex items-center gap-1.5 text-[13px] font-semibold bg-emerald-600 text-white rounded-lg px-4 py-2 hover:bg-emerald-700 disabled:opacity-60 shrink-0">
        {saving ? <Loader size={14} className="animate-spin" /> : (icon ?? <Check size={14} />)} {saveLabel}
      </button>
    </div>
  );
}
