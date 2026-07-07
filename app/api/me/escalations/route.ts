/**
 * GET /api/me/escalations
 *
 * Escalated invoices assigned to the logged-in user (matched by user id or
 * email). Powers the Escalations page in the rep portal — the session-based
 * sibling of the token-based owner portal.
 */

import { db } from "@/db";
import { invoices, customers, projects, communications } from "@/db/schema";
import { requireOrg, ok } from "@/lib/api";
import { and, eq, inArray, desc, or, sql } from "drizzle-orm";

export async function GET() {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const userId = (session?.user as any)?.id ?? null;
  const email  = ((session?.user as any)?.email ?? "").toLowerCase();

  const rows = await db
    .select({ inv: invoices, custName: customers.name, projName: projects.name })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(and(
      eq(invoices.orgId, orgId!),
      eq(invoices.collectionStage, "Escalated"),
      or(
        userId ? eq(invoices.escalatedToUserId, userId) : sql`false`,
        email ? sql`lower(${invoices.escalatedToEmail}) = ${email}` : sql`false`,
      ),
    ));

  const openBal = (inv: any) =>
    inv.qboBalance != null ? Number(inv.qboBalance)
    : inv.xeroBalance != null ? Math.max(0, Number(inv.xeroBalance))
    : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));

  const openRows = rows.filter(r => openBal(r.inv) > 0);
  const ids = openRows.map(r => r.inv.id);

  // Full activity history per invoice (same shape as the owner portal).
  const feedByInv: Record<string, any[]> = {};
  if (ids.length) {
    const comms = await db
      .select()
      .from(communications)
      .where(and(eq(communications.orgId, orgId!), inArray(communications.invoiceId, ids)))
      .orderBy(desc(communications.sentAt));
    const FEED = new Set(["Note", "Portal", "Dispute", "Promise", "Chase", "StageChange", "Email"]);
    for (const c of comms) {
      if (!c.invoiceId || !FEED.has(c.channel) || c.isDraft) continue;
      (feedByInv[c.invoiceId] ??= []);
      if (feedByInv[c.invoiceId].length < 50) {
        feedByInv[c.invoiceId].push({
          channel: c.channel, direction: c.direction, sender: c.sender,
          recipients: c.recipients,
          body: c.channel === "Email" && c.direction === "Outbound" ? null : c.body,
          subject: c.subject, sentAt: c.sentAt,
        });
      }
    }
  }

  const list = openRows
    .map(r => ({
      id: r.inv.id,
      invoiceNumber: r.inv.invoiceNumber,
      customerId: r.inv.customerId,
      projectId: r.inv.projectId,
      customer: r.custName ?? "—",
      project: r.projName ?? null,
      currency: r.inv.currency || "EUR",
      total: Number(r.inv.total || 0),
      outstanding: openBal(r.inv),
      dueDate: r.inv.dueDate,
      daysOverdue: Math.max(0, Math.floor((Date.now() - new Date(r.inv.dueDate).getTime()) / 86400000)),
      status: r.inv.hasOpenDispute
        ? `Disputed${r.inv.disputeReason ? ": " + r.inv.disputeReason : ""}`
        : r.inv.promiseDate ? `Committed ${r.inv.promiseDate}` : null,
      activity: feedByInv[r.inv.id] ?? [],
    }))
    .sort((a, b) => b.outstanding - a.outstanding);

  return ok({ invoices: list });
}
