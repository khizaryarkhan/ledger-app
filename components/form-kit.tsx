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

import { ReactNode, SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

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
