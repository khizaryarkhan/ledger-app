/**
 * Turning a customer's portal submission into rows to persist — pure, no I/O.
 *
 * This lives apart from lib/portal.ts (which imports `db` and `next/headers`)
 * for one reason: it is the logic that broke in front of a paying client and
 * it has to be testable without a database. The portal lets a customer
 * respond with JUST a comment, and the server used to ignore `note` entirely
 * and then reject the whole request as "Nothing to submit" — a 400 that the
 * page turns into a full-screen "Link unavailable". See tests/portal-submit.test.ts.
 *
 * DISPUTE_CATEGORIES is defined here and re-exported from lib/portal.ts, so
 * every existing `from "@/lib/portal"` import keeps working.
 */

export const DISPUTE_CATEGORIES = [
  "Wrong Amount",
  "Already Paid",
  "Goods/Service",
  "Duplicate",
  "Other",
] as const;

/** The minimum an invoice must carry for a response to be attributed to it. */
export type PortalInvoiceRef = {
  id: string;
  invoiceNumber: string;
  collectionOwnerId: string | null;
};

export type PortalResponseInput = {
  invoiceId?: string;
  promise?: { date?: string; amount?: unknown; note?: unknown } | null;
  dispute?: { category?: string; reason?: unknown } | null;
  note?: unknown;
};

export type PortalSubmission = {
  promiseRows: any[];
  disputeRows: any[];
  commRows: any[];
  /** One line per thing the customer said, for the staff notification email. */
  summary: string[];
  /** False when nothing in the payload was a real answer — the caller 400s. */
  hasContent: boolean;
};

export function buildPortalSubmission(
  responses: PortalResponseInput[],
  invoicesById: Map<string, PortalInvoiceRef>,
  ctx: { orgId: string; customerId: string; tokenId: string },
): PortalSubmission {
  const { orgId, customerId, tokenId } = ctx;
  const promiseRows: any[] = [];
  const disputeRows: any[] = [];
  const commRows: any[] = [];
  const summary: string[] = [];

  for (const r of responses) {
    const inv = r.invoiceId ? invoicesById.get(r.invoiceId) : undefined;
    if (!inv) continue;

    // --- Promise ---
    if (r.promise?.date) {
      const amount = r.promise.amount != null && !isNaN(Number(r.promise.amount))
        ? Number(r.promise.amount) : null;
      promiseRows.push({
        orgId, invoiceId: inv.id, customerId,
        promiseDate: String(r.promise.date).slice(0, 16),
        amount,
        source: "Customer Portal",
        enteredBy: null,
        note: r.promise.note ? String(r.promise.note).slice(0, 1000) : null,
        status: "Active",
        tokenId,
      });
      summary.push(`#${inv.invoiceNumber}: committed to pay ${amount != null ? amount : "full balance"} by ${r.promise.date}`);
    }

    // --- Dispute ---
    if (r.dispute?.category) {
      const category = (DISPUTE_CATEGORIES as readonly string[]).includes(r.dispute.category)
        ? r.dispute.category : "Other";
      disputeRows.push({
        orgId, invoiceId: inv.id, customerId,
        category,
        reason: r.dispute.reason ? String(r.dispute.reason).slice(0, 2000) : null,
        source: "Customer Portal",
        raisedBy: null,
        assignedTo: inv.collectionOwnerId ?? null, // auto-assign to the invoice owner
        status: "Open",
        tokenId,
      });
      summary.push(`#${inv.invoiceNumber}: DISPUTED (${category})${r.dispute.reason ? ` — ${r.dispute.reason}` : ""}`);
    }

    // --- Note only ---
    // A note isn't a promise or a dispute; it's an inbound message, recorded
    // as a communication. It is, on its own, enough to make a submission real.
    const note = typeof r.note === "string" ? r.note.trim().slice(0, 2000) : "";
    if (note) summary.push(`#${inv.invoiceNumber}: ${note}`);

    // Inbound communication record so staff see the response in the timeline
    const parts: string[] = [];
    if (r.promise?.date) parts.push(`Committed to pay ${r.promise.amount != null ? r.promise.amount : "full balance"} by ${r.promise.date}${r.promise.note ? ` (${r.promise.note})` : ""}`);
    if (r.dispute?.category) parts.push(`Dispute: ${r.dispute.category}${r.dispute.reason ? ` — ${r.dispute.reason}` : ""}`);
    if (note) parts.push(note);
    if (parts.length > 0) {
      commRows.push({
        orgId, customerId, invoiceId: inv.id,
        direction: "Inbound", channel: "Portal",
        subject: `Customer response — #${inv.invoiceNumber}`,
        body: parts.join("\n"),
        matchedBy: "Portal", isDraft: false, authorId: null,
      });
    }
  }

  // commRows covers note-only responses, which produce neither a promise nor
  // a dispute but are still a real answer from the customer.
  const hasContent = promiseRows.length > 0 || disputeRows.length > 0 || commRows.length > 0;
  return { promiseRows, disputeRows, commRows, summary, hasContent };
}

/**
 * Invoices that should have any open dispute resolved: the customer promised
 * to pay and did NOT also raise a fresh dispute on the same invoice.
 */
export function promisedWithoutNewDispute(promiseRows: any[], disputeRows: any[]): string[] {
  const disputedNow = new Set(disputeRows.map(d => d.invoiceId));
  return [...new Set(promiseRows.map(p => p.invoiceId))].filter(id => !disputedNow.has(id));
}
