/**
 * Xero Accounts Payable sync.
 * Syncs Contacts (IsSupplier), Chart of Accounts, Items, Tax Rates,
 * Tracking Categories, and Bills (ACCPAY invoices with line items) from Xero
 * into the AP tables.
 *
 * Usage:
 *   import { runXeroApSync } from "@/lib/xero-ap-sync";
 *   const result = await runXeroApSync(orgId, userId);
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
  xeroTokens,
  organisations,
} from "@/db/schema";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { eq, and } from "drizzle-orm";

const XERO_API = "https://api.xero.com/api.xro/2.0";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Retry a DB op on transient Neon serverless errors ("fetch failed",
 * connection terminated, etc.) which appear under high query volume.
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
      await sleep(250 * Math.pow(2, i));
    }
  }
  throw lastErr;
}

// ─── result type ────────────────────────────────────────────────────────────

export interface XeroApSyncResult {
  vendorsCreated: number;
  vendorsUpdated: number;
  accountsUpserted: number;
  itemsUpserted: number;
  taxRatesUpserted: number;
  dimensionsUpserted: number;
  billsCreated: number;
  billsUpdated: number;
  billsSkipped: number;
  errors: string[];
}

// ─── token management ────────────────────────────────────────────────────────

async function getXeroValidToken(orgId: string) {
  const [token] = await db
    .select()
    .from(xeroTokens)
    .where(eq(xeroTokens.orgId, orgId))
    .limit(1);

  if (!token) return null;

  const refreshTokenPlain = decryptSecret(token.refreshToken);
  if (!refreshTokenPlain) {
    throw new Error(
      "Xero tokens could not be decrypted (ENCRYPTION_KEY may have been rotated). " +
        "Reconnect Xero under Settings → Integrations to re-authorise."
    );
  }

  const now = Date.now();
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 10 * 60 * 1000) {
    const clientId = process.env.XERO_CLIENT_ID!;
    const clientSecret = process.env.XERO_CLIENT_SECRET!;

    const res = await fetch("https://identity.xero.com/connect/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${clientId}:${clientSecret}`
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshTokenPlain,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Xero refresh token rejected (HTTP ${res.status}). Reconnect Xero under Settings → Integrations. Detail: ${body.slice(0, 200)}`
      );
    }

    const d = await res.json();
    const updated = {
      ...token,
      accessToken: d.access_token as string,
      refreshToken: (d.refresh_token || refreshTokenPlain) as string,
      accessTokenExpiresAt: new Date(now + (d.expires_in || 1800) * 1000),
      refreshTokenExpiresAt: new Date(now + 60 * 24 * 60 * 60 * 1000),
    };

    await db
      .update(xeroTokens)
      .set({
        accessToken: encryptSecret(updated.accessToken)!,
        refreshToken: encryptSecret(updated.refreshToken)!,
        accessTokenExpiresAt: updated.accessTokenExpiresAt,
        refreshTokenExpiresAt: updated.refreshTokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(xeroTokens.orgId, orgId));

    return updated;
  }

  return {
    ...token,
    accessToken: decryptSecret(token.accessToken)!,
    refreshToken: refreshTokenPlain,
  };
}

// ─── api helper ──────────────────────────────────────────────────────────────

async function xeroFetch(
  endpoint: string,
  accessToken: string,
  tenantId: string
): Promise<any> {
  const res = await fetch(`${XERO_API}/${endpoint}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-Tenant-Id": tenantId,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Xero AP ${res.status} ${endpoint}: ${body.slice(0, 300)}`
    );
  }
  return res.json();
}

/** Paginated fetch — Xero returns 100 per page by default. */
async function xeroFetchAll(
  accessToken: string,
  tenantId: string,
  entity: string,
  where?: string,
  extraParams?: string
): Promise<any[]> {
  const all: any[] = [];
  let page = 1;

  while (true) {
    let path = `${entity}?page=${page}`;
    if (where) path += `&where=${encodeURIComponent(where)}`;
    if (extraParams) path += `&${extraParams}`;

    const data = await xeroFetch(path, accessToken, tenantId);
    const records: any[] = data[entity] ?? [];
    all.push(...records);

    if (records.length < 100) break;
    page++;
    await sleep(200);
  }

  return all;
}

