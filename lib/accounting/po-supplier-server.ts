/**
 * Purchase orders ↔ supplier: send from the user's own mailbox with a private
 * portal link, take the supplier's answer, and apply it only when a user accepts.
 *
 * A supplier's revision NEVER changes the order by itself. It is stored as a
 * pending response; the PO shows "Revision proposed" until someone decides.
 * Confirm and decline are the supplier's own statements, so they apply at once
 * (decline is reopenable). Every public entry point validates before writing —
 * neon-http has no transactions.
 */
import { randomBytes } from "crypto";
import { db } from "@/db";
import {
  tradeDocuments, tradeDocumentLines, supplierPortalTokens, poSupplierResponses, poLineRevisions, parties, organisations, users, apItems,
  itemSkus, itemSupplierSkus,
} from "@/db/schema";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";
import { fillTemplate } from "@/lib/email-template";
import { genEmailRef } from "@/lib/email-ref";
import { logEvent } from "@/lib/audit";
import { getAppUrl } from "@/lib/portal";
import { LedgerValidationError } from "@/lib/ledger";
import { applyPromise } from "@/lib/inventory/delivery-performance";
import { QTY_EPSILON } from "@/lib/inventory/round";
import { diffSubmission, repriceLine, type SubmittedLine } from "@/lib/accounting/po-workflow";

const err = (m: string): never => { throw new LedgerValidationError(m); };
const TOKEN_TTL_DAYS = 30;
const MAX_POS_PER_EMAIL = 10;

