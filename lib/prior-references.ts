// ─────────────────────────────────────────────────────────────────────────────
// Prior reference numbers — what a customer can look up in their own inbox
// ─────────────────────────────────────────────────────────────────────────────
//
// Every bulk email carries its own reference (AR-261029-FF10). When we write to
// a customer again about the same invoices they have no way to tie the new email
// to the earlier ones, so the footer lists the references already used for the
// invoices in THIS email.
//
// Rules, and why:
//   • Grouped by reference, with its date and the invoices it covered. A bare
//     list of codes says nothing about which email each one was.
//   • Only invoices in this email count, so one project's email never reveals
//     another project's references.
//   • Neutral wording — "notifications", never "chase" or "reminder": the
//     customer reads it.
//   • Capped in the email, complete in the attached statement.
//
// Pure and I/O-free, like lib/send-grouping.ts, so the rules are unit-tested.

export const PRIOR_REFS_HEADING = "Reference Numbers of Prior Notifications";

/** How many references the email footer lists before pointing at the statement. */
export const PRIOR_REFS_EMAIL_LIMIT = 5;

export type PriorSend = {
  invoiceId: string;
  ref: string | null;
  sentAt: Date | string;
};

export type PriorReference = {
  ref: string;
  /** YYYY-MM-DD, the UTC day it was sent. A date is a date: render with
   *  formatDateShort, never through new Date(). */
  date: string;
  invoiceNumbers: string[];
};

export type PriorReferenceSummary = {
  shown: PriorReference[];
  /** References beyond `limit` that are not listed. */
  earlier: number;
};

/**
 * @param sends     outbound emails already sent for these invoices
 * @param numberOf  invoiceId → invoice number, for the invoices in THIS email;
 *                  a send for any other invoice is ignored
 * @param limit     most references to list (Infinity for the statement)
 */
export function summarisePriorReferences(
  sends: PriorSend[],
  numberOf: Record<string, string>,
  limit: number = PRIOR_REFS_EMAIL_LIMIT,
): PriorReferenceSummary {
  const byRef = new Map<string, { t: number; ids: Set<string> }>();
  for (const s of sends) {
    const ref = (s.ref ?? "").trim();
    if (!ref || !(s.invoiceId in numberOf)) continue;
    const t = new Date(s.sentAt).getTime();
    if (Number.isNaN(t)) continue;
    const cur = byRef.get(ref);
    if (cur) { cur.t = Math.max(cur.t, t); cur.ids.add(s.invoiceId); }
    else byRef.set(ref, { t, ids: new Set([s.invoiceId]) });
  }

  const all: PriorReference[] = [...byRef.entries()]
    .sort((a, b) => b[1].t - a[1].t || a[0].localeCompare(b[0]))
    .map(([ref, v]) => ({
      ref,
      date: new Date(v.t).toISOString().slice(0, 10),
      invoiceNumbers: [...v.ids]
        .map(id => numberOf[id])
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    }));

  return { shown: all.slice(0, limit), earlier: Math.max(0, all.length - limit) };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-29" → "29-Oct-2026" (DD-MMM-YYYY). Built from the parts, never via
 *  new Date(), so it cannot shift a day with the viewer's timezone. Anything
 *  that is not a plain YYYY-MM-DD comes back unchanged rather than guessed. */
export function formatRefDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]}-${month}-${m[1]}` : ymd;
}

export const invoiceCountLabel =(n: number) => `${n} invoice${n === 1 ? "" : "s"}`;
