/**
 * Shared QBO sync logic.
 * Used by:
 *   - POST /api/qbo/sync      — manual sync from Settings
 *   - GET  /api/cron/qbo-sync — scheduled full sync (every 30 min)
 *   - POST /api/webhooks/qbo  — real-time targeted sync on entity change
 */

import { db } from "@/db";
import {
  qboTokens, qboSyncLog, customers, projects, invoices, contacts,
  payments, paymentApplications, refundReceipts, journalEntryArLines,
  deposits,
} from "@/db/schema";
import { eq, inArray, and, isNull } from "drizzle-orm";

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
    if (!res.ok) {
      // Refresh failed — most commonly because the refresh token expired
      // (100-day rolling window) or was revoked from inside QuickBooks. The
      // stale access token is unusable; returning it just produces a
      // confusing 401 downstream. Surface a clear error so the user
      // reconnects QBO via Settings → Integrations.
      const body = await res.text().catch(() => "");
      throw new Error(`QBO refresh token rejected (HTTP ${res.status}). Reconnect QuickBooks under Settings → Integrations. Detail: ${body.slice(0, 200)}`);
    }
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
  // NOTE: no `Active = true` filter — we pull every customer (including inactive)
  // so historical transactions and payments can resolve their customer FK.
  const allQboCustomers = await qboFetchAllSafe(accessToken, realmId, "Customer");
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
  await sleep(500);
  // Fetch all RefundReceipts — money paid out to customers
  const allQboRefundReceipts = await qboFetchAllSafe(accessToken, realmId, "RefundReceipt");
  await sleep(500);
  // Fetch all JournalEntries — needed for AR adjustments (write-offs, audit corrections,
  // inter-company transfers). Without these, customer AR can be wildly overstated.
  const allQboJournalEntries = await qboFetchAllSafe(accessToken, realmId, "JournalEntry");
  await sleep(300);
  // Fetch all Deposits — some deposit lines hit the AR account directly and
  // need to be captured so customer balances tie to QBO.
  const allQboDeposits = await qboFetchAllSafe(accessToken, realmId, "Deposit");
  await sleep(300);
  // Discover Accounts Receivable account ID(s) — usually one per currency
  const arAccountsRaw = await qboQuery(
    accessToken, realmId,
    `SELECT Id, Name, CurrencyRef FROM Account WHERE AccountType = 'Accounts Receivable'`
  );
  const arAccountIds = new Set<string>(
    (arAccountsRaw?.QueryResponse?.Account || []).map((a: any) => String(a.Id))
  );
  const arAccountNameById = new Map<string, string>(
    (arAccountsRaw?.QueryResponse?.Account || []).map((a: any) => [String(a.Id), a.Name as string])
  );

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

  // Fallback closing-date map: built from the Invoice's own LinkedTxn field.
  // QBO populates LinkedTxn on every Invoice with whatever closed it —
  // credit memos, journal entries, write-offs, etc. For invoices not in
  // paymentDateByInvId (no cash payment), this gives us the actual close date
  // so paidAt is populated even for CM/JE-settled invoices.
  const linkedTxnDateByInvId = new Map<string, string>();
  for (const qi of allInvoicesForClose) {
    if (!qi.Id || !Array.isArray(qi.LinkedTxn) || qi.LinkedTxn.length === 0) continue;
    const dates = (qi.LinkedTxn as any[])
      .map((l: any) => l.TxnDate)
      .filter((d: any) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (dates.length > 0) {
      linkedTxnDateByInvId.set(qi.Id, [...dates].sort().at(-1)!);
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
      // Mirror QBO active flag — inactive customers (Active=false) come in as Inactive here.
      // QBO uses `Active` (boolean). Default to Active if the field is missing.
      status: (qc.Active === false ? "Inactive" : "Active") as "Active" | "Inactive",
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

  // Reload customers — scoped to THIS org (pre-existing data-isolation fix)
  const freshCustomers = await db.select().from(customers).where(eq(customers.orgId, orgId));
  const freshCustByQboId = new Map(
    freshCustomers.filter((c) => c.qboId).map((c) => [c.qboId!, c])
  );
  const freshCustByCode = new Map(freshCustomers.map((c) => [c.code, c]));

  // STEP 4: Contacts
  // - New customer with no contact → create from QBO PrimaryEmailAddr
  // - Existing contact whose email differs from QBO → update it (Option B:
  //   auto-sync so new invoice email addresses flow through automatically).
  //   Users can override in the Automations UI; the next QBO sync will update
  //   again only when QBO itself has a newer email address.
  const contactsToInsert: any[] = [];
  const contactEmailUpdates: Array<{ id: string; email: string }> = [];

  for (const qc of parentCustomers) {
    if (!qc.PrimaryEmailAddr?.Address) continue;
    const cust = freshCustByQboId.get(qc.Id) || freshCustByCode.get(`QBO-${qc.Id}`);
    if (!cust) continue;

    const existingContact = ledgerContactsByCustId.get(cust.id);
    if (!existingContact) {
      // No contact yet — create one
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
    } else if (existingContact.email !== qc.PrimaryEmailAddr.Address) {
      // Email changed in QBO — keep contact in sync
      contactEmailUpdates.push({ id: existingContact.id, email: qc.PrimaryEmailAddr.Address });
    }
  }

  if (contactsToInsert.length > 0) {
    for (let i = 0; i < contactsToInsert.length; i += 100)
      await db.insert(contacts).values(contactsToInsert.slice(i, i + 100));
  }
  for (const { id, email } of contactEmailUpdates) {
    await db.update(contacts).set({ email, updatedAt: new Date() }).where(eq(contacts.id, id));
  }

  // STEP 5: Sub-customers as projects
  //
  // Handles nested cases (e.g. Customer → Job → Sub-job) by walking the
  // ParentRef chain via custMap (which holds ALL QBO customers, both top-level
  // and sub) up to the root, then linking the project to that top-level customer.
  // Without this, sub-sub-customers were silently dropped because their direct
  // parent isn't in the `customers` table.
  let projectsSkipped = 0;
  const projsToInsert: any[] = [];
  for (const qc of subCustomers) {
    // Walk up to the top-level customer id (some sub-customers don't have ParentRef
    // but are still marked Job=true — those get skipped here as a safety net)
    if (!qc.ParentRef?.value && !qc.Job) { projectsSkipped++; continue; }
    const rootQboCustId = qc.ParentRef?.value ? topLevelId(qc.ParentRef.value, custMap) : qc.Id;
    const parentCust =
      freshCustByQboId.get(rootQboCustId) ||
      freshCustByCode.get(`QBO-${rootQboCustId}`);
    if (!parentCust) { projectsSkipped++; continue; }
    const code = `QBO-PROJ-${qc.Id}`;
    if (!ledgerProjByCode.has(code)) {
      projsToInsert.push({
        orgId,
        customerId: parentCust.id,
        name: qc.DisplayName || qc.FullyQualifiedName,
        code,
        qboId: qc.Id,
        ownerId: userId,
        status: (qc.Active === false ? "Inactive" : "Active") as "Active" | "Inactive",
      });
      results.projects++;
    }
  }
  if (projsToInsert.length > 0) {
    for (let i = 0; i < projsToInsert.length; i += 100)
      await db.insert(projects).values(projsToInsert.slice(i, i + 100));
  }
  if (projectsSkipped > 0) {
    console.warn(`QBO sync: skipped ${projectsSkipped} sub-customer(s) — could not resolve parent customer`);
  }
  (results as any).projectsSkipped = projectsSkipped;

  // Reload projects — scoped to THIS org (fix pre-existing data-isolation bug)
  const freshProjects = await db.select().from(projects).where(eq(projects.orgId, orgId));
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

    // Detect a reopened invoice: previously Paid/Closed in our ledger but
    // QBO now shows a positive balance (e.g. accountant reversed a misapplied payment).
    // When this happens we must reset collectionStage and clear paidAt so the
    // invoice surfaces again in the active AR view.
    const wasClosedOrPaid = existing && (
      existing.paymentStatus === "Paid" || existing.collectionStage === "Closed"
    );

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
      // If the invoice is being reopened, reset stage to "Open" and clear paidAt
      ...(wasClosedOrPaid ? { collectionStage: "Open", paidAt: null } : {}),
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
  const creditsToUpdate: Array<{ id: string; data: any }> = [];

  for (const cm of openCredits) {
    const creditNumber = `CM-${cm.DocNumber || cm.Id}`;
    const tlId = topLevelId(cm.CustomerRef?.value, custMap);
    const cust = freshCustByQboId.get(tlId) || freshCustByCode.get(`QBO-${tlId}`);
    if (!cust) continue;

    const totalAmt  = parseFloat(cm.TotalAmt) || 0;
    const balance   = parseFloat(cm.Balance)  || 0;
    const taxAmount = parseFloat(cm.TxnTaxDetail?.TotalTax) || 0;
    const netAmt    = Math.max(0, totalAmt - taxAmount); // ex-tax face value

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

    // Match invoice convention: amount = ex-tax, total + qboBalance = gross.
    // (Previously total/qboBalance were ex-tax, which under-counted CM open
    //  amounts by the VAT — caused AR Aging to differ from QBO by tax%.)
    //
    // paymentStatus mirrors QBO:
    //   balance === 0  → fully applied ("Applied" in QBO) → "Paid" in our schema
    //   balance  >  0  → unapplied / partially applied    → "Unpaid"
    const cmFields = {
      amount: -netAmt,         // negative ex-tax face value (for sales reporting)
      taxAmount: -taxAmount,   // negative tax amount
      total: -totalAmt,        // negative GROSS face value (matches QBO TotalAmt)
      paid: 0,                 // not applicable for credit memos
      qboBalance: -balance,    // negative GROSS unapplied balance (matches QBO.Balance)
      qboCustomerId: cm.CustomerRef?.value,
      qboSyncedAt: new Date(),
      updatedAt: new Date(),
      paymentStatus: (balance === 0 ? "Paid" : "Unpaid") as "Paid" | "Unpaid",
    };

    const existing = ledgerInvByNumber.get(creditNumber) || ledgerInvByQboId.get(`CM-${cm.Id}`);
    if (existing) {
      // Update existing — applies the gross-balance fix to historical CMs on next sync.
      creditsToUpdate.push({ id: existing.id, data: cmFields });
    } else {
      creditsToInsert.push({
        orgId,
        invoiceNumber: creditNumber,
        customerId: cust.id,
        projectId: cmProjectId,
        invoiceDate: cm.TxnDate || new Date().toISOString().slice(0, 10),
        dueDate: cm.TxnDate || new Date().toISOString().slice(0, 10),
        currency: cust.currency || "EUR",
        ...cmFields,       // includes paymentStatus derived from balance
        paymentTerms: 0,
        collectionStage: "Credit Memo",
        collectionOwnerId: userId,
        qboId: `CM-${cm.Id}`,
        txnType: "CreditMemo",
        notes: `Credit memo from QBO — ${cm.DocNumber || cm.Id}`,
      });
      results.creditsCreated++;
    }
  }
  if (creditsToInsert.length > 0) await db.insert(invoices).values(creditsToInsert);
  if (creditsToUpdate.length > 0) {
    for (let i = 0; i < creditsToUpdate.length; i += 50) {
      const chunk = creditsToUpdate.slice(i, i + 50);
      await Promise.all(chunk.map(({ id, data }) =>
        db.update(invoices).set(data).where(eq(invoices.id, id))
      ));
    }
  }

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

    // Prefer payment TxnDate; fall back to most recent LinkedTxn date on the
    // invoice itself (covers CM applications, JE write-offs, direct adjustments).
    const qboPaidAt = paymentDateByInvId.get(qi.Id)
      || linkedTxnDateByInvId.get(qi.Id)
      || null;

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

  // STEP 7.6: Persist Payments + Applications + Refund Receipts
  // (Phase 1 of event-sourced AR: store every transaction that hits AR
  // so historical AR aging and true DSO can be computed.)
  // FAIL-SOFT: any error here logs + sets a flag and continues — sync must not
  // be blocked by event-store failures (e.g. migration not yet applied).
  try {
    // Refresh ledger state for FK resolution (we may have just inserted new invoices)
    const freshCustomers = await db.select({ id: customers.id, qboId: customers.qboId })
      .from(customers).where(eq(customers.orgId, orgId));
    const freshInvoices = await db.select({ id: invoices.id, qboId: invoices.qboId })
      .from(invoices).where(eq(invoices.orgId, orgId));
    const custByQboId = new Map(freshCustomers.filter(c => c.qboId).map(c => [c.qboId!, c.id]));
    const invByQboId = new Map(freshInvoices.filter(i => i.qboId).map(i => [i.qboId!, i.id]));
    // Credit memos are stored in `invoices` with qboId prefixed `CM-`
    const cmByRawId = new Map<string, string>();
    for (const inv of freshInvoices) {
      if (inv.qboId?.startsWith("CM-")) cmByRawId.set(inv.qboId.slice(3), inv.id);
    }

    // ----- PAYMENTS -----
    let paymentsCreated = 0;
    let paymentsUpdated = 0;
    let appsCreated = 0;

    // Pre-load existing payments so we can do upsert manually
    const existingPayments = await db
      .select({ id: payments.id, qboId: payments.qboId })
      .from(payments)
      .where(eq(payments.orgId, orgId));
    const existingPayByQboId = new Map(
      existingPayments.filter(p => p.qboId).map(p => [p.qboId!, p.id])
    );

    let paymentsSkipped = 0;
    let zeroPaymentApps = 0; // count of applications skipped because payment.TotalAmt = 0
    const paymentErrors: Array<{ qboId: string; reason: string }> = [];

    // STEP A: Categorise payments into insert vs update — no DB calls in the loop
    const toInsert: any[] = [];
    const toUpdate: Array<{ id: string; data: any }> = [];

    for (const qpay of allQboPayments) {
      try {
        if (!qpay.Id) { paymentsSkipped++; paymentErrors.push({ qboId: "?", reason: "Missing Id" }); continue; }
        if (!qpay.TxnDate) { paymentsSkipped++; paymentErrors.push({ qboId: qpay.Id, reason: "Missing TxnDate" }); continue; }

        const qboCustId = qpay.CustomerRef?.value as string | undefined;
        const customerId = qboCustId ? (custByQboId.get(qboCustId) ?? null) : null;
        const payload = {
          orgId,
          qboId:               qpay.Id,
          customerId,
          qboCustomerId:       qboCustId ?? null,
          txnDate:             qpay.TxnDate,
          totalAmount:         parseFloat(qpay.TotalAmt) || 0,
          unappliedAmount:     parseFloat(qpay.UnappliedAmt) || 0,
          currency:            qpay.CurrencyRef?.value || "EUR",
          exchangeRate:        qpay.ExchangeRate ? parseFloat(qpay.ExchangeRate) : null,
          paymentMethod:       qpay.PaymentMethodRef?.name || null,
          paymentRef:          qpay.PaymentRefNum || null,
          depositAccountId:    qpay.DepositToAccountRef?.value || null,
          depositAccountName:  qpay.DepositToAccountRef?.name || null,
          privateNote:         qpay.PrivateNote || null,
          qboSyncedAt:         new Date(),
          updatedAt:           new Date(),
        };

        const existingId = existingPayByQboId.get(qpay.Id);
        if (existingId) { toUpdate.push({ id: existingId, data: payload }); }
        else            { toInsert.push(payload); }
      } catch (e: any) {
        paymentsSkipped++;
        paymentErrors.push({ qboId: qpay.Id || "?", reason: e?.message || String(e) });
      }
    }

    // STEP B: Bulk insert new payments (chunks of 100)
    for (let i = 0; i < toInsert.length; i += 100) {
      try {
        await db.insert(payments).values(toInsert.slice(i, i + 100));
        paymentsCreated += Math.min(100, toInsert.length - i);
      } catch (e: any) {
        // Fall back to per-row insert so one bad row in the chunk doesn't lose 100
        for (const row of toInsert.slice(i, i + 100)) {
          try { await db.insert(payments).values(row); paymentsCreated++; }
          catch (err: any) {
            paymentsSkipped++;
            paymentErrors.push({ qboId: row.qboId, reason: err?.message || String(err) });
          }
        }
      }
    }

    // STEP C: Bulk update existing payments in parallel (with chunking to avoid connection pool exhaustion)
    for (let i = 0; i < toUpdate.length; i += 50) {
      const chunk = toUpdate.slice(i, i + 50);
      await Promise.all(chunk.map(({ id, data }) =>
        db.update(payments).set(data).where(eq(payments.id, id))
          .then(() => { paymentsUpdated++; })
          .catch((err: any) => {
            paymentsSkipped++;
            paymentErrors.push({ qboId: data.qboId, reason: err?.message || String(err) });
          })
      ));
    }

    // STEP D: Re-fetch all payments to get current IDs (for application FKs)
    const allPaymentsNow = await db
      .select({ id: payments.id, qboId: payments.qboId })
      .from(payments)
      .where(eq(payments.orgId, orgId));
    const paymentIdByQboId = new Map(allPaymentsNow.filter(p => p.qboId).map(p => [p.qboId!, p.id]));
    const allPaymentDbIds = allPaymentsNow.map(p => p.id);

    // STEP E: Build all applications across all payments — pure JS, no DB calls
    //
    // Special handling for zero-amount payments (TotalAmt = 0):
    // QBO uses these as bookkeeping records to "apply" existing credits
    // against invoices. The credit source can be either:
    //   (A) A CreditMemo — the CM is in the same Line's LinkedTxn[]
    //   (B) A Journal Entry credit to AR — usually NOT in LinkedTxn[]
    //
    // For case (A) we MUST keep the application, otherwise the invoice will
    // appear open in our AR even though the CM closed it.
    // For case (B) we MUST skip the application, otherwise we double-count
    // (the JE_AR_line already captures the reduction).
    //
    // Heuristic: for a zero-amount payment line, keep the application only
    // if that line's LinkedTxn[] includes a CreditMemo (case A signal).
    const allApps: any[] = [];
    for (const qpay of allQboPayments) {
      const paymentRowId = paymentIdByQboId.get(qpay.Id);
      if (!paymentRowId) continue;

      const paymentTotal = parseFloat(qpay.TotalAmt) || 0;
      const isZeroPayment = paymentTotal < 0.005;

      // Capture every LinkedTxn target on every payment line (cash and
      // zero-amount). This is the authoritative event log of how AR is
      // settled in QBO:
      //   - Invoice         → invoice has been (partially) paid
      //   - CreditMemo      → CM has been applied
      //   - JournalEntry    → JE has been applied (zero-amount payment trick).
      //                       Without this, JEs live forever in our balance
      //                       calc even after QBO has netted them out.
      //
      // Previously zero-amount payments without a CreditMemo in LinkedTxn
      // were dropped wholesale to "avoid double-counting" — but the JE_AR_line
      // table only records the JE's existence and gross amount, it has no
      // way to know the JE has been applied. The application record is what
      // closes that loop, so we capture it.
      for (const line of (qpay.Line || [])) {
        const linked = line.LinkedTxn || [];
        const amount = parseFloat(line.Amount) || 0;
        for (const l of linked) {
          const targetType  = l.TxnType  as string;
          const targetQboId = l.TxnId    as string;
          // TxnLineId identifies the specific sub-line on the target txn.
          // Crucial for JEs: one JE header can carry multiple AR lines for
          // different customers, so the application has to know which line
          // it applies to. May be absent on some payloads — the aging
          // engine falls back to customer/account matching when null.
          const targetLineId = (l.TxnLineId as string | undefined) ?? null;
          if (!targetQboId || !targetType) continue;
          if (!["Invoice", "CreditMemo", "JournalEntry"].includes(targetType)) continue;
          const invoiceId = targetType === "Invoice"
            ? (invByQboId.get(targetQboId) ?? null)
            : targetType === "CreditMemo"
              ? (cmByRawId.get(targetQboId) ?? null)
              : null; // JournalEntry has no FK to invoices table
          allApps.push({
            orgId, paymentId: paymentRowId,
            invoiceId, targetQboId, targetType, targetLineId,
            amountApplied: amount,
          });
        }
      }
      void isZeroPayment; // kept for future use; no longer used to gate
    }
    if (zeroPaymentApps > 0) {
      console.log(`QBO sync: skipped ${zeroPaymentApps} application(s) from JE-backed zero-amount payments (CM-backed zero-payments were retained)`);
    }

    // STEP F: Wipe and re-insert applications for these payments (idempotent)
    if (allPaymentDbIds.length > 0) {
      // chunk the delete to avoid hitting parameter limits
      for (let i = 0; i < allPaymentDbIds.length; i += 500) {
        await db.delete(paymentApplications)
          .where(inArray(paymentApplications.paymentId, allPaymentDbIds.slice(i, i + 500)));
      }
    }
    for (let i = 0; i < allApps.length; i += 200) {
      try {
        await db.insert(paymentApplications).values(allApps.slice(i, i + 200));
        appsCreated += Math.min(200, allApps.length - i);
      } catch (e: any) {
        // Per-row fallback for app inserts
        for (const app of allApps.slice(i, i + 200)) {
          try { await db.insert(paymentApplications).values(app); appsCreated++; } catch {}
        }
      }
    }

    if (paymentsSkipped > 0) {
      console.warn(
        `QBO sync: skipped ${paymentsSkipped} payment(s). First 10 errors:`,
        paymentErrors.slice(0, 10)
      );
    }

    // ----- REFUND RECEIPTS -----
    let refundsCreated = 0;
    let refundsUpdated = 0;

    const existingRefunds = await db
      .select({ id: refundReceipts.id, qboId: refundReceipts.qboId })
      .from(refundReceipts)
      .where(eq(refundReceipts.orgId, orgId));
    const existingRefundByQboId = new Map(
      existingRefunds.filter(r => r.qboId).map(r => [r.qboId!, r.id])
    );

    let refundsSkipped = 0;
    const refundsToInsert: any[] = [];
    const refundsToUpdate: Array<{ id: string; data: any }> = [];

    for (const qref of allQboRefundReceipts) {
      try {
        if (!qref.Id || !qref.TxnDate) { refundsSkipped++; continue; }
        const qboCustId = qref.CustomerRef?.value as string | undefined;
        const customerId = qboCustId ? (custByQboId.get(qboCustId) ?? null) : null;
        const payload = {
          orgId,
          qboId:                  qref.Id,
          customerId,
          qboCustomerId:          qboCustId ?? null,
          txnDate:                qref.TxnDate,
          totalAmount:            parseFloat(qref.TotalAmt) || 0,
          currency:               qref.CurrencyRef?.value || "EUR",
          paymentMethod:          qref.PaymentMethodRef?.name || null,
          refundFromAccountId:    qref.DepositToAccountRef?.value || null,
          refundFromAccountName:  qref.DepositToAccountRef?.name || null,
          privateNote:            qref.PrivateNote || null,
          qboSyncedAt:            new Date(),
          updatedAt:              new Date(),
        };

        const existingId = existingRefundByQboId.get(qref.Id);
        if (existingId) refundsToUpdate.push({ id: existingId, data: payload });
        else            refundsToInsert.push(payload);
      } catch {
        refundsSkipped++;
      }
    }

    for (let i = 0; i < refundsToInsert.length; i += 100) {
      try {
        await db.insert(refundReceipts).values(refundsToInsert.slice(i, i + 100));
        refundsCreated += Math.min(100, refundsToInsert.length - i);
      } catch {
        for (const r of refundsToInsert.slice(i, i + 100)) {
          try { await db.insert(refundReceipts).values(r); refundsCreated++; } catch { refundsSkipped++; }
        }
      }
    }
    for (let i = 0; i < refundsToUpdate.length; i += 50) {
      await Promise.all(refundsToUpdate.slice(i, i + 50).map(({ id, data }) =>
        db.update(refundReceipts).set(data).where(eq(refundReceipts.id, id))
          .then(() => { refundsUpdated++; })
          .catch(() => { refundsSkipped++; })
      ));
    }

    // ----- JOURNAL ENTRY AR LINES -----
    // Walk every JournalEntry, extract lines posting to the AR account,
    // and persist as journal_entry_ar_lines. These are critical for accurate
    // customer AR aging (audit adjustments, write-offs, inter-co transfers).
    let jeLinesCreated = 0, jeLinesUpdated = 0, jeLinesSkipped = 0;
    if (arAccountIds.size > 0) {
      // Pre-load existing AR JE lines for upsert
      const existing = await db
        .select({ id: journalEntryArLines.id, qboJournalId: journalEntryArLines.qboJournalId, qboLineId: journalEntryArLines.qboLineId })
        .from(journalEntryArLines)
        .where(eq(journalEntryArLines.orgId, orgId));
      const existingKey = (jid: string, lid: string | null) => `${jid}|${lid ?? ""}`;
      const existingMap = new Map(existing.map(r => [existingKey(r.qboJournalId, r.qboLineId), r.id]));

      const toInsert: any[] = [];
      const toUpdate: Array<{ id: string; data: any }> = [];

      for (const je of allQboJournalEntries) {
        try {
          if (!je.Id || !je.TxnDate) { jeLinesSkipped++; continue; }
          for (const line of (je.Line || [])) {
            const detail = line.JournalEntryLineDetail;
            if (!detail) continue;
            const accountId = String(detail.AccountRef?.value || "");
            if (!arAccountIds.has(accountId)) continue; // not an AR line — skip

            const lineId = line.Id || null;
            const postingType = detail.PostingType as string; // 'Debit' or 'Credit'
            const rawAmount = parseFloat(line.Amount) || 0;
            // Signed amount: Debit AR = +ve (increases customer balance);
            // Credit AR = -ve (decreases / writes off)
            const signedAmount = postingType === "Credit" ? -rawAmount : rawAmount;

            // Customer reference (only AR lines should have an Entity, but be defensive)
            const entityRef = detail.Entity?.EntityRef;
            const qboCustId = entityRef?.value ? String(entityRef.value) : null;
            const customerId = qboCustId ? (custByQboId.get(qboCustId) ?? null) : null;

            const data = {
              orgId,
              qboJournalId: String(je.Id),
              qboLineId: lineId,
              docNumber: je.DocNumber || null,
              customerId,
              qboCustomerId: qboCustId,
              accountId,
              accountName: arAccountNameById.get(accountId) || null,
              txnDate: je.TxnDate,
              amount: signedAmount,
              currency: je.CurrencyRef?.value || "EUR",
              exchangeRate: je.ExchangeRate ? parseFloat(je.ExchangeRate) : null,
              description: line.Description || je.PrivateNote || null,
              voided: false,
              qboSyncedAt: new Date(),
              updatedAt: new Date(),
            };

            const existingId = existingMap.get(existingKey(data.qboJournalId, data.qboLineId));
            if (existingId) toUpdate.push({ id: existingId, data });
            else            toInsert.push(data);
          }
        } catch (e: any) {
          jeLinesSkipped++;
          console.warn(`JE ${je.Id || "?"}: ${e?.message || e}`);
        }
      }

      // Bulk insert
      for (let i = 0; i < toInsert.length; i += 100) {
        try {
          await db.insert(journalEntryArLines).values(toInsert.slice(i, i + 100));
          jeLinesCreated += Math.min(100, toInsert.length - i);
        } catch {
          for (const row of toInsert.slice(i, i + 100)) {
            try { await db.insert(journalEntryArLines).values(row); jeLinesCreated++; }
            catch { jeLinesSkipped++; }
          }
        }
      }
      // Parallel updates
      for (let i = 0; i < toUpdate.length; i += 50) {
        await Promise.all(toUpdate.slice(i, i + 50).map(({ id, data }) =>
          db.update(journalEntryArLines).set(data).where(eq(journalEntryArLines.id, id))
            .then(() => { jeLinesUpdated++; })
            .catch(() => { jeLinesSkipped++; })
        ));
      }
    }

    // ----- DEPOSITS (AR-affecting lines) -----
    // A QBO Deposit transaction can include lines that post directly to the
    // AR account for a customer — typical for recording overpayments or
    // funds received without a matching Payment. Mirror the JE pattern:
    // one row per Deposit.Line where AccountRef matches an AR account.
    let depositsCreated = 0, depositsUpdated = 0, depositsSkipped = 0;
    if (arAccountIds.size > 0) {
      const existingDeps = await db
        .select({ id: deposits.id, qboId: deposits.qboId, qboLineId: deposits.qboLineId })
        .from(deposits)
        .where(eq(deposits.orgId, orgId));
      const depKey = (jid: string, lid: string | null) => `${jid}|${lid ?? ""}`;
      const existingDepMap = new Map(existingDeps.map(r => [depKey(r.qboId, r.qboLineId), r.id]));

      const depsToInsert: any[] = [];
      const depsToUpdate: Array<{ id: string; data: any }> = [];

      for (const dep of allQboDeposits) {
        try {
          if (!dep.Id || !dep.TxnDate) { depositsSkipped++; continue; }
          for (const line of (dep.Line || [])) {
            const detail = line.DepositLineDetail;
            if (!detail) continue;
            const accountId = String(detail.AccountRef?.value || "");
            if (!arAccountIds.has(accountId)) continue; // not an AR line — skip

            const lineId = line.Id || null;
            // For a Deposit, the offset to the deposit-into account is a CREDIT
            // to whatever account is in DepositLineDetail.AccountRef. So a line
            // hitting AR is reducing AR — store as negative (customer credit).
            const rawAmount = parseFloat(line.Amount) || 0;
            const signedAmount = -Math.abs(rawAmount);

            // Customer reference on the deposit line
            const entityRef = detail.Entity;
            const qboCustId =
              entityRef?.value ? String(entityRef.value)
              : entityRef?.EntityRef?.value ? String(entityRef.EntityRef.value)
              : null;
            const customerId = qboCustId ? (custByQboId.get(qboCustId) ?? null) : null;

            const data = {
              orgId,
              qboId:         String(dep.Id),
              qboLineId:     lineId,
              customerId,
              qboCustomerId: qboCustId,
              accountId,
              accountName:   arAccountNameById.get(accountId) || null,
              txnDate:       dep.TxnDate,
              amount:        signedAmount,
              currency:      dep.CurrencyRef?.value || "EUR",
              description:   line.Description || null,
              privateNote:   dep.PrivateNote || null,
              qboSyncedAt:   new Date(),
              updatedAt:     new Date(),
            };

            const existingId = existingDepMap.get(depKey(data.qboId, data.qboLineId));
            if (existingId) depsToUpdate.push({ id: existingId, data });
            else            depsToInsert.push(data);
          }
        } catch (e: any) {
          depositsSkipped++;
          console.warn(`Deposit ${dep.Id || "?"}: ${e?.message || e}`);
        }
      }

      for (let i = 0; i < depsToInsert.length; i += 100) {
        try {
          await db.insert(deposits).values(depsToInsert.slice(i, i + 100));
          depositsCreated += Math.min(100, depsToInsert.length - i);
        } catch {
          for (const row of depsToInsert.slice(i, i + 100)) {
            try { await db.insert(deposits).values(row); depositsCreated++; }
            catch { depositsSkipped++; }
          }
        }
      }
      for (let i = 0; i < depsToUpdate.length; i += 50) {
        await Promise.all(depsToUpdate.slice(i, i + 50).map(({ id, data }) =>
          db.update(deposits).set(data).where(eq(deposits.id, id))
            .then(() => { depositsUpdated++; })
            .catch(() => { depositsSkipped++; })
        ));
      }
    }
    (results as any).depositsCreated = depositsCreated;
    (results as any).depositsUpdated = depositsUpdated;
    (results as any).depositsSkipped = depositsSkipped;

    (results as any).paymentsCreated = paymentsCreated;
    (results as any).paymentsUpdated = paymentsUpdated;
    (results as any).paymentApplicationsCreated = appsCreated;
    (results as any).paymentsSkipped = paymentsSkipped;
    (results as any).zeroPaymentAppsSkipped = zeroPaymentApps;
    (results as any).refundsCreated = refundsCreated;
    (results as any).refundsUpdated = refundsUpdated;
    (results as any).refundsSkipped = refundsSkipped;
    (results as any).jeArLinesCreated = jeLinesCreated;
    (results as any).jeArLinesUpdated = jeLinesUpdated;
    (results as any).jeArLinesSkipped = jeLinesSkipped;

    console.log(
      `QBO sync: persisted payments (${paymentsCreated} new, ${paymentsUpdated} updated, ${appsCreated} applications, ${paymentsSkipped} skipped), ` +
      `refunds (${refundsCreated} new, ${refundsUpdated} updated, ${refundsSkipped} skipped), ` +
      `JE AR lines (${jeLinesCreated} new, ${jeLinesUpdated} updated, ${jeLinesSkipped} skipped) for org ${orgId}`
    );
  } catch (e: any) {
    // Most likely cause: migration `db/migration-payments.sql` not yet applied.
    // Surface a clear warning but let the rest of the sync (invoices, customers,
    // aging, reconciliation) complete normally.
    const msg = e?.message || String(e);
    console.warn(`QBO sync STEP 7.6 (payments persistence) skipped due to error: ${msg}`);
    (results as any).paymentsCreated = 0;
    (results as any).paymentsUpdated = 0;
    (results as any).paymentApplicationsCreated = 0;
    (results as any).refundsCreated = 0;
    (results as any).refundsUpdated = 0;
    (results as any).paymentsPersistenceError = msg;
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

  // STEP 8b: Auto-mark customers and projects Inactive when they have no open AR
  // A customer/project with zero open invoices (and no unapplied CMs) has nothing
  // left to collect — mark Inactive so they drop out of the active collections view.
  {
    const allCurrentInvoices = await db.select({
      customerId: invoices.customerId,
      projectId: invoices.projectId,
      paymentStatus: invoices.paymentStatus,
      collectionStage: invoices.collectionStage,
      txnType: invoices.txnType,
      qboBalance: invoices.qboBalance,
    }).from(invoices).where(eq(invoices.orgId, orgId));

    // Build sets of customer/project IDs that still have open AR
    const activeCustomerIds = new Set<string>();
    const activeProjectIds  = new Set<string>();
    for (const inv of allCurrentInvoices) {
      const isOpen = inv.txnType !== "CreditMemo"
        ? inv.paymentStatus !== "Paid" && inv.collectionStage !== "Closed"
        : (inv.qboBalance ?? 0) < 0; // unapplied CM
      if (isOpen) {
        if (inv.customerId) activeCustomerIds.add(inv.customerId);
        if (inv.projectId)  activeProjectIds.add(inv.projectId);
      }
    }

    // Customers currently Active but with no open AR → Inactive
    const activeCustomers = await db.select({ id: customers.id })
      .from(customers)
      .where(eq(customers.orgId, orgId));
    const customersToDeactivate = activeCustomers
      .filter(c => c.id && !activeCustomerIds.has(c.id));
    if (customersToDeactivate.length > 0) {
      await db.update(customers)
        .set({ status: "Inactive", updatedAt: new Date() })
        .where(inArray(customers.id, customersToDeactivate.map(c => c.id)));
    }

    // Projects currently Active but with no open AR → Inactive
    const activeProjects = await db.select({ id: projects.id })
      .from(projects)
      .where(eq(projects.orgId, orgId));
    const projectsToDeactivate = activeProjects
      .filter(p => p.id && !activeProjectIds.has(p.id));
    if (projectsToDeactivate.length > 0) {
      await db.update(projects)
        .set({ status: "Inactive", updatedAt: new Date() })
        .where(inArray(projects.id, projectsToDeactivate.map(p => p.id)));
    }
  }

  // STEP 8c: Auto-backfill paidAt for historical paid invoices
  // The regular sync only updates paidAt on invoices it actively processes.
  // Historical paid invoices (already Paid in our ledger with paidAt = NULL)
  // are not re-fetched, so they stay un-backfilled. Run a small pass here
  // using the paymentDateByInvId map we already built earlier in this sync.
  {
    const unpopulated = await db
      .select({ id: invoices.id, qboId: invoices.qboId })
      .from(invoices)
      .where(and(
        eq(invoices.orgId, orgId),
        eq(invoices.paymentStatus, "Paid"),
        isNull(invoices.paidAt),
      ));

    let backfilled = 0;
    for (const inv of unpopulated) {
      const paidDate = inv.qboId
        ? (paymentDateByInvId.get(inv.qboId) || linkedTxnDateByInvId.get(inv.qboId))
        : undefined;
      if (!paidDate) continue;
      await db.update(invoices)
        .set({ paidAt: paidDate, updatedAt: new Date() })
        .where(and(eq(invoices.id, inv.id), eq(invoices.orgId, orgId)));
      backfilled++;
    }
    if (backfilled > 0) {
      console.log(`QBO sync: auto-backfilled paidAt on ${backfilled} historical invoice(s) for org ${orgId}`);
    }
    (results as any).paidAtBackfilled = backfilled;
  }

  // STEP 9: Reconciliation totals — scoped to THIS org only
  const currentInvoices = await db.select().from(invoices).where(eq(invoices.orgId, orgId));
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
  name: string;      // "Invoice" | "Payment" | "CreditMemo" | "Customer" | "RefundReceipt"
  id: string;        // QBO entity ID
  operation: string; // "Create" | "Update" | "Delete" | "Void" | "Merge"
  deletedId?: string; // Merge only — the QBO ID of the record that was absorbed/deleted
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
    .filter((e) => e.name === "Invoice" && !["Delete", "Void", "Merge"].includes(e.operation))
    .map((e) => e.id);
  const creditIds = entityChanges
    .filter((e) => e.name === "CreditMemo" && !["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  const paymentIds = entityChanges
    .filter((e) => e.name === "Payment" && !["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  const deletedPaymentQboIds = entityChanges
    .filter((e) => e.name === "Payment" && ["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  const deletedInvoiceQboIds = entityChanges
    .filter((e) => e.name === "Invoice" && ["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  const deletedCreditQboIds = entityChanges
    .filter((e) => e.name === "CreditMemo" && ["Delete", "Void"].includes(e.operation))
    .map((e) => `CM-${e.id}`);
  const customerIds = entityChanges
    .filter((e) => e.name === "Customer" && !["Delete", "Void", "Merge"].includes(e.operation))
    .map((e) => e.id);
  const refundIds = entityChanges
    .filter((e) => e.name === "RefundReceipt" && !["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  const deletedRefundQboIds = entityChanges
    .filter((e) => e.name === "RefundReceipt" && ["Delete", "Void"].includes(e.operation))
    .map((e) => e.id);
  // Merge: the surviving record gets a regular Update; we need to clean up the deleted side
  const mergedInvoiceDeletedIds = entityChanges
    .filter((e) => e.name === "Invoice" && e.operation === "Merge" && e.deletedId)
    .map((e) => e.deletedId!);
  const mergedCustomerDeletedIds = entityChanges
    .filter((e) => e.name === "Customer" && e.operation === "Merge" && e.deletedId)
    .map((e) => e.deletedId!);

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

    // Payment date comes from the caller (Payment.TxnDate passed by the webhook handler).
    const qboPaidAt = isPaid ? (paymentDate || null) : null;

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
          // Close when paid; reopen (reset stage + clear paidAt) when a previously
          // paid/closed invoice regains a positive balance (e.g. reversed payment).
          ...(isPaid
            ? { collectionStage: "Closed" }
            : (existing.paymentStatus === "Paid" || existing.collectionStage === "Closed")
              ? { collectionStage: "Open", paidAt: null }
              : {}),
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
      updatePromises.push(
        db
          .update(invoices)
          .set({
            // Match invoice convention: total + qboBalance = GROSS; amount = ex-tax.
            total:         -totalAmt, // negative GROSS face value (matches QBO TotalAmt)
            amount:        -netAmt,   // negative ex-tax (for sales reporting)
            taxAmount:     -taxAmt,
            paid:          0,         // not applicable for CMs
            qboBalance:    -balance,  // negative GROSS unapplied balance (matches QBO.Balance)
            qboSyncedAt:   new Date(),
            updatedAt:     new Date(),
            paymentStatus: balance === 0 ? "Paid" : "Unpaid",
          })
          .where(eq(invoices.id, existing.id))
      );
    }
  }

  // --- Deleted / Voided Invoices & Credit Memos ---
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

  // --- Payment Delete / Void: reopen linked invoices ---
  // A deleted/voided payment no longer reduces the invoice balance — re-fetch
  // the affected invoices from QBO so their balance/status reflect the reversal.
  if (deletedPaymentQboIds.length > 0) {
    // Find the local payment records by QBO ID so we can look up their applications
    const localPayments = await db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.orgId, orgId), inArray(payments.qboId, deletedPaymentQboIds)));

    if (localPayments.length > 0) {
      const localPaymentIds = localPayments.map((p) => p.id);
      // Find every invoice that was paid (at least partially) by these payments
      const apps = await db
        .select({ targetQboId: paymentApplications.targetQboId, targetType: paymentApplications.targetType })
        .from(paymentApplications)
        .where(
          and(
            inArray(paymentApplications.paymentId, localPaymentIds),
            eq(paymentApplications.targetType, "Invoice"),
          )
        );

      const linkedInvoiceQboIds = [...new Set(apps.map((a) => a.targetQboId))];
      if (linkedInvoiceQboIds.length > 0) {
        // Re-fetch each invoice from QBO — balance will now reflect the reversal
        const refreshed = await Promise.all(
          linkedInvoiceQboIds.map((id) =>
            qboApiGet(accessToken, realmId, `invoice/${id}`)
              .then((r) => r.Invoice)
              .catch(() => null)
          )
        );
        for (const qi of refreshed.filter(Boolean)) await processQboInvoice(qi);
      }

      // Mark the deleted payments as removed in our local payments table
      if (localPayments.length > 0) {
        updatePromises.push(
          db
            .delete(payments)
            .where(and(eq(payments.orgId, orgId), inArray(payments.qboId, deletedPaymentQboIds)))
        );
      }
    }
  }

  // --- Customer changes: sync name, email, status ---
  if (customerIds.length > 0) {
    const qboCustomers = await Promise.all(
      customerIds.map((id) =>
        qboApiGet(accessToken, realmId, `customer/${id}`)
          .then((r) => r.Customer)
          .catch(() => null)
      )
    );
    for (const qc of qboCustomers.filter(Boolean)) {
      const existing = ledgerCustByQboId.get(qc.Id);
      if (!existing) continue; // Customer not in ledger yet — full sync will pick it up
      const isActive = qc.Active !== false; // QBO sets Active=false when deactivated
      updatePromises.push(
        db
          .update(customers)
          .set({
            name:      qc.FullyQualifiedName || qc.DisplayName || existing.name,
            email:     qc.PrimaryEmailAddr?.Address || existing.email,
            phone:     qc.PrimaryPhone?.FreeFormNumber || existing.phone,
            status:    isActive ? existing.status : "Inactive",
            updatedAt: new Date(),
          })
          .where(eq(customers.id, existing.id))
      );
    }
  }

  // --- RefundReceipt: upsert ---
  if (refundIds.length > 0) {
    const qboRefunds = await Promise.all(
      refundIds.map((id) =>
        qboApiGet(accessToken, realmId, `refundreceipt/${id}`)
          .then((r) => r.RefundReceipt)
          .catch(() => null)
      )
    );
    for (const rr of qboRefunds.filter(Boolean)) {
      const qboCustomerId: string | undefined = rr.CustomerRef?.value;
      const localCustomer = qboCustomerId ? ledgerCustByQboId.get(qboCustomerId) : undefined;

      // Check if we already have this refund
      const existingRefunds = await db
        .select({ id: refundReceipts.id })
        .from(refundReceipts)
        .where(and(eq(refundReceipts.orgId, orgId), eq(refundReceipts.qboId, rr.Id)))
        .limit(1);

      const refundFields = {
        orgId,
        qboId:                  rr.Id,
        customerId:             localCustomer?.id ?? null,
        qboCustomerId:          qboCustomerId ?? null,
        txnDate:                rr.TxnDate || new Date().toISOString().slice(0, 10),
        totalAmount:            parseFloat(rr.TotalAmt) || 0,
        currency:               rr.CurrencyRef?.value || "EUR",
        paymentMethod:          rr.PaymentMethodRef?.name || null,
        refundFromAccountId:    rr.DepositToAccountRef?.value || null,
        refundFromAccountName:  rr.DepositToAccountRef?.name || null,
        privateNote:            rr.PrivateNote || null,
        qboSyncedAt:            new Date(),
        updatedAt:              new Date(),
      };

      if (existingRefunds.length > 0) {
        updatePromises.push(
          db.update(refundReceipts).set(refundFields).where(eq(refundReceipts.id, existingRefunds[0].id))
        );
      } else {
        updatePromises.push(
          db.insert(refundReceipts).values(refundFields).onConflictDoNothing()
        );
      }
    }
  }

  // --- RefundReceipt deleted/voided: remove local record ---
  if (deletedRefundQboIds.length > 0) {
    updatePromises.push(
      db
        .delete(refundReceipts)
        .where(and(eq(refundReceipts.orgId, orgId), inArray(refundReceipts.qboId, deletedRefundQboIds)))
    );
  }

  // --- Merge: clean up the absorbed (deleted) side ---
  // The surviving record is handled by a companion Update event (normal flow above).
  // Here we just tombstone the record that was absorbed.
  if (mergedInvoiceDeletedIds.length > 0) {
    for (const deletedQboId of mergedInvoiceDeletedIds) {
      const existing = ledgerInvByQboId.get(deletedQboId);
      if (!existing) continue;
      updatePromises.push(
        db
          .update(invoices)
          .set({ paymentStatus: "Written Off", collectionStage: "Closed", updatedAt: new Date() })
          .where(eq(invoices.id, existing.id))
      );
    }
  }
  if (mergedCustomerDeletedIds.length > 0) {
    for (const deletedQboId of mergedCustomerDeletedIds) {
      const existing = ledgerCustByQboId.get(deletedQboId);
      if (!existing) continue;
      // Mark as inactive — the surviving customer absorbs all their invoices in QBO.
      // A subsequent full sync will re-parent the invoices to the surviving customer.
      updatePromises.push(
        db
          .update(customers)
          .set({ status: "Inactive", updatedAt: new Date() })
          .where(eq(customers.id, existing.id))
      );
    }
  }

  // --- Execute ---
  if (invsToInsert.length > 0) await db.insert(invoices).values(invsToInsert);
  if (updatePromises.length > 0) await Promise.all(updatePromises);
}