const esc = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const money = (n: number, ccy?: string | null) =>
  `${ccy ? `${ccy} ` : ""}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** One live token per PO: a resend keeps the same link and pushes the expiry out. */
async function ensureToken(orgId: string, documentId: string, createdBy: string | null) {
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000);
  const [live] = await db.select().from(supplierPortalTokens)
    .where(and(eq(supplierPortalTokens.documentId, documentId), eq(supplierPortalTokens.orgId, orgId), eq(supplierPortalTokens.status, "Active")))
    .orderBy(desc(supplierPortalTokens.createdAt)).limit(1);
  if (live) {
    await db.update(supplierPortalTokens).set({ expiresAt }).where(eq(supplierPortalTokens.id, live.id));
    return { token: live.token, id: live.id, expiresAt };
  }
  const token = randomBytes(32).toString("base64url");
  const [row] = await db.insert(supplierPortalTokens).values({ orgId, documentId, token, createdBy, expiresAt }).returning();
  return { token, id: row.id, expiresAt };
}

export interface SendPoInput { ids: string[]; to: string; cc?: string; subject: string; body: string }

/** Email one or several POs for ONE supplier: a PDF each, a portal button each. */
export async function sendPurchaseOrders(orgId: string, input: SendPoInput, actorId: string | null, actorName: string | null) {
  const ids = Array.from(new Set(input.ids ?? []));
  if (!ids.length) err("Choose at least one purchase order.");
  if (ids.length > MAX_POS_PER_EMAIL) err(`Send at most ${MAX_POS_PER_EMAIL} purchase orders in one email.`);
  if (!input.to?.trim()) err("Enter at least one recipient.");
  const docs = await db.select().from(tradeDocuments).where(and(inArray(tradeDocuments.id, ids), eq(tradeDocuments.orgId, orgId)));
  if (docs.length !== ids.length) err("A purchase order was not found.");
  if (docs.some(d => d.kind !== "PurchaseOrder")) err("Only purchase orders can be sent to a supplier.");
  if (docs.some(d => d.rejectedAt)) err("A rejected order cannot be sent — reopen it first.");
  if (new Set(docs.map(d => d.partyId ?? "")).size > 1) err("These orders are for different suppliers — send them separately.");

  const { renderTradeDocumentPdf } = await import("@/lib/pdf/document-pdf");
  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const orgName = org?.displayName || org?.name || "";

  const links = new Map<string, string>();
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  for (const d of docs) {
    const t = await ensureToken(orgId, d.id, actorId);
    links.set(d.id, `${getAppUrl()}/supplier-portal/${t.token}`);
    const pdf = await renderTradeDocumentPdf(orgId, d.id);
    if (!pdf) err(`Could not render ${d.docNumber ?? "the order"} as a PDF.`);
    attachments.push({ filename: `${d.docNumber ?? "PurchaseOrder"}.pdf`, content: Buffer.from(pdf!), contentType: "application/pdf" });
  }

  const ref = genEmailRef();
  const subject = fillTemplate(input.subject, { ref });
  const blocks = docs.map(d => `
    <div style="margin:18px 0;padding:14px 16px;border:1px solid #e7e5e4;border-radius:8px">
      <div style="font-size:14px;font-weight:600;color:#1c1917">${esc(d.docNumber ?? "Purchase order")}
        <span style="font-weight:400;color:#57534e"> · ${esc(money(Number(d.total), d.currency))}</span></div>
      <div style="margin-top:10px"><a href="${esc(links.get(d.id)!)}" style="display:inline-block;background:#047857;color:#fff;text-decoration:none;font-size:14px;font-weight:600;padding:9px 16px;border-radius:6px">Review &amp; confirm order →</a></div>
    </div>`).join("");
  const html = `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:14px;line-height:1.55;color:#1c1917">
    ${esc(fillTemplate(input.body, { ref })).replace(/\n/g, "<br>")}${blocks}
    <div style="font-size:12px;color:#78716c">${esc(orgName)} · Ref ${esc(ref)}</div></div>`;

  const sent = await sendEmail(orgId, { to: input.to, cc: input.cc, subject, body: html, attachments });

  const now = new Date();
  for (const d of docs) {
    if (!d.sentAt) await db.update(tradeDocuments).set({ sentAt: now, updatedAt: now }).where(eq(tradeDocuments.id, d.id));
    logEvent({ orgId, eventType: "document_emailed", docType: "trade", docId: d.id, actorId, actorName, meta: { to: input.to, ref, portal: true } })
      .catch(e => console.error("[audit] po emailed failed:", e));
  }
  return { sent: true, from: sent.from, count: docs.length, ref };
}

/** Defaults for the Send drawer: recipient, subject, message. */
export async function sendDefaults(orgId: string, ids: string[]) {
  const docs = await db.select().from(tradeDocuments).where(and(inArray(tradeDocuments.id, ids), eq(tradeDocuments.orgId, orgId)));
  if (!docs.length) err("Purchase order not found.");
  const first = docs[0];
  const [sup] = first.partyId ? await db.select({ name: parties.name, email: parties.email }).from(parties).where(and(eq(parties.id, first.partyId), eq(parties.orgId, orgId))).limit(1) : [];
  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const orgName = org?.displayName || org?.name || "";
  const nums = docs.map(d => d.docNumber).filter(Boolean).join(", ");
  const several = docs.length > 1;
  return {
    supplierName: sup?.name ?? first.partyLabel ?? "",
    supplierId: first.partyId,
    to: sup?.email ?? "",
    orgName,
    subject: `Purchase Order${several ? "s" : ""} ${nums} — Ref {ref}`,
    body: `Hi ${sup?.name ?? first.partyLabel ?? "team"},\n\nPlease find our purchase order${several ? "s" : ""} ${nums} attached. Use the button below to confirm ${several ? "each one" : "it"}, or to suggest a different quantity or delivery date if you can't supply ${several ? "them" : "it"} as ordered.\n\nThank you,\n${orgName}`,
    orders: docs.map(d => ({ id: d.id, docNumber: d.docNumber, total: Number(d.total), currency: d.currency, partyId: d.partyId })),
  };
}

type TokenCheck = { ok: true; token: typeof supplierPortalTokens.$inferSelect } | { ok: false; reason: "not_found" | "expired" };

export async function checkSupplierToken(token: string): Promise<TokenCheck> {
  const [row] = await db.select().from(supplierPortalTokens).where(eq(supplierPortalTokens.token, token)).limit(1);
  if (!row) return { ok: false, reason: "not_found" };
  if (row.status !== "Active" || new Date(row.expiresAt).getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, token: row };
}

