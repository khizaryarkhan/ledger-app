/**
 * Workspace queue — the Collections Board arranged as "who do I deal with
 * today", one card per customer. Pure: it only re-reads what the Board already
 * knows, using the SAME next-action ladder (lib/next-action.ts), so the
 * Workspace can never disagree with the List view about what an invoice needs.
 *
 * Sections:
 *   now   — something needs a person today (best invoice rank >= NOW_RANK)
 *   done  — chased today; nothing more to do until the wake date
 *   wait  — waiting on the customer or an owner (has a wake date where known)
 *   idle  — nothing due yet
 *
 * Dates are YYYY-MM-DD strings compared as strings ("A date is a date").
 */
import { computeNextAction, NA_CADENCE_DAYS, type NextAction } from "@/lib/next-action";

export const WORKSPACE_NOW_RANK = 55;

export type WorkspaceInvoice = {
  id: string;
  custId: string;
  custName: string;
  projName: string | null;
  invoiceNumber: string;
  bal: number;
  currency: string;
  days: number;                    // days overdue (>0 = overdue)
  dueDate: string | null;          // YYYY-MM-DD
  email: string | null;
  stageLabel: string;
  promiseDate: string | null;
  hasOpenDispute: boolean;
  escalatedToName: string | null;
  lastChaseDay: string | null;     // YYYY-MM-DD, viewer's local day of last outbound email/chase
  daysSinceChase: number | null;
  chaseCount: number;
  unreadReply: boolean;
};

export type WorkspaceSection = "now" | "done" | "wait" | "idle";

export type WorkspaceItem = { inv: WorkspaceInvoice; action: NextAction };

export type WakeInfo = {
  date: string | null;             // when it comes back, null when someone else drives it
  why: string;
  pct?: number;                    // progress through the wait, 4..100
};

export type WorkspaceCustomer = {
  custId: string;
  name: string;
  section: WorkspaceSection;
  rank: number;
  items: WorkspaceItem[];          // most urgent first
  total: Record<string, number>;   // per currency, never added across currencies
  top: NextAction;
  wake: WakeInfo | null;
};

export function addDaysYmd(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return `${String(t.getUTCFullYear()).padStart(4, "0")}-${String(t.getUTCMonth() + 1).padStart(2, "0")}-${String(t.getUTCDate()).padStart(2, "0")}`;
}

export function diffDaysYmd(a: string, b: string): number {
  const p = (s: string) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((p(a) - p(b)) / 86_400_000);
}

export function actionFor(inv: WorkspaceInvoice, today: string): NextAction {
  return computeNextAction({
    days: inv.days,
    email: inv.email,
    promiseDate: inv.promiseDate,
    hasOpenDispute: inv.hasOpenDispute,
    stageLabel: inv.stageLabel,
    escalatedToName: inv.escalatedToName,
    daysSinceChase: inv.daysSinceChase,
    chaseCount: inv.chaseCount,
    unreadReply: inv.unreadReply,
    todayStr: today,
  });
}

/** When a customer who needs nothing today comes back, and why. */
export function wakeFor(items: WorkspaceItem[], section: WorkspaceSection, today: string): WakeInfo | null {
  if (section === "now") return null;
  const lead = items[0];
  const promised = items.filter(i => i.inv.promiseDate && i.inv.promiseDate >= today);
  if (lead.action.type === "await" && lead.inv.promiseDate && lead.inv.promiseDate >= today) {
    const date = promised.map(i => i.inv.promiseDate as string).sort()[0];
    return { date: addDaysYmd(date, 1), why: "Check the money arrived" };
  }
  if (lead.inv.stageLabel === "Escalated" && lead.inv.escalatedToName) {
    return { date: null, why: `With ${lead.inv.escalatedToName}. They will update you` };
  }
  const chased = items.filter(i => i.inv.lastChaseDay).map(i => i.inv.lastChaseDay as string).sort().pop();
  if (chased && (lead.action.type === "await" || section === "done")) {
    const since = Math.max(0, diffDaysYmd(today, chased));
    return {
      date: addDaysYmd(chased, NA_CADENCE_DAYS),
      why: "Chase again if there is no reply",
      pct: Math.max(4, Math.min(100, (since / NA_CADENCE_DAYS) * 100)),
    };
  }
  if (section === "idle") {
    const due = items.map(i => i.inv.dueDate).filter((d): d is string => !!d && d >= today).sort()[0];
    if (due) return { date: due, why: "First invoice falls due" };
  }
  return null;
}

export function buildWorkspace(invoices: WorkspaceInvoice[], today: string): WorkspaceCustomer[] {
  const byCust = new Map<string, WorkspaceInvoice[]>();
  for (const inv of invoices) {
    const list = byCust.get(inv.custId);
    if (list) list.push(inv); else byCust.set(inv.custId, [inv]);
  }
  const out: WorkspaceCustomer[] = [];
  byCust.forEach((list, custId) => {
    const items = list
      .map(inv => ({ inv, action: actionFor(inv, today) }))
      .sort((a, b) => b.action.rank - a.action.rank || b.inv.bal - a.inv.bal);
    const top = items[0].action;
    const total: Record<string, number> = {};
    for (const i of items) total[i.inv.currency] = (total[i.inv.currency] ?? 0) + i.inv.bal;
    const chasedToday = items.some(i => i.inv.lastChaseDay === today);
    const section: WorkspaceSection =
      top.rank >= WORKSPACE_NOW_RANK ? "now"
      : chasedToday ? "done"
      : top.rank > 0 ? "wait"
      : "idle";
    out.push({
      custId, name: items[0].inv.custName, section, rank: top.rank, items, total, top,
      wake: wakeFor(items, section, today),
    });
  });
  const order: Record<WorkspaceSection, number> = { now: 0, done: 1, wait: 2, idle: 3 };
  const money = (c: WorkspaceCustomer) => Object.values(c.total).reduce((s, v) => s + v, 0);
  return out.sort((a, b) =>
    order[a.section] - order[b.section] || b.rank - a.rank || money(b) - money(a) || a.name.localeCompare(b.name));
}

/** The next seven days, for the "week ahead" strip: who comes back on each. */
export function weekAhead(customers: WorkspaceCustomer[], today: string, days = 7): { date: string; names: string[] }[] {
  const cols = Array.from({ length: days }, (_, k) => ({ date: addDaysYmd(today, k), names: [] as string[] }));
  for (const c of customers) {
    if (c.section === "now" || !c.wake?.date) continue;
    const col = cols.find(x => x.date === c.wake!.date);
    if (col) col.names.push(c.name);
  }
  return cols;
}
