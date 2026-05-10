/**
 * Shared QBO sync logic.
 * Used by:
 *   - POST /api/qbo/sync      — manual sync from Settings
 *   - GET  /api/cron/qbo-sync — scheduled full sync (every 30 min)
 *   - POST /api/webhooks/qbo  — real-time targeted sync on entity change
 */

import { db } from "@/db";
import { qboTokens, qboSyncLog, customers, projects, invoices, contacts } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Extract all billing emails from a QBO invoice object.
 * QBO stores primary recipients in BillEmail.Address (may be comma-separated)
 * and CC in BillEmailCc.Address. We merge, deduplicate, and return a single
 * comma-separated string so all recipients are captured.
 */
function buildBillingEmails(qi: any): string | null {
  const raw: string[] = [];
  if (qi.BillEmail?.Address) raw.push(qi.BillEmail.Address);
  if (qi.BillEmailCc?.Address) raw.push(qi.BillEmailCc.Address);
  if (raw.length === 0) return null;
  // Split on comma/semicolon, trim, deduplicate
  const all = raw
    .join(",")
    .split(/[,;]/)
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
  const unique = [...new Set(all)];
  return unique.length > 0 ? unique.join(", ") : null;
}

// ============================================================
// TOKEN MANAGEMENT
// ============================================================
export async function getValidToken(orgId: string) {
  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1);
  if (!token) return null;
  const now = Date.now();
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 10 * 60 * 1000) {
    const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(
          `${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`
        ).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refreshToken,
      }),
    });
    if (!res.ok) return token;
    const d = await res.json();
    const updated = {
      ...token,
      accessToken: d.access_token,
      refreshToken: d.refresh_token || token.refreshToken,
      accessTokenExpiresAt: new Date(now + d.expires_in * 1000),
      refreshTokenExpiresAt: new Date(now + (d.x_refresh_token_expires_in || 8726400) * 1000),
    };
    await db
      .update(qboTokens)
      .set({
        accessToken: updated.accessToken,
        refreshToken: updated.refreshToken,
        accessTokenExpiresAt: updated.accessTokenExpiresAt,
        refreshTokenExpiresAt: updated.refreshTokenExpiresAt,
        updatedAt: new Date(),
      })
      .where(eq(qboTokens.orgId, orgId));
    return updated;
  }
  return token;
}

// ============================================================
// QBO API HELPERS
// ============================================================

/** GET a single entity or query endpoint. Handles minorversion correctly. */
export async function qboApiGet(accessToken: string, realmId: string, path: string) {
  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${QBO_API}/${realmId}/${path}${sep}minorversion=65`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QBO ${res.status}: ${await res.text()}`);
  return res.json();
}

async function qboQuery(accessToken: string, realmId: string, sql: string) {
  return qboApiGet(accessToken, realmId, `query?query=${encodeURIComponent(sql)}`);
}

/** Paginated fetch with rate-limit delays */
async function qboFetchAllSafe(
  accessToken: string,
  realmId: string,
  entity: string,
  where = ""
) {
  const whereClause = where ? ` where ${where}` : "";
  const all: any[] = [];
  let start = 1;
  const size = 500;
  while (true) {
    const data = await qboQuery(
      accessToken,
      realmId,
      `select * from ${entity}${whereClause} STARTPOSITION ${start} MAXRESULTS ${size}`
    );
    const records = data.QueryResponse?.[entity] || [];
    all.push(...records);
    if (records.length < size) break;
    start += size;
    await sleep(300);
  }
  return all;
}

function topLevelId(custId: string, map: Map<string, any>): string {
  const c = map.get(custId);
  if (!c || !c.ParentRef?.value) return custId;
  return topLevelId(c.ParentRef.value, map);
}