/** Everything the public page shows. Only this PO — nothing else of the org's. */
export async function supplierPortalView(token: string) {
  const v = await checkSupplierToken(token);
  if (!v.ok) return v;
  const t = v.token;
  await db.update(supplierPortalTokens).set({ lastViewedAt: new Date() }).where(eq(supplierPortalTokens.id, t.id)).catch(() => {});
  const [doc] = await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.id, t.documentId), eq(tradeDocuments.orgId, t.orgId))).limit(1);
  if (!doc) return { ok: false as const, reason: "not_found" as const };
  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName, logoUrl: organisations.logoUrl }).from(organisations).where(eq(organisations.id, t.orgId)).limit(1);
  const lines = await db.select().from(tradeDocumentLines).where(eq(tradeDocumentLines.documentId, doc.id)).orderBy(tradeDocumentLines.lineNo);
  const itemIds = Array.from(new Set(lines.map(l => l.itemId).filter(Boolean) as string[]));
  const skuIds = Array.from(new Set(lines.map(l => l.skuId).filter(Boolean) as string[]));
  const supIds = Array.from(new Set(lines.map(l => l.supplierSkuId).filter(Boolean) as string[]));
  const [items, skus, sups] = await Promise.all([
    itemIds.length ? db.select({ id: apItems.id, name: apItems.name, baseUom: apItems.baseUom }).from(apItems).where(inArray(apItems.id, itemIds)) : Promise.resolve([] as { id: string; name: string; baseUom: string | null }[]),
    skuIds.length ? db.select({ id: itemSkus.id, name: itemSkus.skuName }).from(itemSkus).where(inArray(itemSkus.id, skuIds)) : Promise.resolve([] as { id: string; name: string | null }[]),
    supIds.length ? db.select({ id: itemSupplierSkus.id, name: itemSupplierSkus.supplierProductName, ours: itemSupplierSkus.skuName }).from(itemSupplierSkus).where(inArray(itemSupplierSkus.id, supIds)) : Promise.resolve([] as { id: string; name: string | null; ours: string | null }[]),
  ]);
  const itemBy = new Map(items.map(i => [i.id, i])), skuBy = new Map(skus.map(s => [s.id, s])), supBy = new Map(sups.map(s => [s.id, s]));
  const [pending] = await db.select().from(poSupplierResponses)
    .where(and(eq(poSupplierResponses.documentId, doc.id), eq(poSupplierResponses.status, "pending"))).limit(1);
  const [latest] = await db.select().from(poSupplierResponses).where(eq(poSupplierResponses.documentId, doc.id)).orderBy(desc(poSupplierResponses.createdAt)).limit(1);
  const revs = pending ? await db.select().from(poLineRevisions).where(eq(poLineRevisions.responseId, pending.id)) : [];
  const revBy = new Map(revs.map(r => [r.lineId, r]));
  return {
    ok: true as const,
    expiresAt: t.expiresAt.toISOString(),
    org: { name: org?.displayName || org?.name || "", logoUrl: org?.logoUrl ?? null },
    po: {
      docNumber: doc.docNumber, issueDate: doc.issueDate, currency: doc.currency, supplierName: doc.partyLabel,
      total: Number(doc.total), confirmed: !!doc.confirmedAt, rejected: !!doc.rejectedAt,
    },
    pending: pending ? { message: pending.message, createdAt: pending.createdAt.toISOString() } : null,
    lastReply: latest?.reply ? { text: latest.reply, status: latest.status } : null,
    lines: lines.map(l => {
      const rev = revBy.get(l.id);
      const per = Number(l.unitsPerOrderUnit) || 1;
      return {
        id: l.id,
        name: supBy.get(l.supplierSkuId ?? "")?.name || supBy.get(l.supplierSkuId ?? "")?.ours || skuBy.get(l.skuId ?? "")?.name || itemBy.get(l.itemId ?? "")?.name || l.description || "Item",
        orderUom: l.orderUom, unitsPerOrderUnit: per, baseUom: itemBy.get(l.itemId ?? "")?.baseUom ?? null,
        qty: Number(l.qty ?? 0), rate: Number(l.rate ?? 0), amount: Number(l.amount),
        date: l.promisedDate || l.requestedDate || null, closed: l.closed,
        proposedQty: rev ? Number(rev.proposedQty) : null, proposedDate: rev?.proposedDate ?? null,
      };
    }),
  };
}

export interface SupplierSubmission { kind: "confirm" | "revise" | "decline"; message?: string | null; lines?: SubmittedLine[] }