/** Parse Xero date string "/Date(1234567890000+0000)/" → YYYY-MM-DD or null */
function parseXeroDate(d: string | undefined | null): string | null {
  if (!d) return null;
  const match = d.match(/\/Date\((\d+)([+-]\d{4})?\)\//);
  if (match) return new Date(parseInt(match[1])).toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return null;
}

// ─── main export ─────────────────────────────────────────────────────────────

export async function runXeroApSync(
  orgId: string,
  userId: string
): Promise<XeroApSyncResult> {
  const errors: string[] = [];

  // ── 1. Token ──────────────────────────────────────────────────────────────
  const token = await getXeroValidToken(orgId);
  if (!token) throw new Error("Xero not connected");

  const { accessToken, tenantId } = token;

  const result: XeroApSyncResult = {
    vendorsCreated: 0,
    vendorsUpdated: 0,
    accountsUpserted: 0,
    itemsUpserted: 0,
    taxRatesUpserted: 0,
    dimensionsUpserted: 0,
    billsCreated: 0,
    billsUpdated: 0,
    billsSkipped: 0,
    errors,
  };

  // ── 2. Contacts (IsSupplier=true) → ap_suppliers ──────────────────────────
  try {
    const contacts = await xeroFetchAll(
      accessToken,
      tenantId,
      "Contacts",
      `IsSupplier=true`
    );
    await sleep(300);

    const vendorResults = await Promise.allSettled(
      contacts.map(async (c: any) => {
        if (!c.ContactID) return;

        // Build address from Addresses array (prefer POBOX, then STREET, then first)
        const addrs: any[] = c.Addresses ?? [];
        const addr =
          addrs.find((a: any) => a.AddressType === "POBOX") ??
          addrs.find((a: any) => a.AddressType === "STREET") ??
          addrs[0] ??
          null;
        const addressParts = [
          addr?.AddressLine1,
          addr?.City,
          addr?.Region,
          addr?.PostalCode,
        ].filter(Boolean);
        const address = addressParts.length > 0 ? addressParts.join(", ") : null;
        const country = addr?.Country ?? null;

        // Primary email
        const email: string | null = c.EmailAddress ?? null;

        // Primary phone
        const phones: any[] = c.Phones ?? [];
        const primaryPhone =
          phones.find((p: any) => p.PhoneType === "DEFAULT" && p.PhoneNumber) ??
          phones[0] ??
          null;
        const phone: string | null = primaryPhone?.PhoneNumber ?? null;

        const currency: string =
          c.Balances?.AccountsPayable?.CurrencyCode ??
          c.DefaultCurrency ??
          "USD";

        const status =
          c.IsSupplier && c.ContactStatus !== "ARCHIVED" ? "Active" : "Inactive";

        const payload = {
          orgId,
          name: c.Name ?? c.ContactID,
          displayName: c.Name ?? null,
          email,
          phone,
          address,
          country,
          currency,
          taxNumber: c.TaxNumber ?? null,
          status,
          source: "xero",
          xeroId: c.ContactID,
          lastSyncedAt: new Date(),
          updatedAt: new Date(),
        };

        const [existing] = await withRetry(
          () =>
            db
              .select({ id: apSuppliers.id })
              .from(apSuppliers)
              .where(and(eq(apSuppliers.orgId, orgId), eq(apSuppliers.xeroId, c.ContactID)))
              .limit(1),
          `find-contact-${c.ContactID}`
        );

        if (existing) {
          await withRetry(
            () => db.update(apSuppliers).set(payload).where(eq(apSuppliers.id, existing.id)),
            `update-contact-${c.ContactID}`
          );
          result.vendorsUpdated++;
        } else {
          await withRetry(
            () =>
              db.insert(apSuppliers).values({
                ...payload,
                riskRating: "Low",
                paymentTerms: c.PaymentTerms?.Bills?.Day ?? 30,
              }),
            `insert-contact-${c.ContactID}`
          );
          result.vendorsCreated++;
        }
      })
    );

    for (const r of vendorResults) {
      if (r.status === "rejected") {
        errors.push(r.reason?.message ?? String(r.reason));
      }
    }
  } catch (e: any) {
    errors.push(`Contacts (suppliers) fetch failed: ${e?.message ?? String(e)}`);
  }

  // ── 3. Chart of Accounts → ap_accounts ───────────────────────────────────
  // Xero account types relevant to AP
  const apAccountTypes = [
    "DIRECTCOSTS",
    "EXPENSE",
    "OVERHEADS",
    "FIXED",
    "NONCURRENT",
    "CURRLIAB",
    "TERMLIAB",
    "PAYGLIAB",
  ];

  try {
    // Xero doesn't support WHERE IN on Accounts via query param the same way;
    // fetch all and filter in memory to avoid URL length issues
    const allAccounts = await xeroFetchAll(accessToken, tenantId, "Accounts");
    await sleep(300);

    const filtered = allAccounts.filter((acc: any) =>
      apAccountTypes.includes(acc.Type)
    );

    const accountResults = await Promise.allSettled(
      filtered.map(async (acc: any) => {
        const now = new Date();
        const externalId = acc.AccountID;
        const row = {
          orgId,
          externalId,
          source: "xero",
          code: acc.Code ?? null,
          name: acc.Name,
          type: acc.Type ?? null,
          subtype: acc.SystemAccount ?? null,
          status: acc.Status === "ARCHIVED" ? "Inactive" : "Active",
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
    const items = await xeroFetchAll(accessToken, tenantId, "Items");
    await sleep(300);

    const itemResults = await Promise.allSettled(
      items.map(async (item: any) => {
        const now = new Date();
        const row = {
          orgId,
          externalId: item.ItemID,
          source: "xero",
          code: item.Code ?? null,
          name: item.Name,
          description: item.Description ?? item.PurchaseDescription ?? null,
          purchaseAccountId: item.PurchaseDetails?.AccountCode ?? null,
          expenseAccountId: item.PurchaseDetails?.AccountCode ?? null,
          unitCost:
            item.PurchaseDetails?.UnitPrice != null
              ? parseFloat(item.PurchaseDetails.UnitPrice)
              : null,
          taxRateId: item.PurchaseDetails?.TaxType ?? null,
          status: item.IsTrackedAsInventory === false && item.IsPurchased === false
            ? "Inactive"
            : "Active",
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
          taxRateId: row.taxRateId,
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
    const data = await xeroFetch("TaxRates", accessToken, tenantId);
    const taxRates: any[] = data.TaxRates ?? [];
    await sleep(200);

    const taxResults = await Promise.allSettled(
      taxRates.map(async (tr: any) => {
        const now = new Date();
        // Xero TaxType is the unique key for tax rates
        const externalId = tr.TaxType;
        const effectiveRate =
          tr.EffectiveRate != null
            ? parseFloat(tr.EffectiveRate)
            : tr.TaxComponents?.[0]?.Rate != null
            ? parseFloat(tr.TaxComponents[0].Rate)
            : null;

        const row = {
          orgId,
          externalId,
          source: "xero",
          name: tr.Name,
          rate: effectiveRate,
          taxType: tr.TaxType ?? "Standard",
          status: tr.Status === "DELETED" ? "Inactive" : "Active",
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

  // ── 6. Tracking Categories → ap_dimensions ────────────────────────────────
  try {
    const data = await xeroFetch("TrackingCategories", accessToken, tenantId);
    const categories: any[] = data.TrackingCategories ?? [];
    await sleep(200);

    // Each tracking category can have options (the actual dimension values)
    const dimRows: Array<{ row: any; updateFields: any }> = [];

    for (const cat of categories) {
      if (!cat.TrackingCategoryID) continue;

      // Insert the category itself
      const now = new Date();
      const catRow = {
        orgId,
        externalId: cat.TrackingCategoryID,
        source: "xero",
        dimensionType: "TrackingCategory",
        name: cat.Name,
        code: cat.Name ?? null,
        parentId: null,
        status: cat.Status === "DELETED" ? "Inactive" : "Active",
        raw: cat,
        lastSyncedAt: now,
        createdAt: now,
        updatedAt: now,
      };
      dimRows.push({
        row: catRow,
        updateFields: {
          name: catRow.name,
          code: catRow.code,
          status: catRow.status,
          raw: catRow.raw,
          lastSyncedAt: catRow.lastSyncedAt,
          updatedAt: catRow.updatedAt,
        },
      });

      // Insert each option as a child dimension
      for (const opt of cat.Options ?? []) {
        if (!opt.TrackingOptionID) continue;
        const optRow = {
          orgId,
          externalId: opt.TrackingOptionID,
          source: "xero",
          dimensionType: "TrackingCategory",
          name: opt.Name,
          code: opt.Name ?? null,
          parentId: cat.TrackingCategoryID,
          status: opt.Status === "DELETED" ? "Inactive" : "Active",
          raw: opt,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        };
        dimRows.push({
          row: optRow,
          updateFields: {
            name: optRow.name,
            code: optRow.code,
            parentId: optRow.parentId,
            status: optRow.status,
            raw: optRow.raw,
            lastSyncedAt: optRow.lastSyncedAt,
            updatedAt: optRow.updatedAt,
          },
        });
      }
    }

    const dimResults = await Promise.allSettled(
      dimRows.map(async ({ row, updateFields }) => {
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
        result.dimensionsUpserted++;
      })
    );

    for (const r of dimResults) {
      if (r.status === "rejected") {
        errors.push(
          `Dimension (TrackingCategory) upsert: ${r.reason?.message ?? String(r.reason)}`
        );
      }
    }
  } catch (e: any) {
    errors.push(`TrackingCategories fetch failed: ${e?.message ?? String(e)}`);
  }

  // ── 7. Bills (ACCPAY invoices) → ap_bills + ap_bill_lines ─────────────────
  try {
    const bills = await xeroFetchAll(
      accessToken,
      tenantId,
      "Invoices",
      `Type="ACCPAY"`,
      "Statuses=AUTHORISED,SUBMITTED"
    );
    await sleep(300);

    // Resolve suppliers up-front. Build a xeroId → supplierId map, then
    // auto-create a minimal supplier for any contact a bill references that
    // wasn't synced (e.g. a contact not flagged IsSupplier, or archived).
    const supplierRows = await withRetry(
      () =>
        db
          .select({ id: apSuppliers.id, xeroId: apSuppliers.xeroId })
          .from(apSuppliers)
          .where(eq(apSuppliers.orgId, orgId)),
      "load-suppliers"
    );
    const supplierByXero = new Map<string, string>();
    for (const s of supplierRows) {
      if (s.xeroId) supplierByXero.set(s.xeroId, s.id);
    }

    const missingContacts = new Map<string, string>(); // xeroId → name
    for (const xi of bills) {
      const cid = xi.Contact?.ContactID;
      if (cid && !supplierByXero.has(cid)) {
        missingContacts.set(cid, xi.Contact?.Name ?? `Contact-${cid}`);
      }
    }
    for (const [cid, name] of missingContacts) {
      try {
        const [created] = await withRetry(
          () =>
            db
              .insert(apSuppliers)
              .values({
                orgId,
                name,
                source: "xero",
                xeroId: cid,
                status: "Active",
                riskRating: "Low",
                paymentTerms: 30,
                currency: "USD",
                lastSyncedAt: new Date(),
              })
              .returning({ id: apSuppliers.id }),
          `auto-create-contact-${cid}`
        );
        supplierByXero.set(cid, created.id);
        result.vendorsCreated++;
      } catch (e: any) {
        errors.push(`Auto-create contact ${cid}: ${e?.message ?? String(e)}`);
      }
    }

    // Bulk-load existing bills ONCE (keyed by xeroId) instead of a per-bill SELECT.
    const existingBillRows = await withRetry(
      () =>
        db
          .select({
            id: apBills.id,
            xeroId: apBills.xeroId,
            workflowStatus: apBills.workflowStatus,
            balance: apBills.balance,
            total: apBills.total,
            accountingPaymentStatus: apBills.accountingPaymentStatus,
            supplierId: apBills.supplierId,
          })
          .from(apBills)
          .where(eq(apBills.orgId, orgId)),
      "load-existing-bills"
    );
    const existingByXero = new Map<
      string,
      { id: string; workflowStatus: string; balance: number; total: number; status: string; supplierId: string | null }
    >();
    for (const b of existingBillRows) {
      if (b.xeroId)
        existingByXero.set(b.xeroId, {
          id: b.id,
          workflowStatus: b.workflowStatus,
          balance: b.balance ?? 0,
          total: b.total ?? 0,
          status: b.accountingPaymentStatus,
          supplierId: b.supplierId,
        });
    }

    const BATCH = 8;
    const billResults: PromiseSettledResult<void>[] = [];
    for (let bi = 0; bi < bills.length; bi += BATCH) {
      const chunk = bills.slice(bi, bi + BATCH);
      const chunkResults = await Promise.allSettled(
      chunk.map(async (xi: any) => {
        if (!xi.InvoiceID) return;

        try {
          // Resolve supplier from the pre-built map (no per-bill query)
          const contactId = xi.Contact?.ContactID;
          const supplierId = contactId ? supplierByXero.get(contactId) ?? null : null;

          const total = parseFloat(xi.Total) || 0;
          const amountPaid = parseFloat(xi.AmountPaid) || 0;
          const balance = parseFloat(xi.AmountDue) || 0;
          const subtotal = parseFloat(xi.SubTotal) || 0;
          const taxTotal = parseFloat(xi.TotalTax) || 0;

          const xeroStatus: string = xi.Status ?? "AUTHORISED";
          let accountingPaymentStatus: string;
          switch (xeroStatus) {
            case "PAID":
              accountingPaymentStatus = "Paid";
              break;
            case "PARTPAID":
              accountingPaymentStatus = "Partially Paid";
              break;
            case "VOIDED":
            case "DELETED":
              accountingPaymentStatus = "Voided";
              break;
            default:
              // AUTHORISED, SUBMITTED
              accountingPaymentStatus = amountPaid > 0 ? "Partially Paid" : "Unpaid";
          }

          const billDate = parseXeroDate(xi.DateString ?? xi.Date) ?? null;
          const dueDate = parseXeroDate(xi.DueDateString ?? xi.DueDate) ?? null;

          // Look up existing bill from the pre-built map (no per-bill query)
          const existing = existingByXero.get(xi.InvoiceID);

          // Skip unchanged bills (same balance/total/status, already linked) to
          // avoid rewriting everything every sync — the cause of the timeout.
          const cents = (n: number) => Math.round(n * 100);
          if (
            existing &&
            existing.supplierId &&
            cents(existing.balance) === cents(balance) &&
            cents(existing.total) === cents(total) &&
            existing.status === accountingPaymentStatus
          ) {
            result.billsSkipped++;
            return;
          }

          const workflowStatus =
            existing && existing.workflowStatus !== "Synced from Accounting"
              ? existing.workflowStatus
              : "Synced from Accounting";

          const billPayload = {
            orgId,
            supplierId,
            billNumber: xi.InvoiceNumber ?? null,
            reference: xi.Reference ?? xi.InvoiceNumber ?? null,
            billDate,
            dueDate,
            currency: xi.CurrencyCode ?? "USD",
            subtotal,
            taxTotal,
            total,
            amountPaid,
            balance,
            accountingPaymentStatus,
            workflowStatus,
            xeroId: xi.InvoiceID,
            source: "xero",
            lastSyncAt: new Date(),
            updatedAt: new Date(),
          };

          let billId: string;

          if (existing) {
            await withRetry(
              () => db.update(apBills).set(billPayload).where(eq(apBills.id, existing.id)),
              `update-bill-${xi.InvoiceID}`
            );
            billId = existing.id;
            result.billsUpdated++;
          } else {
            const [inserted] = await withRetry(
              () => db.insert(apBills).values(billPayload).returning({ id: apBills.id }),
              `insert-bill-${xi.InvoiceID}`
            );
            billId = inserted.id;
            result.billsCreated++;
          }

          // Re-insert lines (delete + insert for idempotency)
          await withRetry(
            () => db.delete(apBillLines).where(eq(apBillLines.billId, billId)),
            `delete-lines-${xi.InvoiceID}`
          );

          const lineItems: any[] = xi.LineItems ?? [];
          if (lineItems.length > 0) {
            const lineRows = lineItems.map((line: any, idx: number) => {
              const quantity =
                line.Quantity != null ? parseFloat(line.Quantity) : 1;
              const unitPrice =
                line.UnitAmount != null ? parseFloat(line.UnitAmount) : 0;
              const lineTotal =
                line.LineAmount != null ? parseFloat(line.LineAmount) : 0;
              const taxAmount =
                line.TaxAmount != null ? parseFloat(line.TaxAmount) : 0;

              // Tracking category references
              const tracking: any[] = line.Tracking ?? [];
              const trackingCategoryId = tracking[0]?.TrackingOptionID ?? null;

              return {
                orgId,
                billId,
                lineNumber: idx + 1,
                itemId: line.ItemCode ?? null,
                description: line.Description ?? null,
                quantity,
                unitPrice,
                accountId: line.AccountCode ?? null,
                taxRateId: line.TaxType ?? null,
                trackingCategoryId,
                lineSubtotal: lineTotal - taxAmount,
                lineTax: taxAmount,
                lineTotal,
              };
            });

            await withRetry(
              () => db.insert(apBillLines).values(lineRows),
              `insert-lines-${xi.InvoiceID}`
            );
          }
        } catch (e: any) {
          throw new Error(
            `Bill ${xi.InvoiceID}: ${e?.message ?? String(e)}`
          );
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
    errors.push(`Bills (ACCPAY) fetch failed: ${e?.message ?? String(e)}`);
  }

  return result;
}
