/**
 * POST /api/payables/relink-suppliers
 * Fast, targeted backfill: pulls ALL QBO vendors (incl. inactive), upserts them
 * as suppliers, then relinks existing unlinked bills to suppliers by vendor id.
 * Does NOT re-import bill line items, so it's far faster than a full sync.
 * Admin-only. Also accepts GET so it can be triggered from a browser.
 */
import { requireOrg, ok, bad, isSuperAdmin } from "@/lib/api";
import { db } from "@/db";
import { apSuppliers, apBills, qboTokens } from "@/db/schema";
import { getValidToken } from "@/lib/qbo-sync";
import { eq, and, isNull, inArray } from "drizzle-orm";

export const maxDuration = 300;

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function qboFetchAll(
  accessToken: string,
  realmId: string,
  entity: string,
  where = "",
  pageSize = 500
): Promise<any[]> {
  const whereClause = where ? ` WHERE ${where}` : "";
  const all: any[] = [];
  let start = 1;
  while (true) {
    const q = `SELECT * FROM ${entity}${whereClause} STARTPOSITION ${start} MAXRESULTS ${pageSize}`;
    const url = `${QBO_API}/${realmId}/query?query=${encodeURIComponent(q)}&minorversion=65`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`QBO ${res.status} ${entity}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    const records: any[] = data?.QueryResponse?.[entity] ?? [];
    all.push(...records);
    if (records.length < pageSize) break;
    start += pageSize;
    await sleep(300);
  }
  return all;
}

async function run(orgId: string) {
  const token = await getValidToken(orgId);
  if (!token) return bad("QuickBooks not connected", 400);
  const [tokRow] = await db
    .select({ realmId: qboTokens.realmId })
    .from(qboTokens)
    .where(eq(qboTokens.orgId, orgId))
    .limit(1);
  if (!tokRow?.realmId) return bad("QuickBooks realmId not found", 400);

  const { accessToken } = token;
  const realmId = tokRow.realmId;
  const errors: string[] = [];

  // 1. Fetch ALL vendors (active + inactive)
  let vendors: any[] = [];
  try {
    vendors = await qboFetchAll(accessToken, realmId, "Vendor", "Active IN (true, false)");
  } catch {
    const active = await qboFetchAll(accessToken, realmId, "Vendor");
    let inactive: any[] = [];
    try {
      inactive = await qboFetchAll(accessToken, realmId, "Vendor", "Active = false");
    } catch (e: any) {
      errors.push(`Inactive vendors: ${e?.message ?? String(e)}`);
    }
    vendors = [...active, ...inactive];
  }

  // 2. Upsert vendors as suppliers (check-then-insert by qboId)
  const existing = await db
    .select({ id: apSuppliers.id, qboId: apSuppliers.qboId })
    .from(apSuppliers)
    .where(eq(apSuppliers.orgId, orgId));
  const supplierByQbo = new Map<string, string>();
  for (const s of existing) if (s.qboId) supplierByQbo.set(s.qboId, s.id);

  let vendorsCreated = 0;
  for (const v of vendors) {
    if (!v.Id || supplierByQbo.has(v.Id)) continue;
    try {
      const [created] = await db
        .insert(apSuppliers)
        .values({
          orgId,
          name: v.DisplayName || v.PrintOnCheckName || v.CompanyName || `Vendor-${v.Id}`,
          displayName: v.DisplayName ?? null,
          email: v.PrimaryEmailAddr?.Address ?? null,
          phone: v.PrimaryPhone?.FreeFormNumber ?? null,
          currency: v.CurrencyRef?.value ?? "USD",
          status: v.Active === false ? "Inactive" : "Active",
          source: "qbo",
          qboId: v.Id,
          riskRating: "Low",
          paymentTerms: 30,
          lastSyncedAt: new Date(),
        })
        .returning({ id: apSuppliers.id });
      supplierByQbo.set(v.Id, created.id);
      vendorsCreated++;
    } catch (e: any) {
      errors.push(`Vendor ${v.Id}: ${e?.message ?? String(e)}`);
    }
  }

  // 3. Fetch all bills from QBO → map qboBillId → vendorQboId
  const bills = await qboFetchAll(accessToken, realmId, "Bill", "", 200);
  const billVendor = new Map<string, string>();
  for (const b of bills) {
    if (b.Id && b.VendorRef?.value) billVendor.set(b.Id, b.VendorRef.value);
  }

  // 4. Relink unlinked DB bills
  const unlinked = await db
    .select({ id: apBills.id, qboId: apBills.qboId })
    .from(apBills)
    .where(and(eq(apBills.orgId, orgId), isNull(apBills.supplierId)));

  // Group bill ids by the supplier they should point to
  const bySupplier = new Map<string, string[]>();
  let noVendorRef = 0;
  let noSupplierMatch = 0;
  for (const b of unlinked) {
    const vQbo = b.qboId ? billVendor.get(b.qboId) : undefined;
    if (!vQbo) { noVendorRef++; continue; }
    const supId = supplierByQbo.get(vQbo);
    if (!supId) { noSupplierMatch++; continue; }
    if (!bySupplier.has(supId)) bySupplier.set(supId, []);
    bySupplier.get(supId)!.push(b.id);
  }

  let billsRelinked = 0;
  for (const [supId, billIds] of bySupplier) {
    for (let i = 0; i < billIds.length; i += 100) {
      const chunk = billIds.slice(i, i + 100);
      await db
        .update(apBills)
        .set({ supplierId: supId, updatedAt: new Date() })
        .where(and(eq(apBills.orgId, orgId), inArray(apBills.id, chunk)));
      billsRelinked += chunk.length;
    }
  }

  return ok({
    vendorsFetched: vendors.length,
    vendorsCreated,
    unlinkedBefore: unlinked.length,
    billsRelinked,
    stillUnlinked: unlinked.length - billsRelinked,
    skipped: { noVendorRefOnQboBill: noVendorRef, noSupplierMatch },
    errors,
  });
}

export async function POST() {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (role !== "company_admin" && !isSuperAdmin(session)) return bad("Forbidden", 403);
  return run(orgId!);
}

export async function GET() {
  const { error, orgId, role, session } = await requireOrg();
  if (error) return error;
  if (role !== "company_admin" && !isSuperAdmin(session)) return bad("Forbidden", 403);
  return run(orgId!);
}