/** The supplier answers. Revisions are stored, not applied. */
export async function submitSupplierResponse(token: string, input: SupplierSubmission) {
  const v = await checkSupplierToken(token);
  if (!v.ok) return err("This link is no longer active. Contact the buyer directly.");
  const t = v.token;
  const message = input.message?.trim().slice(0, 2000) || null;
  if (!["confirm", "revise", "decline"].includes(input.kind)) err("Choose how you want to respond.");
  const [doc] = await db.select().from(tradeDocuments).where(and(eq(tradeDocuments.id, t.documentId), eq(tradeDocuments.orgId, t.orgId))).limit(1);
  if (!doc) return err("Order not found.");
  if (doc.rejectedAt) err("This order has been withdrawn. Contact the buyer directly.");
  const lines = await db.select().from(tradeDocumentLines).where(eq(tradeDocumentLines.documentId, doc.id));
  const now = new Date();

  let kind = input.kind;
  // Goods already received or billed: the order is no longer the supplier's to withdraw.
  if (kind === "decline" && lines.some(l => Number(l.receivedQty) > 0 || Number(l.invoicedAmount) > 0))
    err("Goods have already been received against this order. Please contact the buyer directly.");
  let revisions: ReturnType<typeof diffSubmission> = [];
  if (kind === "revise") {
    try {
      revisions = diffSubmission(lines.map(l => ({
        id: l.id, qty: Number(l.qty ?? 0), promisedDate: l.promisedDate, requestedDate: l.requestedDate, closed: l.closed,
      })), input.lines ?? []);
    } catch (e: any) { err(e.message); } // a plain Error would surface as a 500
    if (!revisions.length) kind = "confirm"; // nothing changed — that is a confirmation
  }

  const [resp] = await db.insert(poSupplierResponses).values({
    orgId: t.orgId, documentId: doc.id, tokenId: t.id, kind, message,
    status: kind === "revise" ? "pending" : "applied",
  }).returning();

  if (kind === "revise") {
    await db.insert(poLineRevisions).values(revisions.map(r => {
      const l = lines.find(x => x.id === r.lineId)!;
      return {
        orgId: t.orgId, responseId: resp.id, lineId: r.lineId,
        originalQty: String(l.qty ?? 0), originalDate: l.promisedDate || l.requestedDate || null,
        proposedQty: String(r.proposedQty), proposedDate: r.proposedDate,
      };
    }));
  }
  // Supersede an earlier unanswered proposal only AFTER the new one is safely stored: the
  // newest word is the only one a user decides on. A proposal a user is deciding right now
  // is "deciding", not "pending", so this cannot clobber it.
  await db.update(poSupplierResponses).set({ status: "declined", reply: "Superseded by a newer response.", decidedAt: now })
    .where(and(eq(poSupplierResponses.documentId, doc.id), eq(poSupplierResponses.status, "pending"), ne(poSupplierResponses.id, resp.id)));

  if (kind === "confirm") {
    if (!doc.confirmedAt) await db.update(tradeDocuments).set({ confirmedAt: now, sentAt: doc.sentAt ?? now, updatedAt: now }).where(eq(tradeDocuments.id, doc.id));
  } else {
    await db.update(tradeDocuments).set({ rejectedAt: now, rejectReason: message || "The supplier cannot supply this order.", updatedAt: now }).where(eq(tradeDocuments.id, doc.id));
  }

  logEvent({ orgId: t.orgId, eventType: "document_edited", docType: "trade", docId: doc.id, actorName: "Supplier (portal)", meta: { action: `supplier_${kind}`, docNumber: doc.docNumber, lines: revisions.length } })
    .catch(e => console.error("[audit] supplier response failed:", e));
  notifyBuyer(t.orgId, doc, kind, message).catch(e => console.error("[po] notify buyer failed:", e));
  return { kind, revisions: revisions.length };
}

