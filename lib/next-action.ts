/**
 * Next Best Action — the single most useful thing to do on an invoice right
 * now, as a filterable action *type* (Email / Call / Escalate / …). Turns the
 * Collections Board into a work queue: sort by urgency, filter to "everyone I
 * need to Call", act in one click.
 *
 * The Email → Call → Escalate ladder gets stronger the longer an invoice
 * resists. Tune the thresholds below to match the team's chase cadence.
 */

export const NA_CADENCE_DAYS    = 7;   // days since last chase before nagging to chase again
export const NA_CALL_DAYS       = 30;  // overdue days at which Email escalates to Call
export const NA_CALL_CHASES     = 3;   // # chases at which Email escalates to Call
export const NA_ESCALATE_DAYS   = 90;  // overdue days at which it should be Escalated
export const NA_ESCALATE_CHASES = 5;   // # chases at which it should be Escalated

/** The filterable verb the accountant batches work by. */
export type NextActionType =
  | "reply" | "email" | "call" | "escalate" | "add_email" | "resolve" | "await" | "none";

export type NextAction = {
  type: NextActionType;
  label: string;
  detail?: string;
  rank: number;                                        // higher = more urgent (sort)
  act: "send" | "email" | "reply" | "escalate" | "log" | null; // what a click does
};

export type NextActionInput = {
  days: number;                    // days overdue (>0 = overdue)
  email: string | null;
  promiseDate?: string | null;
  hasOpenDispute?: boolean;
  stageLabel: string;
  escalatedToName?: string | null;
  daysSinceChase: number | null;   // null = never chased
  chaseCount: number;
  unreadReply: boolean;
  todayStr: string;
};

export function computeNextAction(i: NextActionInput): NextAction {
  const overdue = i.days > 0;

  // 1. Customer replied — respond before anything else.
  if (i.unreadReply) return { type: "reply", label: "Reply", rank: 100, act: "reply" };

  // 2. Already escalated & owned — someone else is driving it.
  if (i.stageLabel === "Escalated" && i.escalatedToName)
    return { type: "none", label: `With ${i.escalatedToName}`, rank: 15, act: null };

  // 3. Disputed — resolve, don't chase.
  if (i.hasOpenDispute) return { type: "resolve", label: "Resolve dispute", rank: 55, act: "log" };

  // 4. Broke a promise — a call is warranted, not another email.
  if (i.promiseDate && i.promiseDate < i.todayStr)
    return { type: "call", label: "Call — broke promise", rank: 88, act: "log" };

  // 5. Committed, date still ahead — monitor.
  if (i.promiseDate && i.promiseDate >= i.todayStr) {
    const inDays = Math.max(0, Math.round((new Date(i.promiseDate).getTime() - new Date(i.todayStr).getTime()) / 86_400_000));
    return { type: "await", label: "Awaiting payment", detail: `in ${inDays}d`, rank: 20, act: null };
  }

  // 6. Not yet due — nothing to do.
  if (!overdue) return { type: "none", label: "—", rank: 0, act: null };

  // 7. Overdue but no email on file — can't chase until that's fixed.
  if (!i.email) return { type: "add_email", label: "Add email", rank: 90, act: "email" };

  // 8. Overdue ladder.
  if (i.daysSinceChase === null)
    return { type: "email", label: "Send first reminder", rank: 66, act: "send" };
  if (i.daysSinceChase < NA_CADENCE_DAYS)
    return { type: "await", label: "Chased", detail: `${i.daysSinceChase}d ago`, rank: 18, act: null };
  if (i.days > NA_ESCALATE_DAYS || i.chaseCount >= NA_ESCALATE_CHASES)
    return { type: "escalate", label: "Escalate", detail: `${i.chaseCount} chases`, rank: 82, act: "escalate" };
  if (i.days > NA_CALL_DAYS || i.chaseCount >= NA_CALL_CHASES)
    return { type: "call", label: "Call", detail: `${i.daysSinceChase}d since chase`, rank: 72, act: "log" };
  return { type: "email", label: "Chase again", detail: `${i.daysSinceChase}d since`, rank: 60, act: "send" };
}

/** Filter options for the column, in display order. */
export const NEXT_ACTION_FILTERS: { key: NextActionType; label: string }[] = [
  { key: "reply",     label: "Reply" },
  { key: "email",     label: "Email" },
  { key: "call",      label: "Call" },
  { key: "escalate",  label: "Escalate" },
  { key: "add_email", label: "Add email" },
  { key: "resolve",   label: "Resolve dispute" },
  { key: "await",     label: "Awaiting" },
  { key: "none",      label: "No action" },
];
