import { db } from "@/db";
import {
  customerPortalTokens, invoicePromises, invoiceDisputes, invoices,
  communications, customers, users, userOrganisations,
} from "@/db/schema";
import { validatePortalToken, recomputeInvoiceState, DISPUTE_CATEGORIES } from "@/lib/portal";
import { sendEmail } from "@/lib/mailer";
import { rateLimit } from "@/lib/rate-limit";
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";

/**
 * POST /api/portal/[token]/submit
 * Body: { responses: [{ invoiceId, promise?: {date, amount?, note?}, dispute?: {category, reason} }] }
 *
 * Records promise and/or dispute events (source = "Customer Portal"),
 * recomputes invoice state, marks the token Completed (single-use), logs an
 * inbound communication per invoice, and notifies staff.
 */
export async function POST(req: Request, { params }: { params: { token: string } }) {
  // Throttle submissions per token to blunt token-guessing / replay abuse.
  const rl = await rateLimit(`portal:submit:${params.token}`, 10, 3600);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });

  const v = await validatePortalToken(params.token);
  if (!v.ok) {
    const reason = "reason" in v ? v.reason : "error";
    return NextResponse.json({ error: reason }, { status: 410 });
  }
  const { row } = v;

  const body = await req.json().catch(() => null);
  const responses: any[] = Array.isArray(body?.responses) ? body.responses : [];
  if (responses.length === 0) return NextResponse.json({ error: "No responses provided" }, { status: 400 });

  const snapshot = new Set((row.invoiceIds as string[]) ?? []);
  const orgId = row.orgId;
  const customerId = row.customerId;

  // Load the affected invoices (validate ownership + that they're in the snapshot)
  const ids = responses.map(r => r.invoiceId).filter((id: string) => snapshot.has(id));
  if (ids.length === 0) return NextResponse.json({ error: "No valid invoices in this request" }, { status: 400 });

  const invRows = await db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, collectionOwnerId: invoices.collectionOwnerId })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.customerId, customerId), inArray(invoices.id, ids)));
  const invById = new Map(invRows.map(i => [i.id, i as { id: string; invoiceNumber: string; collectionOwnerId: string | null }]));

  const promiseRows: any[] = [];
  const disputeRows: any[] = [];
  const commRows: any[] = [];
  const summary: string[] = [];

  for (const r of responses) {
    const inv = invById.get(r.invoiceId);
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
        tokenId: row.id,
      });
      summary.push(`#${inv.invoiceNumber}: promised ${amount != null ? amount : "full balance"} by ${r.promise.date}`);
    }

    // --- Dispute ---
    if (r.dispute?.category) {
      const category = DISPUTE_CATEGORIES.includes(r.dispute.category) ? r.dispute.category : "Other";
      disputeRows.push({
        orgId, invoiceId: inv.id, customerId,
        category,
        reason: r.dispute.reason ? String(r.dispute.reason).slice(0, 2000) : null,
        source: "Customer Portal",
        raisedBy: null,
        assignedTo: inv.collectionOwnerId ?? null, // auto-assign to the invoice owner
        status: "Open",
        tokenId: row.id,
      });
      summary.push(`#${inv.invoiceNumber}: DISPUTED (${category})${r.dispute.reason ? ` — ${r.dispute.reason}` : ""}`);
    }

    // Inbound communication record so staff see the response in the timeline
    const parts: string[] = [];
    if (r.promise?.date) parts.push(`Promise to pay ${r.promise.amount != null ? r.promise.amount : "full balance"} by ${r.promise.date}${r.promise.note ? ` (${r.promise.note})` : ""}`);
    if (r.dispute?.category) parts.push(`Dispute: ${r.dispute.category}${r.dispute.reason ? ` — ${r.dispute.reason}` : ""}`);
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

  if (promiseRows.length === 0 && disputeRows.length === 0) {
    return NextResponse.json({ error: "Nothing to submit" }, { status: 400 });
  }

  // Switching dispute → promise: if the customer set a promise on an invoice
  // (and did NOT also raise a new dispute on it), resolve any open dispute there.
  const disputedNow = new Set(disputeRows.map(d => d.invoiceId));
  const promisedSwitchIds = [...new Set(promiseRows.map(p => p.invoiceId))].filter(id => !disputedNow.has(id));
  if (promisedSwitchIds.length > 0) {
    await db.update(invoiceDisputes)
      .set({ status: "Resolved", outcome: "Customer agreed to pay", resolvedAt: new Date() })
      .where(and(
        eq(invoiceDisputes.orgId, orgId),
        inArray(invoiceDisputes.invoiceId, promisedSwitchIds),
        inArray(invoiceDisputes.status, ["Open", "Under Review"]),
      )).catch(() => {});
  }

  // Persist events
  if (promiseRows.length > 0) await db.insert(invoicePromises).values(promiseRows);
  if (disputeRows.length > 0) await db.insert(invoiceDisputes).values(disputeRows);
  if (commRows.length > 0) await db.insert(communications).values(commRows).catch(() => {});

  // Recompute derived state per affected invoice
  await Promise.all([...new Set(ids)].map(id => recomputeInvoiceState(orgId, id)));

  // Single-use: mark token Completed so the link dies until a new request is sent
  await db.update(customerPortalTokens)
    .set({ status: "Completed", completedAt: new Date() })
    .where(eq(customerPortalTokens.id, row.id));

  // Notify staff (collection owners of affected invoices + org admins)
  notifyStaff(orgId, customerId, summary, disputeRows.length > 0).catch(err =>
    console.warn("portal: staff notification failed:", err?.message)
  );

  return NextResponse.json({ ok: true });
}

/** Escape user-supplied text before embedding in notification email HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/** Email a summary to the relevant collection owners + org admins. */
async function notifyStaff(orgId: string, customerId: string, summary: string[], hasDispute: boolean) {
  const [cust] = await db.select({ name: customers.name }).from(customers).where(eq(customers.id, customerId)).limit(1);
  const custName = escapeHtml(cust?.name ?? "Customer");

  // Recipients: all company admins of the org (+ could add collection owners)
  const admins = await db
    .select({ email: users.email })
    .from(userOrganisations)
    .leftJoin(users, eq(users.id, userOrganisations.userId))
    .where(and(eq(userOrganisations.orgId, orgId), inArray(userOrganisations.role, ["company_admin", "company_user"])));

  const to = [...new Set(admins.map(a => a.email).filter(Boolean))].join(", ");
  if (!to) return;

  // Subject is plain text (not HTML); body interpolates user input, so escape it.
  const subject = hasDispute
    ? `⚠️ ${cust?.name ?? "Customer"} raised a dispute via portal`
    : `${cust?.name ?? "Customer"} submitted a payment response`;

  const body = `
    <div style="font-family:Arial,sans-serif;max-width:600px;">
      <h2 style="font-size:18px;color:#111827;">${custName} responded via the customer portal</h2>
      <ul style="font-size:14px;color:#374151;line-height:1.7;">
        ${summary.map(s => `<li>${escapeHtml(s)}</li>`).join("")}
      </ul>
      ${hasDispute ? `<p style="color:#dc2626;font-size:13px;"><strong>A dispute was raised — collection automations have been paused for the affected invoice(s).</strong></p>` : ""}
      <p style="font-size:12px;color:#9ca3af;">Log in to Primeaccountax to review the full timeline.</p>
    </div>`;

  await sendEmail(orgId, { to, subject, body });
}
