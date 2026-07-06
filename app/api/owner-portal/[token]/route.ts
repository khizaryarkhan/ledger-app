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

const ok = (d: any) => NextResponse.json(d);
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s });

export async function GET(_req: Request, { params }: { params: { token: string } }) {
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

  // Recent activity per invoice (last 5 human-relevant entries each)
  const comms = await db
    .select()
    .from(communications)
    .where(and(eq(communications.orgId, tk.orgId), inArray(communications.invoiceId, ids)))
    .orderBy(desc(communications.sentAt));
  const FEED = new Set(["Note", "Portal", "Dispute", "Promise", "Chase", "StageChange"]);
  const feedByInv: Record<string, any[]> = {};
  for (const c of comms) {
    if (!c.invoiceId || !FEED.has(c.channel)) continue;
    (feedByInv[c.invoiceId] ??= []);
    if (feedByInv[c.invoiceId].length < 5) {
      feedByInv[c.invoiceId].push({
        channel: c.channel, sender: c.sender, body: c.body, subject: c.subject,
        sentAt: c.sentAt,
      });
    }
  }

  const openBal = (inv: any) =>
    inv.qboBalance != null ? Number(inv.qboBalance)
    : inv.xeroBalance != null ? Math.max(0, Number(inv.xeroBalance))
    : Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));

  // Only show invoices still escalated AND still open — resolved ones drop off.
  const list = rows
    .filter(r => r.inv.collectionStage === "Escalated" && openBal(r.inv) > 0)
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
