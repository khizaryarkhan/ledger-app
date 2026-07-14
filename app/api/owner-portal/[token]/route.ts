/**
 * Owner escalation portal API — no login, token-authenticated.
 *
 * GET  /api/owner-portal/[token]  → owner name + their escalated invoices with
 *                                   activity context (recent comments per invoice)
 * POST /api/owner-portal/[token]  → { invoiceId, body } — add a comment; lands
 *                                   in the invoice's activity feed instantly.
 *
 * The token stays alive until expiry (unlike customer tokens) so the owner
 * can keep commenting as they work their list.
 */

import { db } from "@/db";
import { invoices, customers, projects, communications, organisations, ownerPortalTokens } from "@/db/schema";
import { validateOwnerPortalToken } from "@/lib/portal";
import { and, eq, inArray, desc } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, clientIp } from "@/lib/rate-limit";

const ok = (d: any) => NextResponse.json(d);
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const rl = await rateLimit(`owner-portal:${clientIp(_req)}`, 60, 60);
  if (!rl.ok) return bad("Too many requests", 429);
  const v = await validateOwnerPortalToken(params.token);
  if (!v.ok) return bad((v as { ok: false; reason: string }).reason === "expired" ? "This link has expired" : "Link not found", 404);
  const tk = v.row;

  const ids = tk.invoiceIds as string[];
  if (!ids.length) return ok({ owner: tk.ownerName, org: null, invoices: [] });

  const [org] = await db.select({ name: organisations.name, logoUrl: organisations.logoUrl })
    .from(organisations).where(eq(organisations.id, tk.orgId)).limit(1);

  const rows = await db
    .select({ inv: invoices, custName: customers.name, projName: projects.name })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(and(eq(invoices.orgId, tk.orgId), inArray(invoices.id, ids)));

  // Full activity history per invoice — the owner gets the complete picture
  // of what's been said and done. Outbound emails are summarised client-side
  // (subject + recipient), inbound replies shown in full. Capped at 50 per
  // invoice as a payload guard.
  const comms = await db
    .select()
    .from(communications)
    .where(and(eq(communications.orgId, tk.orgId), inArray(communications.invoiceId, ids)))
    .orderBy(desc(communications.sentAt));
  const FEED = new Set(["Note", "Portal", "Dispute", "Promise", "Chase", "StageChange", "Email"]);
  const feedByInv: Record<string, any[]> = {};
  for (const c of comms) {
    if (!c.invoiceId || !FEED.has(c.channel) || c.isDraft) continue;
    (feedByInv[c.invoiceId] ??= []);
    if (feedByInv[c.invoiceId].length < 50) {
      feedByInv[c.invoiceId].push({
        channel: c.channel, direction: c.direction, sender: c.sender,
        recipients: c.recipients,
        // Outbound emails: strip the body — subject + recipient is the signal.
        body: c.channel === "Email" && c.direction === "Outbound" ? null : c.body,
        subject: c.subject, sentAt: c.sentAt,
      });
    }
  }

  const openBal = (inv: any) =>
    inv.qboBalance != null ? Number(inv.qboBalance)
    : inv.xeroBalance != null ? Math.max(0, Number(inv.xeroBalance))
    : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));

  // Only show invoices still escalated TO THIS OWNER and still open. The
  // token snapshot only grows (re-notifies merge ids), so current ownership
  // must be re-checked here — a reassigned invoice drops off the old owner's
  // link immediately.
  const ownerEmail = tk.ownerEmail.toLowerCase();
  const list = rows
    .filter(r =>
      r.inv.collectionStage === "Escalated" &&
      String(r.inv.escalatedToEmail ?? "").toLowerCase() === ownerEmail &&
      openBal(r.inv) > 0
    )
    .map(r => ({
      id: r.inv.id,
      invoiceNumber: r.inv.invoiceNumber,
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
      escalationType: r.inv.escalationType ?? null,
      escalationNote: r.inv.escalationNote ?? null,
      activity: feedByInv[r.inv.id] ?? [],
    }))
    .sort((a, b) => b.outstanding - a.outstanding);

  // Track engagement — lets the board show whether the owner opened their portal.
  await db.update(ownerPortalTokens)
    .set({ lastViewedAt: new Date() })
    .where(eq(ownerPortalTokens.id, tk.id))
    .catch(() => {});

  return ok({ owner: tk.ownerName, org: org ?? null, invoices: list });
}

const PostSchema = z.object({
  invoiceId: z.string().uuid(),
  body: z.string().min(1).max(4000),
});

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const rl = await rateLimit(`owner-portal-post:${clientIp(req)}`, 30, 60);
  if (!rl.ok) return bad("Too many requests", 429);
  const v = await validateOwnerPortalToken(params.token);
  if (!v.ok) return bad((v as { ok: false; reason: string }).reason === "expired" ? "This link has expired" : "Link not found", 404);
  const tk = v.row;

  let data: z.infer<typeof PostSchema>;
  try {
    data = PostSchema.parse(await req.json());
  } catch (e: any) {
    return bad(e?.issues?.[0]?.message ?? "Invalid request");
  }

  // The invoice must be in this token's snapshot — owners can only comment
  // on invoices actually assigned to them.
  const ids = tk.invoiceIds as string[];
  if (!ids.includes(data.invoiceId)) return bad("Invoice not covered by this link", 403);

  const [inv] = await db.select()
    .from(invoices)
    .where(and(eq(invoices.id, data.invoiceId), eq(invoices.orgId, tk.orgId)))
    .limit(1);
  if (!inv) return bad("Invoice not found", 404);
  // Current-ownership check — commenting rights end when the invoice is
  // reassigned or de-escalated, even while the token snapshot still lists it.
  if (inv.collectionStage !== "Escalated" ||
      String(inv.escalatedToEmail ?? "").toLowerCase() !== tk.ownerEmail.toLowerCase()) {
    return bad("This invoice is no longer assigned to you", 403);
  }

  const [created] = await db.insert(communications).values({
    orgId:      tk.orgId,
    customerId: inv.customerId,
    projectId:  inv.projectId ?? null,
    invoiceId:  inv.id,
    direction:  "Inbound",
    channel:    "Portal",
    subject:    "Owner update",
    body:       data.body.trim(),
    sender:     tk.ownerName,
    matchedBy:  "OwnerPortal",
    isDraft:    false,
    ...(tk.ownerUserId ? { authorId: tk.ownerUserId } : {}),
  }).returning();

  return ok({ ok: true, id: created.id, sentAt: created.sentAt });
}