// ============================================================
// FULL SYNC — manual button + scheduled cron
// ============================================================
export async function runQboSync(orgId: string, userId: string) {
  const startTime = Date.now();
  const token = await getValidToken(orgId);
  if (!token) throw new Error("QuickBooks not connected");
  const { accessToken, realmId } = token;

  const results = {
    customers: 0,
    contacts: 0,
    projects: 0,
    invoicesCreated: 0,
    invoicesUpdated: 0,
    invoicesClosed: 0,
    paidSynced: 0,
    creditsCreated: 0,
    qboTotalAR: 0,
    ledgerTotalAR: 0,
    difference: 0,
  };

  // STEP 1: Fetch from QBO sequentially (rate-limit safe)
  const allQboCustomers = await qboFetchAllSafe(accessToken, realmId, "Customer", "Active = true");
  await sleep(500);
  const openInvoices = await qboFetchAllSafe(accessToken, realmId, "Invoice", "Balance > '0'");
  await sleep(500);
  const allInvoicesForClose = await qboFetchAllSafe(accessToken, realmId, "Invoice");
  await sleep(500);
  // Fetch ALL credit memos (applied + unapplied) so closed CMs appear in sales reporting.
  // AR reconciliation uses openInvoices balances only — credit memo balances are not needed there.
  const openCredits = await qboFetchAllSafe(accessToken, realmId, "CreditMemo");
  await sleep(500);
  // Fetch all Payments — TxnDate is the actual payment date per payment transaction
  const allQboPayments = await qboFetchAllSafe(accessToken, realmId, "Payment");

  // Build: invoiceQboId → latest payment TxnDate
  // For invoices paid in multiple instalments, take the LATEST payment date
  // (that's when the balance hit zero)
  const paymentDateByInvId = new Map<string, string>();
  for (const pay of allQboPayments) {
    const txnDate: string = pay.TxnDate; // YYYY-MM-DD
    if (!txnDate) continue;
    for (const line of (pay.Line || [])) {
      for (const linked of (line.LinkedTxn || [])) {
        if (linked.TxnType === "Invoice") {
          const existing = paymentDateByInvId.get(linked.TxnId);
          // Keep the latest date — that's when it was finally settled
          if (!existing || txnDate > existing) paymentDateByInvId.set(linked.TxnId, txnDate);
        }
      }
    }
  }

  const custMap = new Map(allQboCustomers.map((c: any) => [c.Id, c]));
  const parentCustomers = allQboCustomers.filter((c: any) => !c.Job && !c.ParentRef);
  const subCustomers = allQboCustomers.filter((c: any) => c.Job || c.ParentRef);

  // STEP 2: Load Ledger state
  const [allLedgerCustomers, allLedgerProjects, allLedgerInvoices, allLedgerContacts] =
    await Promise.all([
      db.select().from(customers).where(eq(customers.orgId, orgId)),
      db.select().from(projects).where(eq(projects.orgId, orgId)),
      db.select().from(invoices).where(eq(invoices.orgId, orgId)),
      db.select().from(contacts).where(eq(contacts.orgId, orgId)),
    ]);

  const ledgerCustByQboId = new Map(
    allLedgerCustomers.filter((c) => c.qboId).map((c) => [c.qboId!, c])
  );
  const ledgerCustByCode = new Map(allLedgerCustomers.map((c) => [c.code, c]));
  const ledgerProjByCode = new Map(allLedgerProjects.map((p) => [p.code, p]));
  const ledgerInvByNumber = new Map(allLedgerInvoices.map((i) => [i.invoiceNumber, i]));
  const ledgerInvByQboId = new Map(
    allLedgerInvoices.filter((i) => i.qboId).map((i) => [i.qboId!, i])
  );
  const ledgerContactsByCustId = new Map(allLedgerContacts.map((c) => [c.customerId, c]));

  // STEP 3: Upsert parent customers
  const custsToInsert: any[] = [];
  const custsToUpdate: { id: string; data: any }[] = [];

  for (const qc of parentCustomers) {
    const existing = ledgerCustByQboId.get(qc.Id) || ledgerCustByCode.get(`QBO-${qc.Id}`);
    const payload = {
      name: qc.CompanyName || qc.DisplayName || qc.FullyQualifiedName,
      code: `QBO-${qc.Id}`,
      qboId: qc.Id,
      country: qc.BillAddr?.Country || "Ireland",
      currency: qc.CurrencyRef?.value || "EUR",
      paymentTerms: 30,
      taxNumber: qc.BusinessNumber || "",
      riskRating: "Low" as const,
      status: "Active" as const,
      creditLimit: qc.CreditLimit || null,
      accountOwnerId: userId,
      collectionOwnerId: userId,
      notes: qc.Notes || "",
      phone: qc.PrimaryPhone?.FreeFormNumber || "",
      email: qc.PrimaryEmailAddr?.Address || "",
      companyName: qc.CompanyName || "",
      addressStreet: qc.BillAddr?.Line1 || "",
      addressCity: qc.BillAddr?.City || "",
      addressPostcode: qc.BillAddr?.PostalCode || "",
    };
    if (existing) custsToUpdate.push({ id: existing.id, data: payload });
    else {
      custsToInsert.push({ ...payload, orgId });
      results.customers++;
    }
  }

  if (custsToInsert.length > 0) {
    for (let i = 0; i < custsToInsert.length; i += 100)
      await db.insert(customers).values(custsToInsert.slice(i, i + 100));
  }
  await Promise.all(
    custsToUpdate.map(({ id, data }) =>
      db.update(customers).set({ ...data, updatedAt: new Date() }).where(eq(customers.id, id))
    )
  );

  // Reload customers
  const freshCustomers = await db.select().from(customers);
  const freshCustByQboId = new Map(
    freshCustomers.filter((c) => c.qboId).map((c) => [c.qboId!, c])
  );
  const freshCustByCode = new Map(freshCustomers.map((c) => [c.code, c]));

  // STEP 4: Contacts
  const contactsToInsert: any[] = [];
  for (const qc of parentCustomers) {
    if (!qc.PrimaryEmailAddr?.Address) continue;
    const cust = freshCustByQboId.get(qc.Id) || freshCustByCode.get(`QBO-${qc.Id}`);
    if (!cust || ledgerContactsByCustId.has(cust.id)) continue;
    contactsToInsert.push({
      orgId,
      customerId: cust.id,
      name: qc.DisplayName || "Primary Contact",
      email: qc.PrimaryEmailAddr.Address,
      phone: qc.PrimaryPhone?.FreeFormNumber || "",
      type: "Billing" as const,
      isPrimary: true,
      isEscalation: false,
      receivesAuto: true,
    });
    results.contacts++;
  }
  if (contactsToInsert.length > 0) {
    for (let i = 0; i < contactsToInsert.length; i += 100)
      await db.insert(contacts).values(contactsToInsert.slice(i, i + 100));
  }

  // STEP 5: Sub-customers as projects
  const projsToInsert: any[] = [];
  for (const qc of subCustomers) {
    if (!qc.ParentRef?.value) continue;
    const parentCust =
      freshCustByQboId.get(qc.ParentRef.value) ||
      freshCustByCode.get(`QBO-${qc.ParentRef.value}`);
    if (!parentCust) continue;
    const code = `QBO-PROJ-${qc.Id}`;
    if (!ledgerProjByCode.has(code)) {
      projsToInsert.push({
        orgId,
        customerId: parentCust.id,
        name: qc.DisplayName || qc.FullyQualifiedName,
        code,
        qboId: qc.Id,
        ownerId: userId,
        status: "Active" as const,
      });
      results.projects++;
    }
  }
  if (projsToInsert.length > 0) {
    for (let i = 0; i < projsToInsert.length; i += 100)
      await db.insert(projects).values(projsToInsert.slice(i, i + 100));
  }

  // Reload projects
  const freshProjects = await db.select().from(projects);
  const freshProjByQboId = new Map(
    freshProjects.filter((p) => p.qboId).map((p) => [p.qboId!, p])
  );
  const freshProjByCode = new Map(freshProjects.map((p) => [p.code, p]));

  // STEP 6: Open invoices
  results.qboTotalAR = openInvoices.reduce(
    (s: number, i: any) => s + (parseFloat(i.Balance) || 0),
    0
  );

  const invsToInsert: any[] = [];
  const invsToUpdate: { id: string; data: any }[] = [];

  for (const qi of openInvoices) {
    const invoiceNumber = qi.DocNumber || `QBO-INV-${qi.Id}`;
    const tlId = topLevelId(qi.CustomerRef?.value, custMap);
    const cust = freshCustByQboId.get(tlId) || freshCustByCode.get(`QBO-${tlId}`);
    if (!cust) continue;

    let projectId: string | null = null;
    const directQboCust = custMap.get(qi.CustomerRef?.value);
    if (directQboCust?.ParentRef) {
      const proj =
        freshProjByQboId.get(qi.CustomerRef.value) ||
        freshProjByCode.get(`QBO-PROJ-${qi.CustomerRef.value}`);
      if (proj) projectId = proj.id;
    }

    const qboBalance = parseFloat(qi.Balance) || 0;
    const total = parseFloat(qi.TotalAmt) || 0;
    const taxAmount = parseFloat(qi.TxnTaxDetail?.TotalTax) || 0;
    const amount = Math.max(0, total - taxAmount); // Net ex tax
    const paid = Math.max(0, total - qboBalance);
    // QBO Id is the unique source of truth — invoice numbers are display only
    const existing = ledgerInvByQboId.get(qi.Id);

    // QBO BillEmail.Address can contain multiple comma-separated addresses
    // Also pull BillEmailCc if present and combine all into one string
    const billingEmail = buildBillingEmails(qi);

    const syncData = {
      total,
      amount,      // Net ex tax
      taxAmount,   // Tax amount from QBO
      paid,
      qboId: qi.Id,
      qboBalance,
      qboCustomerId: qi.CustomerRef?.value,
      qboSyncedAt: new Date(),
      txnType: "Invoice",
      paymentStatus: (paid > 0 ? "Partially Paid" : "Unpaid") as any,
      billingEmail,
      updatedAt: new Date(),
    };

    if (existing) {
      invsToUpdate.push({ id: existing.id, data: syncData });
      results.invoicesUpdated++;
    } else {
      invsToInsert.push({
        orgId,
        invoiceNumber,
        customerId: cust.id,
        projectId,
        invoiceDate: qi.TxnDate || new Date().toISOString().slice(0, 10),
        dueDate: qi.DueDate || new Date().toISOString().slice(0, 10),
        currency: cust.currency || "EUR",
        paymentTerms: cust.paymentTerms || 30,
        collectionStage: "New",
        collectionOwnerId: userId,
        ...syncData,
      });
      results.invoicesCreated++;
    }
  }

  if (invsToInsert.length > 0) {
    for (let i = 0; i < invsToInsert.length; i += 50)
      await db.insert(invoices).values(invsToInsert.slice(i, i + 50));
  }
  await Promise.all(
    invsToUpdate.map(({ id, data }) =>
      db.update(invoices).set(data).where(eq(invoices.id, id))
    )
  );

  // STEP 7: Credit memos (all — applied and unapplied)
  // Data model (mirrors invoice logic but with negative values):
  //   total      = full face value (NEGATIVE, ex tax) — never changes
  //   qboBalance = unapplied portion (NEGATIVE)       — the "open balance"
  //   paid       = 0 (CMs don't have a "received" concept)
  // Display code uses qboBalance for CM open balance, total - paid for invoices.
  const creditsToInsert: any[] = [];
  for (const cm of openCredits) {
    const creditNumber = `CM-${cm.DocNumber || cm.Id}`;
    if (ledgerInvByNumber.has(creditNumber) || ledgerInvByQboId.has(`CM-${cm.Id}`)) continue;
    const tlId = topLevelId(cm.CustomerRef?.value, custMap);
    const cust = freshCustByQboId.get(tlId) || freshCustByCode.get(`QBO-${tlId}`);
    if (!cust) continue;

    const totalAmt  = parseFloat(cm.TotalAmt) || 0;
    const balance   = parseFloat(cm.Balance)  || 0;
    const taxAmount = parseFloat(cm.TxnTaxDetail?.TotalTax) || 0;
    const netAmt    = Math.max(0, totalAmt - taxAmount); // ex-tax face value
    // Proportional unapplied balance ex-tax
    const netBalance = totalAmt > 0 ? Math.max(0, (balance / totalAmt) * netAmt) : 0;

    // Resolve project: same logic as invoices — if the CM's CustomerRef points to a
    // sub-customer (QBO project), capture that project ID.
    let cmProjectId: string | null = null;
    const cmDirectCust = custMap.get(cm.CustomerRef?.value);
    if (cmDirectCust?.ParentRef) {
      const proj =
        freshProjByQboId.get(cm.CustomerRef.value) ||
        freshProjByCode.get(`QBO-PROJ-${cm.CustomerRef.value}`);
      if (proj) cmProjectId = proj.id;
    }

    creditsToInsert.push({
      orgId,
      invoiceNumber: creditNumber,
      customerId: cust.id,
      projectId: cmProjectId,
      invoiceDate: cm.TxnDate || new Date().toISOString().slice(0, 10),
      dueDate: cm.TxnDate || new Date().toISOString().slice(0, 10),
      currency: cust.currency || "EUR",
      amount: -netAmt,      // negative face value
      taxAmount: 0,
      total: -netAmt,       // negative face value (the "CM Total")
      paid: 0,              // not applicable for credit memos
      paymentTerms: 0,
      paymentStatus: "Unpaid" as const,
      collectionStage: "Credit Memo",
      collectionOwnerId: userId,
      qboId: `CM-${cm.Id}`,
      qboBalance: -netBalance,  // negative unapplied balance (the "CM Open")
      qboCustomerId: cm.CustomerRef?.value,
      qboSyncedAt: new Date(),
      txnType: "CreditMemo",
      notes: `Credit memo from QBO — ${cm.DocNumber || cm.Id}`,
    });
    results.creditsCreated++;
  }
  if (creditsToInsert.length > 0) await db.insert(invoices).values(creditsToInsert);

  // STEP 7.5: Sync paid invoices (Balance = 0) for sales history and DSO calculation
  // allInvoicesForClose is already in memory — no extra QBO API calls needed
  const paidQboInvoices = allInvoicesForClose.filter((qi: any) => parseFloat(qi.Balance) === 0 && qi.Id);

  const paidToInsert: any[] = [];
  const paidToUpdate: { id: string; data: any }[] = [];

  for (const qi of paidQboInvoices) {
    const existing = ledgerInvByQboId.get(qi.Id);
    const paidTax   = parseFloat(qi.TxnTaxDetail?.TotalTax) || 0;
    const paidTotal = parseFloat(qi.TotalAmt) || 0;
    const paidNet   = Math.max(0, paidTotal - paidTax); // Net ex tax
    const invoiceNumber = qi.DocNumber || `QBO-INV-${qi.Id}`;
    const billingEmail  = buildBillingEmails(qi);

    // Use actual Payment TxnDate — accurate date payment was received
    const qboPaidAt = paymentDateByInvId.get(qi.Id) || null;

    const paidData = {
      total:         paidTotal,
      amount:        paidNet,   // Net ex tax — used for DSO & sales reports
      taxAmount:     paidTax,
      paid:          paidTotal,
      qboBalance:    0,
      qboSyncedAt:   new Date(),
      paymentStatus: "Paid" as const,
      collectionStage: "Closed",
      billingEmail,
      updatedAt:     new Date(),
      ...(qboPaidAt ? { paidAt: qboPaidAt } : {}),
    };

    if (existing) {
      // Update financials if not yet paid, OR if paidAt is missing (backfill)
      const needsUpdate = existing.paymentStatus !== "Paid" || (!existing.paidAt && qboPaidAt);
      if (needsUpdate) {
        const updateData = existing.paymentStatus !== "Paid"
          ? paidData  // full update
          : { paidAt: qboPaidAt, updatedAt: new Date() }; // backfill paidAt only
        paidToUpdate.push({ id: existing.id, data: updateData });
        results.paidSynced++;
      }
    } else {
      // Brand-new paid invoice — insert it for sales history
      const tlId = topLevelId(qi.CustomerRef?.value, custMap);
      const cust = freshCustByQboId.get(tlId) || freshCustByCode.get(`QBO-${tlId}`);
      if (!cust) continue;

      let projectId: string | null = null;
      const directQboCust = custMap.get(qi.CustomerRef?.value);
      if (directQboCust?.ParentRef) {
        const proj = freshProjByQboId.get(qi.CustomerRef.value) || freshProjByCode.get(`QBO-PROJ-${qi.CustomerRef.value}`);
        if (proj) projectId = proj.id;
      }

      paidToInsert.push({
        orgId,
        invoiceNumber,
        customerId:        cust.id,
        projectId,
        invoiceDate:       qi.TxnDate || new Date().toISOString().slice(0, 10),
        dueDate:           qi.DueDate || qi.TxnDate || new Date().toISOString().slice(0, 10),
        currency:          cust.currency || "EUR",
        paymentTerms:      cust.paymentTerms || 30,
        collectionOwnerId: userId,
        qboId:             qi.Id,
        qboCustomerId:     qi.CustomerRef?.value,
        txnType:           "Invoice",
        ...paidData,
      });
      results.paidSynced++;
    }
  }

  if (paidToInsert.length > 0) {
    for (let i = 0; i < paidToInsert.length; i += 50)
      await db.insert(invoices).values(paidToInsert.slice(i, i + 50));
  }
  if (paidToUpdate.length > 0) {
    await Promise.all(
      paidToUpdate.map(({ id, data }) =>
        db.update(invoices).set(data).where(eq(invoices.id, id))
      )
    );
  }

  // STEP 8: Auto-close fully paid invoices
  const paidQboIds = new Set(
    allInvoicesForClose
      .filter((i: any) => parseFloat(i.Balance) === 0)
      .map((i: any) => i.Id)
  );

  const toClose = allLedgerInvoices.filter(
    (inv) =>
      inv.qboId &&
      !inv.qboId.startsWith("CM-") &&
      inv.paymentStatus !== "Paid" &&
      inv.collectionStage !== "Closed" &&
      paidQboIds.has(inv.qboId)
  );

  if (toClose.length > 0) {
    await Promise.all(
      toClose.map((inv) =>
        db
          .update(invoices)
          .set({
            paymentStatus: "Paid",
            collectionStage: "Closed",
            paid: inv.total,
            qboBalance: 0,
            qboSyncedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(invoices.id, inv.id))
      )
    );
    results.invoicesClosed = toClose.length;
  }

  // STEP 9: Reconciliation totals
  const currentInvoices = await db.select().from(invoices);
  results.ledgerTotalAR = currentInvoices
    .filter(
      (i) =>
        i.txnType !== "CreditMemo" &&
        i.paymentStatus !== "Paid" &&
        i.collectionStage !== "Closed"
    )
    .reduce((s, i) => s + (i.total - (i.paid || 0)), 0);

  results.difference = Math.abs(results.qboTotalAR - results.ledgerTotalAR);

  // STEP 10: Write sync log
  await db.insert(qboSyncLog).values({
    userId,
    orgId,
    status: "success",
    qboTotalAR: results.qboTotalAR,
    ledgerTotalAR: results.ledgerTotalAR,
    difference: results.difference,
    customersCreated: results.customers,
    invoicesCreated: results.invoicesCreated,
    invoicesUpdated: results.invoicesUpdated,
    invoicesClosed: results.invoicesClosed,
    creditsCreated: results.creditsCreated,
    durationMs: Date.now() - startTime,
  });

  return results;
}

// ============================================================
// TARGETED SYNC — webhook only, fast (fetches specific entities)
// ============================================================
export type QboEntityChange = {
  name: string;   // "Invoice" | "Payment" | "CreditMemo" | "Customer"
  id: string;     // QBO entity ID
  operation: string; // "Create" | "Update" | "Delete" | "Void" | "Merge"
};

export async function syncTargetedEntities(
  orgId: string,
  userId: string,
  entityChanges: QboEntityChange[]
) {
  const token = await getValidToken(orgId);
  if (!token) return;
  const { accessToken, realmId } = token;

  // Categorise changes
  const invoiceIds = entityChanges
    .filter((e) => e.name === "Invoice" && !["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  const creditIds = entityChanges
    .filter((e) => e.name === "CreditMemo" && !["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  const paymentIds = entityChanges
    .filter((e) => e.name === "Payment" && !["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  const deletedInvoiceQboIds = entityChanges
    .filter((e) => e.name === "Invoice" && ["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  const deletedCreditQboIds = entityChanges
    .filter((e) => e.name === "CreditMemo" && ["Delete", "Void"].includes(e.operation))
    .map((e) => `CM-${e.id}`);

  // Load current ledger state for this org
  const [allLedgerInvoices, allLedgerCustomers, allLedgerProjects] = await Promise.all([
    db.select().from(invoices).where(eq(invoices.orgId, orgId)),
    db.select().from(customers).where(eq(customers.orgId, orgId)),
    db.select().from(projects).where(eq(projects.orgId, orgId)),
  ]);

  const ledgerInvByQboId = new Map(
    allLedgerInvoices.filter((i) => i.qboId).map((i) => [i.qboId!, i])
  );
  const ledgerCustByQboId = new Map(
    allLedgerCustomers.filter((c) => c.qboId).map((c) => [c.qboId!, c])
  );
  const ledgerCustByCode = new Map(allLedgerCustomers.map((c) => [c.code, c]));
  const ledgerProjByQboId = new Map(
    allLedgerProjects.filter((p) => p.qboId).map((p) => [p.qboId!, p])
  );
  const ledgerProjByCode = new Map(allLedgerProjects.map((p) => [p.code, p]));

  let custMap: Map<string, any> | null = null; // lazy-loaded only for new invoices

  const updatePromises: Promise<any>[] = [];
  const invsToInsert: any[] = [];

  // --- Helper: apply QBO invoice data to ledger ---
  async function processQboInvoice(qi: any, paymentDate?: string) {
    if (!qi) return;
    const qboBalance = parseFloat(qi.Balance) || 0;
    const total      = parseFloat(qi.TotalAmt) || 0;
    const taxAmount  = parseFloat(qi.TxnTaxDetail?.TotalTax) || 0;
    const amount     = Math.max(0, total - taxAmount); // Net ex tax
    const paid       = Math.max(0, total - qboBalance);
    const isPaid     = qboBalance === 0;
    const invoiceNumber = qi.DocNumber || `QBO-INV-${qi.Id}`;

    const existing     = ledgerInvByQboId.get(qi.Id);
    const billingEmail = buildBillingEmails(qi);

    // Payment date: prefer explicitly-passed date (from Payment.TxnDate), else paymentDateByInvId map
    const qboPaidAt = isPaid ? (paymentDate || paymentDateByInvId.get(qi.Id) || null) : null;

    if (existing) {
      updatePromises.push(
        db.update(invoices).set({
          total,
          amount,     // Net ex tax
          taxAmount,
          paid,
          qboId: qi.Id,
          qboBalance,
          qboSyncedAt: new Date(),
          updatedAt: new Date(),
          billingEmail,
          paymentStatus: isPaid ? "Paid" : paid > 0 ? ("Partially Paid" as any) : "Unpaid",
          ...(isPaid ? { collectionStage: "Closed" } : {}),
          // Only set paidAt once — don't overwrite a previously recorded date
          ...(isPaid && !existing.paidAt && qboPaidAt ? { paidAt: qboPaidAt } : {}),
        }).where(eq(invoices.id, existing.id))
      );
    } else {
      // New invoice — need customer hierarchy (lazy load custMap once)
      if (!custMap) {
        const allQboCusts = await qboFetchAllSafe(accessToken, realmId, "Customer", "Active = true");
        custMap = new Map(allQboCusts.map((c: any) => [c.Id, c]));
      }
      const tlId = topLevelId(qi.CustomerRef?.value, custMap!);
      const cust = ledgerCustByQboId.get(tlId) || ledgerCustByCode.get(`QBO-${tlId}`);
      if (!cust) return;

      let projectId: string | null = null;
      const directQboCust = custMap!.get(qi.CustomerRef?.value);
      if (directQboCust?.ParentRef) {
        const proj =
          ledgerProjByQboId.get(qi.CustomerRef.value) ||
          ledgerProjByCode.get(`QBO-PROJ-${qi.CustomerRef.value}`);
        if (proj) projectId = proj.id;
      }

      invsToInsert.push({
        orgId,
        invoiceNumber,
        customerId: cust.id,
        projectId,
        invoiceDate: qi.TxnDate || new Date().toISOString().slice(0, 10),
        dueDate: qi.DueDate || new Date().toISOString().slice(0, 10),
        currency: cust.currency || "EUR",
        amount,       // Net ex tax
        taxAmount,
        total,
        paid,
        paymentTerms: cust.paymentTerms || 30,
        paymentStatus: isPaid ? "Paid" : paid > 0 ? ("Partially Paid" as any) : "Unpaid",
        collectionStage: isPaid ? "Closed" : "New",
        collectionOwnerId: userId,
        billingEmail,
        qboId: qi.Id,
        qboBalance,
        qboCustomerId: qi.CustomerRef?.value,
        qboSyncedAt: new Date(),
        txnType: "Invoice",
        ...(isPaid && qboPaidAt ? { paidAt: qboPaidAt } : {}),
      });
    }
  }

  // --- Fetch and process changed invoices ---
  if (invoiceIds.length > 0) {
    const qboInvoices = await Promise.all(
      invoiceIds.map((id) =>
        qboApiGet(accessToken, realmId, `invoice/${id}`)
          .then((r) => r.Invoice)
          .catch(() => null)
      )
    );
    for (const qi of qboInvoices.filter(Boolean)) await processQboInvoice(qi);
  }

  // --- Payments: find linked invoices and refresh them with accurate payment date ---
  if (paymentIds.length > 0) {
    const qboPayments = await Promise.all(
      paymentIds.map((id) =>
        qboApiGet(accessToken, realmId, `payment/${id}`)
          .then((r) => r.Payment)
          .catch(() => null)
      )
    );

    // Build a local map: invoiceQboId → paymentTxnDate (from this webhook batch)
    const webhookPaymentDate = new Map<string, string>();
    for (const pay of qboPayments.filter(Boolean)) {
      const txnDate: string = pay.TxnDate;
      if (!txnDate) continue;
      for (const line of (pay.Line || [])) {
        for (const linked of (line.LinkedTxn || [])) {
          if (linked.TxnType === "Invoice") {
            const existing = webhookPaymentDate.get(linked.TxnId);
            if (!existing || txnDate > existing) webhookPaymentDate.set(linked.TxnId, txnDate);
          }
        }
      }
    }

    if (webhookPaymentDate.size > 0) {
      const linkedQboInvoices = await Promise.all(
        Array.from(webhookPaymentDate.keys()).map((id) =>
          qboApiGet(accessToken, realmId, `invoice/${id}`)
            .then((r) => r.Invoice)
            .catch(() => null)
        )
      );
      for (const qi of linkedQboInvoices.filter(Boolean)) {
        // Pass the actual payment date from the Payment object
        await processQboInvoice(qi, webhookPaymentDate.get(qi.Id));
      }
    }
  }

  // --- Credit memos ---
  if (creditIds.length > 0) {
    const qboCredits = await Promise.all(
      creditIds.map((id) =>
        qboApiGet(accessToken, realmId, `creditmemo/${id}`)
          .then((r) => r.CreditMemo)
          .catch(() => null)
      )
    );
    for (const cm of qboCredits.filter(Boolean)) {
      const existing = ledgerInvByQboId.get(`CM-${cm.Id}`);
      if (!existing) continue;
      const totalAmt  = parseFloat(cm.TotalAmt) || 0;
      const balance   = parseFloat(cm.Balance)  || 0;
      const taxAmt    = parseFloat(cm.TxnTaxDetail?.TotalTax) || 0;
      const netAmt    = Math.max(0, totalAmt - taxAmt);
      const netBal    = totalAmt > 0 ? Math.max(0, (balance / totalAmt) * netAmt) : 0;
      updatePromises.push(
        db
          .update(invoices)
          .set({
            total:         -netAmt,   // face value stays negative
            amount:        -netAmt,
            paid:          0,         // not applicable for CMs
            qboBalance:    -netBal,   // negative unapplied balance
            qboSyncedAt:   new Date(),
            updatedAt:     new Date(),
            paymentStatus: balance === 0 ? "Paid" : "Unpaid",
          })
          .where(eq(invoices.id, existing.id))
      );
    }
  }

  // --- Deleted / Voided ---
  const allDeletedQboIds = [
    ...deletedInvoiceQboIds,
    ...deletedCreditQboIds,
  ];
  for (const qboId of allDeletedQboIds) {
    const existing = ledgerInvByQboId.get(qboId);
    if (!existing) continue;
    updatePromises.push(
      db
        .update(invoices)
        .set({ paymentStatus: "Written Off", collectionStage: "Closed", updatedAt: new Date() })
        .where(eq(invoices.id, existing.id))
    );
  }

  // --- Execute ---
  if (invsToInsert.length > 0) await db.insert(invoices).values(invsToInsert);
  if (updatePromises.length > 0) await Promise.all(updatePromises);
}
