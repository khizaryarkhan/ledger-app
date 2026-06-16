/**
 * GET /api/payables/_diagnose
 * Read-only diagnostic for the "Unknown supplier" / missing-bills issue.
 * Reports DB link health and re-queries QBO for a few unlinked bills so we can
 * see their actual VendorRef. Admin-only. Writes nothing.
 */
import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apBills, apSuppliers, qboTokens } from "@/db/schema";
import { getValidToken } from "@/lib/qbo-sync";
import { eq, and, isNull, isNotNull, sql } from "drizzle-orm";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

export async function GET() {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (role !== "company_admin" && !isSuperAdmin(session)) return bad("Forbidden", 403);

  // ── DB health ──────────────────────────────────────────────────────────────
  const [{ count: billsTotal }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apBills)
    .where(eq(apBills.orgId, orgId!));

  const [{ count: billsUnlinked }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apBills)
    .where(and(eq(apBills.orgId, orgId!), isNull(apBills.supplierId)));

  const [{ count: suppliersTotal }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apSuppliers)
    .where(eq(apSuppliers.orgId, orgId!));

  const [{ count: suppliersWithQbo }] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(apSuppliers)
    .where(and(eq(apSuppliers.orgId, orgId!), isNotNull(apSuppliers.qboId)));

  // Sample of unlinked bills (their QBO ids)
  const unlinkedSample = await db
    .select({ id: apBills.id, billNumber: apBills.billNumber, qboId: apBills.qboId, source: apBills.source })
    .from(apBills)
    .where(and(eq(apBills.orgId, orgId!), isNull(apBills.supplierId)))
    .limit(10);

  // ── Live QBO lookup for those bills ─────────────────────────────────────────
  const qboBillProbe: any[] = [];
  let qboError: string | null = null;
  try {
    const token = await getValidToken(orgId!);
    const [tokRow] = await db
      .select({ realmId: qboTokens.realmId })
      .from(qboTokens)
      .where(eq(qboTokens.orgId, orgId!))
      .limit(1);

    if (token && tokRow?.realmId) {
      const realmId = tokRow.realmId;
      for (const b of unlinkedSample) {
        if (!b.qboId) {
          qboBillProbe.push({ billNumber: b.billNumber, qboId: null, note: "bill has no qboId (likely not QBO-sourced)" });
          continue;
        }
        const url = `${QBO_API}/${realmId}/bill/${b.qboId}?minorversion=65`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
        });
        if (!res.ok) {
          qboBillProbe.push({ billNumber: b.billNumber, qboId: b.qboId, qboStatus: res.status });
          continue;
        }
        const json = await res.json();
        const vendorRef = json?.Bill?.VendorRef ?? null;

        // Does a supplier with this vendor qboId exist in our DB?
        let supplierExists = false;
        if (vendorRef?.value) {
          const [sup] = await db
            .select({ id: apSuppliers.id })
            .from(apSuppliers)
            .where(and(eq(apSuppliers.orgId, orgId!), eq(apSuppliers.qboId, vendorRef.value)))
            .limit(1);
          supplierExists = !!sup;
        }

        qboBillProbe.push({
          billNumber: b.billNumber,
          qboId: b.qboId,
          vendorRef: vendorRef ? { value: vendorRef.value, name: vendorRef.name } : null,
          supplierWithThatQboIdExists: supplierExists,
        });
      }
    } else {
      qboError = "QBO not connected or realmId missing";
    }
  } catch (e: any) {
    qboError = e?.message ?? String(e);
  }

  return ok({
    db: {
      billsTotal,
      billsUnlinked,
      billsLinked: billsTotal - billsUnlinked,
      suppliersTotal,
      suppliersWithQbo,
    },
    unlinkedSample,
    qboError,
    qboBillProbe,
    interpretation:
      "If qboBillProbe rows have a vendorRef.value but supplierWithThatQboIdExists=false, " +
      "the vendor was never synced (the auto-create fix handles this on next sync). " +
      "If vendorRef is null, these bills carry no vendor in QBO. " +
      "If qboId is null, the bills aren't QBO-sourced.",
  });
}
