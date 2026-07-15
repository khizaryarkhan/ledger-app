/**
 * Receivable Composition — single source of truth for classifying open AR
 * into exactly one category each (so segments always sum to 100%).
 *
 * Used by:
 *   - Dashboard "Receivable Composition" widget (read-only drill-down)
 *   - Collections Board List view (click a segment → filters the board)
 *
 * Priority order matters: Array.find stops at the first match, so more
 * specific categories (legal, disputed, named escalation types) must come
 * before the generic ones (in collection, not yet due).
 */

export type CompDrillColor = "rose" | "amber" | "sky" | "stone" | "white";

export type CompItem = {
  escalationType: string | null | undefined;
  collectionStage: string | null | undefined;
  hasOpenDispute?: boolean | null;
  promiseDate?: string | null;
  overdueDays: number;
};

export type CompCategory = {
  key: string;
  label: string;
  bar: string; dot: string; text: string;
  drillColor: CompDrillColor;
  description: string;
  group: "workable" | "blocked" | "current";
  match: (i: CompItem) => boolean;
};

export const COMPOSITION_CATEGORIES: CompCategory[] = [
  {
    key: "legal", label: "Legal & Insolvency", bar: "bg-rose-800", dot: "bg-rose-800", text: "text-rose-400",
    drillColor: "rose", group: "blocked",
    description: "Escalated for legal review or insolvency risk — recovery uncertain, senior decision pending.",
    match: i => i.collectionStage === "Escalated" && ["Legal Review", "Insolvency Risk"].includes(i.escalationType ?? ""),
  },
  {
    key: "disputed", label: "Disputed", bar: "bg-rose-500", dot: "bg-rose-500", text: "text-rose-400",
    drillColor: "rose", group: "blocked",
    description: "Customer contests the amount or the work — blocked until the dispute is resolved.",
    match: i => !!i.hasOpenDispute || i.collectionStage === "Disputed" || (i.collectionStage === "Escalated" && i.escalationType === "Disputed"),
  },
  {
    key: "finalAccount", label: "Final Account", bar: "bg-violet-500", dot: "bg-violet-500", text: "text-violet-400",
    drillColor: "amber", group: "blocked",
    description: "Payment blocked until the final account is agreed — commercial negotiation, not collection.",
    match: i => i.collectionStage === "Escalated" && i.escalationType === "Final Account Agreement",
  },
  {
    key: "retention", label: "Retention", bar: "bg-teal-500", dot: "bg-teal-500", text: "text-teal-400",
    drillColor: "sky", group: "blocked",
    description: "Retention money awaiting certification or practical-completion sign-off.",
    match: i => i.collectionStage === "Escalated" && i.escalationType === "Retention Release",
  },
  {
    key: "forwardInvoicing", label: "Forward Invoicing", bar: "bg-blue-500", dot: "bg-blue-500", text: "text-blue-400",
    drillColor: "sky", group: "workable",
    description: "Being resolved commercially through ongoing/future work with the customer.",
    match: i => i.collectionStage === "Escalated" && i.escalationType === "Forward Invoicing",
  },
  {
    key: "handedOver", label: "Handed Over", bar: "bg-fuchsia-500", dot: "bg-fuchsia-500", text: "text-fuchsia-400",
    drillColor: "amber", group: "workable",
    description: "General handover — a senior team member or director has taken over the chase.",
    match: i => i.collectionStage === "Escalated" && i.escalationType === "Handed Over",
  },
  {
    key: "certification", label: "Certification Pending", bar: "bg-cyan-500", dot: "bg-cyan-500", text: "text-cyan-400",
    drillColor: "sky", group: "blocked",
    description: "Awaiting a QS/engineer valuation or payment certificate before it can be paid.",
    match: i => i.collectionStage === "Escalated" && i.escalationType === "Certification Pending",
  },
  {
    key: "paymentPlan", label: "Payment Plan", bar: "bg-indigo-500", dot: "bg-indigo-500", text: "text-indigo-400",
    drillColor: "sky", group: "blocked",
    description: "Customer asked to pay in instalments — terms need senior approval.",
    match: i => i.collectionStage === "Escalated" && i.escalationType === "Payment Plan",
  },
  {
    key: "escalatedOtherType", label: "Escalated — Other", bar: "bg-orange-600", dot: "bg-orange-600", text: "text-orange-400",
    drillColor: "amber", group: "blocked",
    description: "Escalated for a reason not covered by the standard list — see the note on each invoice for detail.",
    match: i => i.collectionStage === "Escalated" && i.escalationType === "Other",
  },
  {
    // Only invoices with NO sub-type chosen land here — never invoices where
    // the rep explicitly picked "Other" (that's escalatedOtherType above).
    key: "escalatedUntyped", label: "Escalated — Untyped", bar: "bg-stone-500", dot: "bg-stone-500", text: "text-stone-400",
    drillColor: "amber", group: "blocked",
    description: "Escalated before an escalation type was chosen — open each invoice and set a type so it's classified correctly here.",
    match: i => i.collectionStage === "Escalated" && !i.escalationType,
  },
  {
    key: "committed", label: "Committed", bar: "bg-sky-400", dot: "bg-sky-400", text: "text-sky-400",
    drillColor: "sky", group: "workable",
    description: "Customer has committed to a payment date — monitoring, not chasing.",
    match: i => !!i.promiseDate,
  },
  {
    key: "inCollection", label: "In Collection", bar: "bg-amber-400", dot: "bg-amber-400", text: "text-amber-400",
    drillColor: "amber", group: "workable",
    description: "Overdue and being actively chased — the collection team's working queue.",
    match: i => i.overdueDays > 0,
  },
  {
    key: "current", label: "Not Yet Due", bar: "bg-emerald-500", dot: "bg-emerald-500", text: "text-emerald-400",
    drillColor: "white", group: "current",
    description: "Within payment terms — no action needed yet.",
    match: () => true,
  },
];

export function classifyComposition<T extends CompItem>(items: (T & { amount: number })[]) {
  const groups = COMPOSITION_CATEGORIES.map(c => ({ ...c, amount: 0, count: 0, items: [] as (T & { amount: number })[] }));
  const total = items.reduce((s, it) => s + it.amount, 0);

  for (const it of items) {
    const g = groups.find(c => c.match(it))!; // "current" always matches
    g.amount += it.amount;
    g.count  += 1;
    g.items.push(it);
  }

  const active = groups.filter(g => g.amount > 0);
  const blockedParts  = active.filter(g => g.group === "blocked");
  const workableParts = active.filter(g => g.group === "workable");
  const blocked  = blockedParts.reduce((s, g) => s + g.amount, 0);
  const workable = workableParts.reduce((s, g) => s + g.amount, 0);
  const currentAmount = groups.find(g => g.key === "current")?.amount ?? 0;

  return { total, groups: active, blocked, workable, blockedParts, workableParts, currentAmount };
}