/** Tell whoever raised the PO. Best-effort: a mail failure must not lose the supplier's answer. */
async function notifyBuyer(orgId: string, doc: typeof tradeDocuments.$inferSelect, kind: string, message: string | null) {
  if (!doc.createdBy) return;
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, doc.createdBy)).limit(1);
  if (!u?.email) return;
  const what = kind === "confirm" ? "confirmed" : kind === "decline" ? "declined" : "proposed changes to";
  await sendEmail(orgId, {
    to: u.email,
    subject: `${doc.partyLabel ?? "Your supplier"} ${what} ${doc.docNumber ?? "your purchase order"}`,
    body: `<p>${esc(doc.partyLabel ?? "The supplier")} ${what} <b>${esc(doc.docNumber ?? "")}</b> in the supplier portal.</p>${message ? `<p style="color:#57534e">“${esc(message)}”</p>` : ""}<p>${kind === "revise" ? "Open Purchase Orders and choose Review changes to accept or keep the original." : "Open Purchase Orders to see the update."}</p>`,
  });
}

/** What the buyer reviews: each proposed line, old against new. */
export async function pendingProposal(orgId: string, documentId: string) {
  const [resp] = await db.select().from(poSupplierResponses)
    .where(and(eq(poSupplierResponses.orgId, orgId), eq(poSupplierResponses.documentId, documentId), eq(poSupplierResponses.status, "pending"))).limit(1);
  if (!resp) return null;
  const revs = await db.select().from(poLineRevisions).where(eq(poLineRevisions.responseId, resp.id));
  const lines = await db.select().from(tradeDocumentLines).where(eq(tradeDocumentLines.documentId, documentId)).orderBy(tradeDocumentLines.lineNo);
  const [doc] = await db.select({ docNumber: tradeDocuments.docNumber, partyLabel: tradeDocuments.partyLabel, currency: tradeDocuments.currency, total: tradeDocuments.total }).from(tradeDocuments).where(eq(tradeDocuments.id, documentId)).limit(1);
  return {
    responseId: resp.id, message: resp.message, at: resp.createdAt.toISOString(), doc: { ...doc, total: Number(doc?.total ?? 0) },
    lines: lines.map(l => {
      const r = revs.find(x => x.lineId === l.id);
      return {
        lineId: l.id, name: l.description ?? "Item", orderUom: l.orderUom, rate: Number(l.rate ?? 0),
        qty: Number(l.qty ?? 0), date: l.promisedDate || l.requestedDate || null,
        amount: Number(l.amount),
        change: r ? { proposedQty: Number(r.proposedQty), proposedDate: r.proposedDate } : null,
      };
    }),
  };
}

const hasNewDate = (r: { proposedDate: string | null; originalDate: string | null }) =>
  !!r.proposedDate && r.proposedDate !== (r.originalDate ?? null);

export interface DecideInput { responseId: string; accept: Record<string, boolean>; reply?: string | null }

