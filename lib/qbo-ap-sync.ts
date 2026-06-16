/**
 * QBO Accounts Payable sync.
 * Syncs Vendors, Chart of Accounts, Items, Tax Rates, Dimensions (Class/Dept),
 * and Bills (with line items) from QuickBooks Online into the AP tables.
 *
 * Usage:
 *   import { runQboApSync } from "@/lib/qbo-ap-sync";
 *   const result = await runQboApSync(orgId, userId);
 */

import { db } from "@/db";
import {
  apSuppliers,
  apAccounts,
  apItems,
  apTaxRates,
  apDimensions,
  apBills,
  apBillLines,
  qboTokens,
  organisations,
} from "@/db/schema";
import { getValidToken } from "@/lib/qbo-sync";
import { eq, and, sql } from "drizzle-orm";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry a DB operation on transient Neon serverless errors ("fetch failed",
 * connection terminated, etc.). At this scale (thousands of bills) the HTTP
 * driver intermittently drops connections under load; a short backoff recovers.
 */
async function withRetry<T>(fn: () => Promise<T>, label = "db", attempts = 4): Promise<T> {
  let lastErr: any;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e: any) {
      lastErr = e;
      const msg = String(e?.message ?? e);
      const transient =
        /fetch failed|connection|terminat|ECONNRESET|ETIMEDOUT|socket|network/i.test(msg);
      if (!transient || i === attempts - 1) throw e;
      await sleep(250 * Math.pow(2, i)); // 250ms, 500ms, 1s
    }
  }
  throw lastErr;
}

// ─── result type ────────────────────────────────────────────────────────────

export interface QboApSyncResult {
  vendorsCreated: number;
  vendorsUpdated: number;
  accountsUpserted: number;
  itemsUpserted: number;
  taxRatesUpserted: number;
  dimensionsUpserted: number;
  billsCreated: number;
  billsUpdated: number;
  errors: string[];
}

// ─── api helper ─────────────────────────────────────────────────────────────

async function qboFetch(path: string, accessToken: string, realmId: string): Promise<any> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${QBO_API}/${realmId}/${path}${sep}minorversion=65`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`QBO AP ${res.status} ${path}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

async function qboQuery(
  accessToken: string,
  realmId: string,
  querySql: string
): Promise<any> {
  return qboFetch(
    `query?query=${encodeURIComponent(querySql)}`,
    accessToken,
    realmId
  );
}

/** Paginated query — fetches all pages for a given entity + optional WHERE clause. */
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
    const data = await qboQuery(
      accessToken,
      realmId,
      `SELECT * FROM ${entity}${whereClause} STARTPOSITION ${start} MAXRESULTS ${pageSize}`
    );
    const records: any[] = data?.QueryResponse?.[entity] ?? [];
    all.push(...records);
    if (records.length < pageSize) break;
    start += pageSize;
    await sleep(300);
  }
  return all;
}

// ─── upsert helpers ──────────────────────────────────────────────────────────

/**
 * Generic upsert on (orgId, externalId, source) for apAccounts / apItems /
 * apTaxRates / apDimensions — all share `ap_xxx_org_ext_unique` style constraints.
 */
async function upsertOnOrgExtSource(
  table: typeof apAccounts | typeof apItems | typeof apTaxRates,
  row: Record<string, any>,
  updateFields: Record<string, any>
): Promise<void> {
  await (db.insert(table) as any)
    .values(row)
    .onConflictDoUpdate({
      target: [(table as any).orgId, (table as any).externalId, (table as any).source],
      set: updateFields,
    });
}

