import { db } from "@/db";
import { organisations, users, landingPageRequests, opportunities } from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { randomBytes } from "crypto";
import { sendSystemEmail, renderPasswordResetEmail, getAppUrl } from "@/lib/system-mailer";
import { logBillingEvent } from "@/lib/billing";

/**
 * Idempotent customer activation — the single path that grants app access once
 * payment is received. Safe to call multiple times (invoice.paid can fire more
 * than once): it only acts on a still-pending org/users and no-ops afterwards.
 *
 * Lifecycle rule: invoice CREATION makes a pending shell (org + user, Inactive,
 * no access, no email). PAYMENT calls this to activate + send the set-password
 * invite. Must be called from every payment-success path (invoice.paid webhook,
 * checkout.session.completed, manual admin activation).
 */
export async function activateOrgOnPayment(orgId: string): Promise<{ activated: boolean; invited: number }> {
  if (!orgId) return { activated: false, invited: 0 };

  const [org] = await db.select({ id: organisations.id, status: organisations.status }).from(organisations).where(eq(organisations.id, orgId)).limit(1);
  if (!org) return { activated: false, invited: 0 };

  const wasPending = org.status !== "Active";
  if (wasPending) {
    await db.update(organisations).set({ status: "Active", updatedAt: new Date() }).where(eq(organisations.id, orgId));
  }

  // Activate + invite any still-pending users for this org (idempotent: only
  // touches users that aren't Active yet, so re-runs send no duplicate invites).
  const pending = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(users).where(and(eq(users.orgId, orgId), ne(users.status, "Active")));

  let invited = 0;
  for (const u of pending) {
    const resetToken = randomBytes(32).toString("hex");
    await db.update(users).set({ status: "Active", resetToken, resetTokenExpiry: new Date(Date.now() + 72 * 60 * 60 * 1000) }).where(eq(users.id, u.id));
    try {
      await sendSystemEmail({
        to: u.email,
        subject: "Your Prime Accountax account is ready — set your password",
        html: renderPasswordResetEmail({ name: u.name, resetUrl: `${getAppUrl()}/reset-password?token=${resetToken}` }),
      });
      invited++;
    } catch { /* activation stands even if the email transport fails */ }
  }

  // Mark the linked CRM lead/opportunity as won-customer (best-effort).
  try {
    const [opp] = await db.select({ id: opportunities.id, leadId: opportunities.leadId }).from(opportunities).where(eq(opportunities.orgId, orgId)).limit(1);
    if (opp?.leadId) {
      await db.update(landingPageRequests).set({ status: "converted", updatedAt: new Date() }).where(eq(landingPageRequests.id, opp.leadId));
    }
  } catch { /* non-fatal */ }

  if (wasPending || invited > 0) {
    try { await logBillingEvent({ organizationId: orgId, action: "organisation_activated", metadata: { invited } }); } catch {}
  }
  return { activated: wasPending, invited };
}

/** Resolve the orgId for a Stripe customer (metadata.orgId, set at customer creation). */
export async function orgIdForStripeCustomer(customer: any): Promise<string | null> {
  const meta = customer?.metadata?.orgId;
  return typeof meta === "string" && meta ? meta : null;
}