/** Apply the lines the buyer accepted; keep the rest. Totals are recomputed from the lines. */
export async function decideProposal(orgId: string, documentId: string, input: DecideInput, actorId: string | null) {
  const [resp] = await db.select().from(poSupplierResponses).where(and(eq(poSupplierResponses.id, input.responseId), eq(poSupplierResponses.orgId, orgId), eq(poSupplierResponses.documentId, documentId))).limit(1);
  if (!resp) err("Proposal not found.");
  if (resp.status !== "pending") err("This proposal has already been decided.");
  const revs = await db.select().from(poLineRevisions).where(eq(poLineRevisions.responseId, resp.id));
  const lines = await db.select().from(tradeDocumentLines).where(eq(tradeDocumentLines.documentId, documentId));

  // Validate every accepted line before writing any (no transactions).
  const plan = revs.map(r => {
    const l = lines.find(x => x.id === r.lineId);
    if (!l) return err("A proposed line no longer exists.");
    // A line closed since the proposal was made is no longer the buyer's to re-price.
    const accepted = !!input.accept[r.lineId] && !l!.closed;
    if (!accepted) return { r, l: l!, accepted, calc: null as null | ReturnType<typeof repriceLine> };
    // Tax scales from the line's current amount; a line once reduced to zero has lost that basis.
    if (Number(l!.amount) <= 0 && l!.taxRateId) err(`${l!.description ?? "A line"} was reduced to zero, so its tax cannot be rebuilt here — edit the order instead.`);
    const calc = repriceLine({ rate: Number(l!.rate ?? 0), amount: Number(l!.amount), taxAmount: Number(l!.taxAmount), unitsPerOrderUnit: Number(l!.unitsPerOrderUnit) || 1 }, Number(r.proposedQty));
    if (calc.orderedBase < Number(l!.receivedQty) - QTY_EPSILON) err(`${l!.description ?? "A line"} has already received more than the proposed quantity.`);
    if (Number(l!.invoicedAmount) > calc.amount + 0.005) err(`${l!.description ?? "A line"} is already billed beyond the proposed amount.`);
    if (hasNewDate(r)) applyPromise(l!, r.proposedDate!); // throws on a malformed date
    return { r, l: l!, accepted, calc };
  });

  const now = new Date();
  // Claim the proposal before any write: two concurrent decisions (or a supplier resubmitting
  // mid-decision) must not both apply. neon-http has no transaction, so the claim is one UPDATE.
  const claimed = await db.update(poSupplierResponses).set({ status: "deciding" })
    .where(and(eq(poSupplierResponses.id, resp.id), eq(poSupplierResponses.status, "pending"))).returning({ id: poSupplierResponses.id });
  if (!claimed.length) err("This proposal has already been decided or replaced by a newer one.");
  for (const p of plan) {
    if (p.accepted && p.calc) {
      // Only a date the supplier actually moved is a promise; a quantity-only change must not
      // turn OUR requested date into their "first promise".
      const promise = hasNewDate(p.r) ? applyPromise(p.l, p.r.proposedDate!) : {};
      await db.update(tradeDocumentLines).set({
        qty: String(p.r.proposedQty), amount: String(p.calc.amount), taxAmount: String(p.calc.taxAmount), orderedBaseQty: String(p.calc.orderedBase), ...promise,
      }).where(eq(tradeDocumentLines.id, p.l.id));
    }
    await db.update(poLineRevisions).set({ decision: p.accepted ? "accepted" : "declined" }).where(eq(poLineRevisions.id, p.r.id));
  }

  const anyAccepted = plan.some(p => p.accepted);
  const fresh = await db.select({ a: tradeDocumentLines.amount, t: tradeDocumentLines.taxAmount }).from(tradeDocumentLines).where(eq(tradeDocumentLines.documentId, documentId));
  const subtotal = fresh.reduce((s, x) => s + Number(x.a), 0), tax = fresh.reduce((s, x) => s + Number(x.t), 0);
  const [doc] = await db.select().from(tradeDocuments).where(eq(tradeDocuments.id, documentId)).limit(1);
  const header: Partial<typeof tradeDocuments.$inferInsert> = { updatedAt: now };
  if (anyAccepted) {
    header.subtotal = subtotal.toFixed(2); header.taxTotal = tax.toFixed(2); header.total = (subtotal + tax).toFixed(2);
    if (!doc.confirmedAt) { header.confirmedAt = now; header.confirmedBy = actorId; header.sentAt = doc.sentAt ?? now; }
  }
  await db.update(tradeDocuments).set(header).where(eq(tradeDocuments.id, documentId));
  const reply = input.reply?.trim() || null;
  await db.update(poSupplierResponses).set({ status: anyAccepted ? "accepted" : "declined", reply, decidedBy: actorId, decidedAt: now }).where(eq(poSupplierResponses.id, resp.id));

  logEvent({ orgId, eventType: "document_edited", docType: "trade", docId: documentId, actorId, meta: { action: "po_revision_decided", accepted: plan.filter(p => p.accepted).length, kept: plan.filter(p => !p.accepted).length } })
    .catch(e => console.error("[audit] po revision decided failed:", e));
  if (reply) replyToSupplier(orgId, doc, reply).catch(e => console.error("[po] reply to supplier failed:", e));
  return { accepted: plan.filter(p => p.accepted).length, kept: plan.filter(p => !p.accepted).length, total: subtotal + tax };
}

async function replyToSupplier(orgId: string, doc: typeof tradeDocuments.$inferSelect, reply: string) {
  const [sup] = doc.partyId ? await db.select({ email: parties.email }).from(parties).where(and(eq(parties.id, doc.partyId), eq(parties.orgId, orgId))).limit(1) : [];
  if (!sup?.email) return;
  await sendEmail(orgId, { to: sup.email, subject: `Re: ${doc.docNumber ?? "Purchase order"}`, body: `<p>${esc(reply).replace(/\n/g, "<br>")}</p>` });
}
