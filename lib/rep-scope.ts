/**
 * Server-side rep visibility scope.
 *
 * Reps are confined to the rep portal (see middleware.ts) and must only see
 * their own book of business. The portal already filters client-side, but the
 * data endpoints previously returned the WHOLE org — so a rep could read every
 * customer/invoice via the network tab. This helper recomputes the same
 * ownership rule on the server so the API never ships out-of-scope rows.
 *
 * Ownership rule (mirrors the rep portal):
 *   - visible reps = self, plus direct reports (managerId === self) for rd/ed tiers
 *   - an invoice is visible if: projectId ? its project is rep-owned
 *                                          : its customer is rep-owned
 *   - the customer/project sets are then expanded to include any entity
 *     referenced by a visible invoice, so name lookups still resolve
 *
 * Returns null for unrestricted callers (admins/accountants, or any user with
 * no rep linkage) — callers should skip filtering when null.
 */
import { db } from "@/db";
import { reps, customers, projects, invoices } from "@/db/schema";
import { and, eq } from "drizzle-orm";

export interface RepScope {
  customerIds: Set<string>;
  projectIds: Set<string>;
  invoiceIds: Set<string>;
}

export async function getRepScope(
  orgId: string,
  role: string | null,
  repId: string | null,
): Promise<RepScope | null> {
  if (role !== "rep" || !repId) return null;

  // visible rep ids: self + direct reports for manager tiers
  const [self] = await db
    .select({ id: reps.id, tier: reps.tier })
    .from(reps)
    .where(and(eq(reps.id, repId), eq(reps.orgId, orgId)))
    .limit(1);
  const visibleReps = new Set<string>([repId]);
  if (self && (self.tier === "rd" || self.tier === "ed")) {
    const reports = await db
      .select({ id: reps.id })
      .from(reps)
      .where(and(eq(reps.orgId, orgId), eq(reps.managerId, repId)));
    for (const r of reports) visibleReps.add(r.id);
  }

  const [custRows, projRows, invRows] = await Promise.all([
    db.select({ id: customers.id, repId: customers.repId }).from(customers).where(eq(customers.orgId, orgId)),
    db.select({ id: projects.id, repId: projects.repId }).from(projects).where(eq(projects.orgId, orgId)),
    db.select({ id: invoices.id, customerId: invoices.customerId, projectId: invoices.projectId }).from(invoices).where(eq(invoices.orgId, orgId)),
  ]);

  const ownedCustomers = new Set(custRows.filter((c) => c.repId && visibleReps.has(c.repId)).map((c) => c.id));
  const ownedProjects = new Set(projRows.filter((p) => p.repId && visibleReps.has(p.repId)).map((p) => p.id));

  const customerIds = new Set(ownedCustomers);
  const projectIds = new Set(ownedProjects);
  const invoiceIds = new Set<string>();
  for (const i of invRows) {
    const visible = i.projectId ? ownedProjects.has(i.projectId) : ownedCustomers.has(i.customerId);
    if (!visible) continue;
    invoiceIds.add(i.id);
    customerIds.add(i.customerId); // keep referenced entities so names resolve
    if (i.projectId) projectIds.add(i.projectId);
  }

  return { customerIds, projectIds, invoiceIds };
}