async function upsertDimension(
  row: Record<string, any>,
  updateFields: Record<string, any>
): Promise<void> {
  await db
    .insert(apDimensions)
    .values(row as any)
    .onConflictDoUpdate({
      target: [
        apDimensions.orgId,
        apDimensions.externalId,
        apDimensions.source,
        apDimensions.dimensionType,
      ],
      set: updateFields,
    });
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function runQboApSync(
  orgId: string,
  userId: string
): Promise<QboApSyncResult> {
  const errors: string[] = [];

  // ── 1. Token ──────────────────────────────────────────────────────────────
  const token = await getValidToken(orgId);
  if (!token) throw new Error("QuickBooks not connected");

  const [qboTokenRow] = await db
    .select({ realmId: qboTokens.realmId })
    .from(qboTokens)
    .where(eq(qboTokens.orgId, orgId))
    .limit(1);

  if (!qboTokenRow?.realmId) throw new Error("QuickBooks realmId not found");

  const { accessToken } = token;
  const realmId = qboTokenRow.realmId;

  const result: QboApSyncResult = {
    vendorsCreated: 0,
    vendorsUpdated: 0,
    accountsUpserted: 0,
    itemsUpserted: 0,
    taxRatesUpserted: 0,
    dimensionsUpserted: 0,
    billsCreated: 0,
    billsUpdated: 0,
    errors,
  };

  // ── 2. Vendors → ap_suppliers ─────────────────────────────────────────────
  // IMPORTANT: QBO's default Vendor query returns ACTIVE vendors only. Many
  // bills reference vendors that have since been made inactive/merged, so we
  // must explicitly include inactive vendors or those bills can never link to a
  // supplier (they'd show "Unknown"). Fetch both and merge.
  try {
    let vendors = await qboFetchAll(accessToken, realmId, "Vendor", "Active IN (true, false)");
    await sleep(300);
    // Fallback for QBO accounts that reject the combined Active filter
    if (vendors.length === 0) {
      const active = await qboFetchAll(accessToken, realmId, "Vendor");
      await sleep(200);
      let inactive: any[] = [];
      try {
        inactive = await qboFetchAll(accessToken, realmId, "Vendor", "Active = false");
      } catch (e: any) {
        errors.push(`Inactive vendors fetch failed: ${e?.message ?? String(e)}`);
      }
      vendors = [...active, ...inactive];
      await sleep(300);
    }

    // Batch the upserts (could be ~2k vendors incl. inactive) so we don't
    // saturate the connection pool and trip the function timeout.
    const VENDOR_BATCH = 25;
    const vendorResults: PromiseSettledResult<void>[] = [];
    for (let vi = 0; vi < vendors.length; vi += VENDOR_BATCH) {
      const vchunk = vendors.slice(vi, vi + VENDOR_BATCH);
      const vchunkResults = await Promise.allSettled(
      vchunk.map(async (v: any) => {
        try {
          const address = [
            v.BillAddr?.Line1,
            v.BillAddr?.City,
            v.BillAddr?.CountrySubDivisionCode,
            v.BillAddr?.PostalCode,
          ]
            .filter(Boolean)
            .join(", ");

          const payload = {
            orgId,
            name:
              v.DisplayName ||
              v.PrintOnCheckName ||
              v.CompanyName ||
              `Vendor-${v.Id}`,
            displayName: v.DisplayName ?? null,
            email: v.PrimaryEmailAddr?.Address ?? null,
            phone: v.PrimaryPhone?.FreeFormNumber ?? null,
            address: address || null,
            country: v.BillAddr?.Country ?? null,
            currency: v.CurrencyRef?.value ?? "USD",
            taxNumber: v.TaxIdentifier ?? null,
            status: v.Active === false ? "Inactive" : "Active",
            source: "qbo",
            qboId: v.Id,
            lastSyncedAt: new Date(),
            updatedAt: new Date(),
          };

          // Check-then-insert/update because ap_suppliers has no unique index on (orgId, qboId)
          const [existing] = await withRetry(
            () =>
              db
                .select({ id: apSuppliers.id })
                .from(apSuppliers)
                .where(and(eq(apSuppliers.orgId, orgId), eq(apSuppliers.qboId, v.Id)))
                .limit(1),
            `find-vendor-${v.Id}`
          );

          if (existing) {
            await withRetry(
              () => db.update(apSuppliers).set(payload).where(eq(apSuppliers.id, existing.id)),
              `update-vendor-${v.Id}`
            );
            result.vendorsUpdated++;
          } else {
            await withRetry(
              () => db.insert(apSuppliers).values({ ...payload, riskRating: "Low", paymentTerms: 30 }),
              `insert-vendor-${v.Id}`
            );
            result.vendorsCreated++;
          }
        } catch (e: any) {
          throw new Error(`Vendor ${v.Id}: ${e?.message ?? String(e)}`);
        }
      })
      );
      vendorResults.push(...vchunkResults);
    }

    for (const r of vendorResults) {
      if (r.status === "rejected") {
        errors.push(r.reason?.message ?? String(r.reason));
      }
    }
  } catch (e: any) {
    errors.push(`Vendors fetch failed: ${e?.message ?? String(e)}`);
  }

  // ── 3. Chart of Accounts → ap_accounts ───────────────────────────────────
  try {
    const accounts = await qboFetchAll(
      accessToken,
      realmId,
      "Account",
      `AccountType IN ('Cost of Goods Sold', 'Expense', 'Other Expense', 'Fixed Asset', 'Other Asset', 'Accounts Payable')`,
      1000
    );
    await sleep(300);

    const accountResults = await Promise.allSettled(
      accounts.map(async (acc: any) => {
        const now = new Date();
        const row = {
          orgId,
          externalId: acc.Id,
          source: "qbo",
          code: acc.AcctNum ?? null,
          name: acc.Name,
          type: acc.AccountType ?? null,
          subtype: acc.AccountSubType ?? null,
          status: acc.Active === false ? "Inactive" : "Active",
          raw: acc,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        const updateFields = {
          code: row.code,
          name: row.name,
          type: row.type,
          subtype: row.subtype,
          status: row.status,
          raw: row.raw,
          lastSyncedAt: row.lastSyncedAt,
          updatedAt: row.updatedAt,
        };
        await db
          .insert(apAccounts)
          .values(row as any)
          .onConflictDoUpdate({
            target: [apAccounts.orgId, apAccounts.externalId, apAccounts.source],
            set: updateFields,
          });
        result.accountsUpserted++;
      })
    );

    for (const r of accountResults) {
      if (r.status === "rejected") {
        errors.push(`Account upsert: ${r.reason?.message ?? String(r.reason)}`);
      }
    }
  } catch (e: any) {
    errors.push(`Accounts fetch failed: ${e?.message ?? String(e)}`);
  }

  // ── 4. Items → ap_items ───────────────────────────────────────────────────
  try {
    const items = await qboFetchAll(
      accessToken,
      realmId,
      "Item",
      `Type IN ('Service', 'NonInventory', 'Inventory')`
    );
    await sleep(300);

    const itemResults = await Promise.allSettled(
      items.map(async (item: any) => {
        const now = new Date();
        const row = {
          orgId,
          externalId: item.Id,
          source: "qbo",
          code: item.Sku ?? null,
          name: item.Name,
          description: item.Description ?? null,
          purchaseAccountId: item.ExpenseAccountRef?.value ?? null,
          expenseAccountId: item.ExpenseAccountRef?.value ?? null,
          unitCost: item.PurchaseCost != null ? parseFloat(item.PurchaseCost) : null,
          status: item.Active === false ? "Inactive" : "Active",
          raw: item,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        const updateFields = {
          code: row.code,
          name: row.name,
          description: row.description,
          purchaseAccountId: row.purchaseAccountId,
          expenseAccountId: row.expenseAccountId,
          unitCost: row.unitCost,
          status: row.status,
          raw: row.raw,
          lastSyncedAt: row.lastSyncedAt,
          updatedAt: row.updatedAt,
        };
        await db
          .insert(apItems)
          .values(row as any)
          .onConflictDoUpdate({
            target: [apItems.orgId, apItems.externalId, apItems.source],
            set: updateFields,
          });
        result.itemsUpserted++;
      })
    );

    for (const r of itemResults) {
      if (r.status === "rejected") {
        errors.push(`Item upsert: ${r.reason?.message ?? String(r.reason)}`);
      }
    }
  } catch (e: any) {
    errors.push(`Items fetch failed: ${e?.message ?? String(e)}`);
  }

  // ── 5. Tax Rates → ap_tax_rates ───────────────────────────────────────────
  try {
    const taxRates = await qboFetchAll(accessToken, realmId, "TaxRate", "", 200);
    await sleep(300);

    const taxResults = await Promise.allSettled(
      taxRates.map(async (tr: any) => {
        const now = new Date();
        const row = {
          orgId,
          externalId: tr.Id,
          source: "qbo",
          name: tr.Name,
          rate: tr.RateValue != null ? parseFloat(tr.RateValue) : null,
          taxType: tr.TaxType ?? "Standard",
          status: tr.Active === false ? "Inactive" : "Active",
          raw: tr,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        const updateFields = {
          name: row.name,
          rate: row.rate,
          taxType: row.taxType,
          status: row.status,
          raw: row.raw,
          lastSyncedAt: row.lastSyncedAt,
          updatedAt: row.updatedAt,
        };
        await db
          .insert(apTaxRates)
          .values(row as any)
          .onConflictDoUpdate({
            target: [apTaxRates.orgId, apTaxRates.externalId, apTaxRates.source],
            set: updateFields,
          });
        result.taxRatesUpserted++;
      })
    );

    for (const r of taxResults) {
      if (r.status === "rejected") {
        errors.push(`TaxRate upsert: ${r.reason?.message ?? String(r.reason)}`);
      }
    }
  } catch (e: any) {
    errors.push(`TaxRates fetch failed: ${e?.message ?? String(e)}`);
  }

  // ── 6. Dimensions (Class + Department) → ap_dimensions ────────────────────
  const dimensionSources: Array<{ entity: string; dimensionType: string }> = [
    { entity: "Class", dimensionType: "Class" },
    { entity: "Department", dimensionType: "Department" },
  ];

  for (const { entity, dimensionType } of dimensionSources) {
    try {
      const items = await qboFetchAll(accessToken, realmId, entity, "", 200);
      await sleep(200);

      const dimResults = await Promise.allSettled(
        items.map(async (ent: any) => {
          const now = new Date();
          const row = {
            orgId,
            externalId: ent.Id,
            source: "qbo",
            dimensionType,
            name: ent.Name,
            code: ent.FullyQualifiedName ?? null,
            parentId: ent.ParentRef?.value ?? null,
            status: ent.Active === false ? "Inactive" : "Active",
            raw: ent,
            lastSyncedAt: now,
            createdAt: now,
            updatedAt: now,
          };
          const updateFields = {
            name: row.name,
            code: row.code,
            parentId: row.parentId,
            status: row.status,
            raw: row.raw,
            lastSyncedAt: row.lastSyncedAt,
            updatedAt: row.updatedAt,
          };
          await upsertDimension(row, updateFields);
          result.dimensionsUpserted++;
        })
      );

      for (const r of dimResults) {
        if (r.status === "rejected") {
          errors.push(
            `Dimension (${dimensionType}) upsert: ${r.reason?.message ?? String(r.reason)}`
          );
        }
      }
    } catch (e: any) {
      errors.push(
        `Dimensions (${dimensionType}) fetch failed: ${e?.message ?? String(e)}`
      );
    }
  }

  // ── 7. Bills → ap_bills + ap_bill_lines ───────────────────────────────────
  try {
    const bills = await qboFetchAll(accessToken, realmId, "Bill", "", 200);
    await sleep(300);

    // Resolve suppliers up-front. Build a qboId → supplierId map for the org,
    // then auto-create a minimal supplier for any vendor a bill references that
    // wasn't synced (e.g. vendors QBO marks inactive and omits from the Vendor
    // query). Done sequentially BEFORE the concurrent bill loop so we never race
    // two inserts for the same vendor (ap_suppliers has no unique qboId index).
    const supplierRows = await db
      .select({ id: apSuppliers.id, qboId: apSuppliers.qboId })
      .from(apSuppliers)
      .where(eq(apSuppliers.orgId, orgId));
    const supplierByQbo = new Map<string, string>();
    for (const s of supplierRows) {
      if (s.qboId) supplierByQbo.set(s.qboId, s.id);
    }

    const missingVendors = new Map<string, string>(); // qboId → name
    for (const bill of bills) {
      const vId = bill.VendorRef?.value;
      if (vId && !supplierByQbo.has(vId)) {
        missingVendors.set(vId, bill.VendorRef?.name ?? `Vendor-${vId}`);
      }
    }
    for (const [vId, name] of missingVendors) {
      try {
        const [created] = await withRetry(
          () =>
            db
              .insert(apSuppliers)
              .values({
                orgId,
                name,
                source: "qbo",
                qboId: vId,
                status: "Active",
                riskRating: "Low",
                paymentTerms: 30,
                currency: "USD",
                lastSyncedAt: new Date(),
              })
              .returning({ id: apSuppliers.id }),
          `auto-create-vendor-${vId}`
        );
        supplierByQbo.set(vId, created.id);
        result.vendorsCreated++;
      } catch (e: any) {
        errors.push(`Auto-create vendor ${vId}: ${e?.message ?? String(e)}`);
      }
    }

    // Bulk-load existing bills ONCE into a map (id + workflowStatus keyed by
    // qboId) instead of a per-bill SELECT. At ~8k bills that removes ~8k HTTP
    // round-trips per sync — the main cause of Neon "fetch failed" exhaustion.
    const existingBillRows = await withRetry(
      () =>
        db
          .select({ id: apBills.id, qboId: apBills.qboId, workflowStatus: apBills.workflowStatus })
          .from(apBills)
          .where(eq(apBills.orgId, orgId)),
      "load-existing-bills"
    );
    const existingByQbo = new Map<string, { id: string; workflowStatus: string }>();
    for (const b of existingBillRows) {
      if (b.qboId) existingByQbo.set(b.qboId, { id: b.id, workflowStatus: b.workflowStatus });
    }

    // Process bills in bounded batches so we don't saturate the connection pool
    // (each bill does several round-trips); all-at-once risked timeouts/drops.
    const BATCH = 8;
    const billResults: PromiseSettledResult<void>[] = [];
    for (let i = 0; i < bills.length; i += BATCH) {
      const chunk = bills.slice(i, i + BATCH);
      const chunkResults = await Promise.allSettled(
      chunk.map(async (bill: any) => {
        try {
          // Resolve supplier from the pre-built map (no per-bill query)
          const supplierId = bill.VendorRef?.value
            ? supplierByQbo.get(bill.VendorRef.value) ?? null
            : null;

          const total = parseFloat(bill.TotalAmt) || 0;
          const balance = parseFloat(bill.Balance) || 0;
          const amountPaid = Math.max(0, total - balance);

          const accountingPaymentStatus =
            balance === 0
              ? "Paid"
              : balance < total
              ? "Partially Paid"
              : "Unpaid";

          // Look up existing bill from the pre-built map (no per-bill query)
          const existing = existingByQbo.get(bill.Id);

          // Preserve non-default workflowStatus; reset only if it was the sync default
          const workflowStatus =
            existing && existing.workflowStatus !== "Synced from Accounting"
              ? existing.workflowStatus
              : "Synced from Accounting";

          const billPayload = {
            orgId,
            supplierId,
            billNumber: bill.DocNumber ?? null,
            reference: bill.DocNumber ?? null,
            billDate: bill.TxnDate ?? null,
            dueDate: bill.DueDate ?? null,
            currency: bill.CurrencyRef?.value ?? "USD",
            subtotal: parseFloat(bill.SubTotalAmt) || 0,
            taxTotal: parseFloat(bill.TxnTaxDetail?.TotalTax) || 0,
            total,
            amountPaid,
            balance,
            accountingPaymentStatus,
            workflowStatus,
            qboId: bill.Id,
            source: "qbo",
            privateNote: bill.PrivateNote ?? null,
            lastSyncAt: new Date(),
            updatedAt: new Date(),
          };

          let billId: string;

          if (existing) {
            await withRetry(
              () => db.update(apBills).set(billPayload).where(eq(apBills.id, existing.id)),
              `update-bill-${bill.Id}`
            );
            billId = existing.id;
            result.billsUpdated++;
          } else {
            const [inserted] = await withRetry(
              () => db.insert(apBills).values(billPayload).returning({ id: apBills.id }),
              `insert-bill-${bill.Id}`
            );
            billId = inserted.id;
            result.billsCreated++;
          }

          // Re-insert all lines (delete + insert for idempotency)
          await withRetry(
            () => db.delete(apBillLines).where(eq(apBillLines.billId, billId)),
            `delete-lines-${bill.Id}`
          );

          const lines: any[] = (bill.Line ?? []).filter(
            (l: any) =>
              l.DetailType === "AccountBasedExpenseLineDetail" ||
              l.DetailType === "ItemBasedExpenseLineDetail"
          );

          if (lines.length > 0) {
            const lineRows = lines.map((line: any, idx: number) => {
              const acctDetail = line.AccountBasedExpenseLineDetail;
              const itemDetail = line.ItemBasedExpenseLineDetail;
              const detail = acctDetail ?? itemDetail;
              const quantity =
                detail?.Qty != null ? parseFloat(detail.Qty) : 1;
              const unitPrice =
                detail?.UnitPrice != null
                  ? parseFloat(detail.UnitPrice)
                  : parseFloat(line.Amount) || 0;
              const lineTotal = parseFloat(line.Amount) || 0;
              const taxAmount =
                parseFloat(line.TaxAmount) || 0;

              return {
                orgId,
                billId,
                lineNumber: idx + 1,
                itemId: itemDetail?.ItemRef?.value ?? null,
                description: line.Description ?? null,
                quantity,
                unitPrice,
                accountId: acctDetail?.AccountRef?.value ?? null,
                lineSubtotal: lineTotal - taxAmount,
                lineTax: taxAmount,
                lineTotal,
              };
            });

            await withRetry(() => db.insert(apBillLines).values(lineRows), `insert-lines-${bill.Id}`);
          }
        } catch (e: any) {
          throw new Error(`Bill ${bill.Id}: ${e?.message ?? String(e)}`);
        }
      })
      );
      billResults.push(...chunkResults);
      await sleep(150);
    }

    for (const r of billResults) {
      if (r.status === "rejected") {
        errors.push(r.reason?.message ?? String(r.reason));
      }
    }
  } catch (e: any) {
    errors.push(`Bills fetch failed: ${e?.message ?? String(e)}`);
  }

  return result;
}
