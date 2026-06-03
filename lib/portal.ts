/**
 * Customer Response Portal — shared helpers.
 *
 * Token lifecycle: one token = one emailed request covering a snapshot of the
 * customer's open invoices. Customer responds once; submitting marks it
 * Completed and the link dies. A new request issues a fresh token.
 */

import { randomBytes } from "crypto";
import { db } from "@/db";
import {
  customerPortalTokens, invoicePromises, invoiceDisputes, invoices,
} from "@/db/schema";
import { and, eq, desc } from "drizzle-orm";

const TOKEN_TTL_DAYS = 30;

/** Resolve the public base URL for building portal links. */
export function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Create a new single-use portal token for a customer + invoice snapshot. */
export async function createPortalToken(
  orgId: string,
  customerId: string,
  invoiceIds: string[],
  createdBy: string | null,
): Promise<{ token: string; url: string }> {
  const token = randomBytes(32).toString("base64url"); // url-safe, ~43 chars
  const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000);

  await db.insert(customerPortalTokens).values({
    orgId, customerId, token, invoiceIds, createdBy, expiresAt,
  });

  return { token, url: `${getAppUrl()}/portal/${token}` };
}

export type TokenValidation =
  | { ok: true;  row: typeof customerPortalTokens.$inferSelect }
  | { ok: false; reason: "not_found" | "completed" | "expired" };

/** Validate a token string — checks existence, status, and expiry. */
export async function validatePortalToken(token: string): Promise<TokenValidation> {
  const [row] = await db
    .select()
    .from(customerPortalTokens)
    .where(eq(customerPortalTokens.token, token))
    .limit(1);

  if (!row) return { ok: false, reason: "not_found" };
  if (row.status === "Completed") return { ok: false, reason: "completed" };
  if (row.status === "Expired" || new Date(row.expiresAt).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, row };
}

/**
 * Recompute and cache an invoice's derived promise/dispute state.
 * Call after any promise or dispute row is inserted/updated.
 *
 * Rules (per agreed design):
 *  - Current promise = most-recent Active promise (latest wins).
 *  - hasOpenDispute = any dispute with status Open/Under Review.
 *  - automationsPaused mirrors hasOpenDispute (disputes auto-pause chasing).
 */
// Stage keys this function manages automatically. We only ever auto-revert
// THESE — a manually-set stage like "Escalated" or "Reminder Sent" is left alone.
const MANAGED_STAGES = new Set(["Disputed", "Promised", "Promise to Pay"]);

export async function recomputeInvoiceState(orgId: string, invoiceId: string) {
  // Latest active promise
  const [promise] = await db
    .select()
    .from(invoicePromises)
    .where(and(
      eq(invoicePromises.orgId, orgId),
      eq(invoicePromises.invoiceId, invoiceId),
      eq(invoicePromises.status, "Active"),
    ))
    .orderBy(desc(invoicePromises.createdAt))
    .limit(1);

  // Open disputes (newest first — used for the legacy cache fields too)
  const openDisputeRows = await db
    .select({ id: invoiceDisputes.id, status: invoiceDisputes.status, reason: invoiceDisputes.reason, category: invoiceDisputes.category, createdAt: invoiceDisputes.createdAt })
    .from(invoiceDisputes)
    .where(and(
      eq(invoiceDisputes.orgId, orgId),
      eq(invoiceDisputes.invoiceId, invoiceId),
    ))
    .orderBy(desc(invoiceDisputes.createdAt));
  const openOnes = openDisputeRows.filter(d => d.status === "Open" || d.status === "Under Review");
  const hasOpen = openOnes.length > 0;
  const latestOpen = openOnes[0];

  // Current stage/payment status — needed to drive the Collections Board.
  const [inv] = await db
    .select({ collectionStage: invoices.collectionStage, paymentStatus: invoices.paymentStatus })
    .from(invoices)
    .where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)))
    .limit(1);

  // ── Collection-stage sync (so the board reflects portal responses) ────────
  // Disputes win over promises. We never touch paid/closed invoices, and we
  // only auto-revert a stage WE manage (so manual stages survive).
  const stagePatch: Record<string, any> = {};
  if (inv && inv.paymentStatus !== "Paid" && inv.collectionStage !== "Closed") {
    const target = hasOpen ? "Disputed" : promise ? "Promised" : null;
    if (target) {
      if (inv.collectionStage !== target) stagePatch.collectionStage = target;
    } else if (MANAGED_STAGES.has(inv.collectionStage)) {
      stagePatch.collectionStage = "New"; // nothing open anymore — back to the funnel
    }
  }

  await db.update(invoices).set({
    promiseDate:       promise?.promiseDate ?? null,
    promiseAmount:     promise?.amount ?? null,
    promiseSource:     promise?.source ?? null,
    hasOpenDispute:    hasOpen,
    automationsPaused: hasOpen,
    // Keep legacy single-field dispute cache in sync so older UI stays correct
    disputeReason: hasOpen ? (latestOpen?.reason || latestOpen?.category || "Disputed") : null,
    disputeDate:   hasOpen && latestOpen ? new Date(latestOpen.createdAt as any).toISOString().slice(0, 10) : null,
    ...stagePatch,
    updatedAt: new Date(),
  }).where(and(eq(invoices.id, invoiceId), eq(invoices.orgId, orgId)));
}

export const DISPUTE_CATEGORIES = [
  "Wrong Amount",
  "Already Paid",
  "Goods/Service",
  "Duplicate",
  "Other",
] as const;
