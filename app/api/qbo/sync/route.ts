import { db } from "@/db";
import { qboTokens, qboSyncLog, customers, projects, invoices, contacts } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, inArray } from "drizzle-orm";

const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

// QBO rate limit: ~500 req/min on default plan. Add delay between page fetches.
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Sequential paginated fetch with delay between pages (safe for QBO rate limits)
async function qboFetchAllSafe(accessToken: string, realmId: string, entity: string, where = "") {
  const whereClause = where ? ` where ${where}` : "";
  const all: any[] = [];
  let start = 1;
  const size = 500; // Smaller pages = fewer throttle risks
  
  while (true) {
    const data = await qboQuery(accessToken, realmId,
      `select * from ${entity}${whereClause} STARTPOSITION ${start} MAXRESULTS ${size}`
    );
    const records = data.QueryResponse?.[entity] || [];
    all.push(...records);
    if (records.length < size) break;
    start += size;
    await sleep(300); // 300ms between pages = safe under QBO limits
  }
  return all;
}

// ============================================================
// TOKEN MANAGEMENT
// ============================================================
async function getValidToken(orgId: string, userId: string) {
  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId)).limit(1);
  if (!token) return null;
  const now = Date.now();
  if (new Date(token.accessTokenExpiresAt).getTime() - now < 10 * 60 * 1000) {
    const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Authorization": `Basic ${Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString("base64")}`,
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: token.refreshToken }),
    });
    if (!res.ok) return token;
    const d = await res.json();
    const updated = { ...token, accessToken: d.access_token, refreshToken: d.refresh_token || token.refreshToken, accessTokenExpiresAt: new Date(now + d.expires_in * 1000), refreshTokenExpiresAt: new Date(now + (d.x_refresh_token_expires_in || 8726400) * 1000) };
    await db.update(qboTokens).set({ accessToken: updated.accessToken, refreshToken: updated.refreshToken, accessTokenExpiresAt: updated.accessTokenExpiresAt, refreshTokenExpiresAt: updated.refreshTokenExpiresAt, updatedAt: new Date() }).where(eq(qboTokens.orgId, orgId));
    return updated;
  }
  return token;
}

// ============================================================
// QBO API HELPERS
// ============================================================
async function qboGet(accessToken: string, realmId: string, path: string) {
  const res = await fetch(`${QBO_API}/${realmId}/${path}&minorversion=65`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`QBO API ${res.status}: ${await res.text()}`);
  return res.json();
}

async function qboQuery(accessToken: string, realmId: string, sql: string) {
  return qboGet(accessToken, realmId, `query?query=${encodeURIComponent(sql)}`);
}

// Paginated fetch — counts first, then parallel pages
async function qboFetchAll(accessToken: string, realmId: string, entity: string, where = "") {
  const whereClause = where ? ` where ${where}` : "";
  const countData = await qboQuery(accessToken, realmId, `select count(*) from ${entity}${whereClause}`);
  const total = countData.QueryResponse?.totalCount || 0;
  if (total === 0) return [];
  const size = 1000;
  const pages = Math.ceil(total / size);
  const fetches = Array.from({ length: pages }, (_, i) =>
    qboQuery(accessToken, realmId, `select * from ${entity}${whereClause} STARTPOSITION ${i * size + 1} MAXRESULTS ${size}`)
  );
  const results = await Promise.all(fetches);
  return results.flatMap(r => r.QueryResponse?.[entity] || []);
}

// Walk up QBO hierarchy to find top-level parent
function topLevelId(custId: string, map: Map<string, any>): string {
  const c = map.get(custId);
  if (!c || !c.ParentRef?.value) return custId;
  return topLevelId(c.ParentRef.value, map);
}

// ============================================================
// MAIN SYNC
// ============================================================
export async function POST() {
  const startTime = Date.now();
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;
  const token = await getValidToken(orgId!, userId);
  if (!token) return bad("QuickBooks not connected. Go to Settings to connect.", 400);
  const { accessToken, realmId } = token;

  const results = {
    customers: 0, contacts: 0, projects: 0,
    invoicesCreated: 0, invoicesUpdated: 0, invoicesClosed: 0, creditsCreated: 0,
    qboTotalAR: 0, ledgerTotalAR: 0, difference: 0,
  };

  try {
    // ============================================================
    // STEP 1: Fetch from QBO sequentially to avoid rate limits
    // QBO throttles at ~500 req/min — we fetch one entity at a time
    // ============================================================
    const allQboCustomers = await qboFetchAllSafe(accessToken, realmId, "Customer", "Active = true");
    await sleep(500);
    const openInvoices = await qboFetchAllSafe(accessToken, realmId, "Invoice", "Balance > '0'");
    await sleep(500);
    // For close detection: only fetch invoices updated recently (last 90 days) to reduce API calls
    const allInvoicesForClose = await qboFetchAllSafe(accessToken, realmId, "Invoice");
    await sleep(500);
    const openCredits = await qboFetchAllSafe(accessToken, realmId, "CreditMemo", "Balance > '0'");

    const custMap = new Map(allQboCustomers.map((c: any) => [c.Id, c]));
    const parentCustomers = allQboCustomers.filter((c: any) => !c.Job && !c.ParentRef);
    const subCustomers = allQboCustomers.filter((c: any) => c.Job || c.ParentRef);

    // ============================================================
    // STEP 2: Load Ledger state into memory (3 queries total)
    // ============================================================
    const [allLedgerCustomers, allLedgerProjects, allLedgerInvoices, allLedgerContacts] = await Promise.all([
      db.select().from(customers).where(eq(customers.orgId, orgId)),
      db.select().from(projects).where(eq(projects.orgId, orgId)),
      db.select().from(invoices).where(eq(invoices.orgId, orgId)),
      db.select().from(contacts).where(eq(contacts.orgId, orgId)),
    ]);

    // Index by QBO ID and by code for fast lookup
    const ledgerCustByQboId = new Map(allLedgerCustomers.filter(c => c.qboId).map(c => [c.qboId!, c]));
    const ledgerCustByCode = new Map(allLedgerCustomers.map(c => [c.code, c]));
    const ledgerProjByCode = new Map(allLedgerProjects.map(p => [p.code, p]));
    const ledgerInvByNumber = new Map(allLedgerInvoices.map(i => [i.invoiceNumber, i]));
    const ledgerInvByQboId = new Map(allLedgerInvoices.filter(i => i.qboId).map(i => [i.qboId!, i]));
    const ledgerContactsByCustId = new Map(allLedgerContacts.map(c => [c.customerId, c]));

    // ============================================================
    // STEP 3: Upsert parent customers in batch
    // ============================================================
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
      else { custsToInsert.push({ ...payload, orgId }); results.customers++; }
    }

    if (custsToInsert.length > 0) {
      for (let i = 0; i < custsToInsert.length; i += 100)
        await db.insert(customers).values(custsToInsert.slice(i, i + 100));
    }
    await Promise.all(custsToUpdate.map(({ id, data }) =>
      db.update(customers).set({ ...data, updatedAt: new Date() }).where(eq(customers.id, id))
    ));

    // Reload customer map after inserts
    const freshCustomers = await db.select().from(customers);
    const freshCustByQboId = new Map(freshCustomers.filter(c => c.qboId).map(c => [c.qboId!, c]));
    const freshCustByCode = new Map(freshCustomers.map(c => [c.code, c]));

    // ============================================================
    // STEP 4: Contacts in batch
    // ============================================================
    const contactsToInsert: any[] = [];
    for (const qc of parentCustomers) {
      if (!qc.PrimaryEmailAddr?.Address) continue;
      const cust = freshCustByQboId.get(qc.Id) || freshCustByCode.get(`QBO-${qc.Id}`);
      if (!cust || ledgerContactsByCustId.has(cust.id)) continue;
      contactsToInsert.push({ orgId,
        customerId: cust.id, name: qc.DisplayName || "Primary Contact",
        email: qc.PrimaryEmailAddr.Address, phone: qc.PrimaryPhone?.FreeFormNumber || "",
        type: "Billing" as const, isPrimary: true, isEscalation: false, receivesAuto: true,
      });
      results.contacts++;
    }
    if (contactsToInsert.length > 0) {
      for (let i = 0; i < contactsToInsert.length; i += 100)
        await db.insert(contacts).values(contactsToInsert.slice(i, i + 100).map((c: any) => ({ ...c, orgId })));
    }

    // ============================================================
    // STEP 5: Sub-customers as projects
    // ============================================================
    const projsToInsert: any[] = [];
    for (const qc of subCustomers) {
      if (!qc.ParentRef?.value) continue;
      const parentCust = freshCustByQboId.get(qc.ParentRef.value) || freshCustByCode.get(`QBO-${qc.ParentRef.value}`);
      if (!parentCust) continue;
      const code = `QBO-PROJ-${qc.Id}`;
      if (!ledgerProjByCode.has(code)) {
        projsToInsert.push({ orgId,
          customerId: parentCust.id,
          name: qc.DisplayName || qc.FullyQualifiedName,
          code, qboId: qc.Id, ownerId: userId, status: "Active" as const,
        });
        results.projects++;
      }
    }
    if (projsToInsert.length > 0) {
      for (let i = 0; i < projsToInsert.length; i += 100)
        await db.insert(projects).values(projsToInsert.slice(i, i + 100).map((p: any) => ({ ...p, orgId })));
    }

    // Reload projects
    const freshProjects = await db.select().from(projects);
    const freshProjByQboId = new Map(freshProjects.filter(p => p.qboId).map(p => [p.qboId!, p]));
    const freshProjByCode = new Map(freshProjects.map(p => [p.code, p]));

    // ============================================================
    // STEP 6: Open invoices — the core reconciliation
    // Use QBO Balance (already net of credits/payments applied)
    // ============================================================
    results.qboTotalAR = openInvoices.reduce((s: number, i: any) => s + (parseFloat(i.Balance) || 0), 0);

    const invsToInsert: any[] = [];
    const invsToUpdate: { id: string; data: any }[] = [];

    for (const qi of openInvoices) {
      const invoiceNumber = qi.DocNumber || `QBO-INV-${qi.Id}`;

      // Find top-level parent customer
      const tlId = topLevelId(qi.CustomerRef?.value, custMap);
      const cust = freshCustByQboId.get(tlId) || freshCustByCode.get(`QBO-${tlId}`);
      if (!cust) continue;

      // Find project — direct QBO customer is the project (sub-customer)
      let projectId: string | null = null;
      const directQboCust = custMap.get(qi.CustomerRef?.value);
      if (directQboCust?.ParentRef) {
        const proj = freshProjByQboId.get(qi.CustomerRef.value) || freshProjByCode.get(`QBO-PROJ-${qi.CustomerRef.value}`);
        if (proj) projectId = proj.id;
      }

      const qboBalance = parseFloat(qi.Balance) || 0;
      const total = parseFloat(qi.TotalAmt) || 0;
      const paid = Math.max(0, total - qboBalance);

      // Look up by QBO ID first (most reliable), then by invoice number
      const existing = ledgerInvByQboId.get(qi.Id) || ledgerInvByNumber.get(invoiceNumber);

      const syncData = {
        total, paid, amount: total,
        qboId: qi.Id,
        qboBalance,
        qboCustomerId: qi.CustomerRef?.value,
        qboSyncedAt: new Date(),
        txnType: "Invoice",
        paymentStatus: paid > 0 ? "Partially Paid" as const : "Unpaid" as const,
        updatedAt: new Date(),
      };

      if (existing) {
        invsToUpdate.push({ id: existing.id, data: syncData });
        results.invoicesUpdated++;
      } else {
        invsToInsert.push({ orgId,
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

    // Batch insert/update invoices
    if (invsToInsert.length > 0) {
      for (let i = 0; i < invsToInsert.length; i += 50)
        await db.insert(invoices).values(invsToInsert.slice(i, i + 50).map((inv: any) => ({ ...inv, orgId })));
    }
    await Promise.all(invsToUpdate.map(({ id, data }) =>
      db.update(invoices).set(data).where(eq(invoices.id, id))
    ));

    // ============================================================
    // STEP 7: Unapplied credit memos
    // ============================================================
    const creditsToInsert: any[] = [];
    for (const cm of openCredits) {
      const creditNumber = `CM-${cm.DocNumber || cm.Id}`;
      if (ledgerInvByNumber.has(creditNumber) || ledgerInvByQboId.has(`CM-${cm.Id}`)) continue;
      const tlId = topLevelId(cm.CustomerRef?.value, custMap);
      const cust = freshCustByQboId.get(tlId) || freshCustByCode.get(`QBO-${tlId}`);
      if (!cust) continue;
      const balance = parseFloat(cm.Balance) || 0;
      creditsToInsert.push({ orgId,
        invoiceNumber: creditNumber,
        customerId: cust.id, projectId: null,
        invoiceDate: cm.TxnDate || new Date().toISOString().slice(0, 10),
        dueDate: cm.TxnDate || new Date().toISOString().slice(0, 10),
        currency: cust.currency || "EUR",
        amount: -balance, taxAmount: 0, total: -balance, paid: 0,
        paymentTerms: 0,
        paymentStatus: "Unpaid" as const,
        collectionStage: "Credit Memo",
        collectionOwnerId: userId,
        qboId: `CM-${cm.Id}`,
        qboBalance: -balance,
        qboCustomerId: cm.CustomerRef?.value,
        qboSyncedAt: new Date(),
        txnType: "CreditMemo",
        notes: `Unapplied credit memo from QBO — ${cm.DocNumber || cm.Id}`,
      });
      results.creditsCreated++;
    }
    if (creditsToInsert.length > 0)
      await db.insert(invoices).values(creditsToInsert.map((c: any) => ({ ...c, orgId })));

    // ============================================================
    // STEP 8: Auto-close invoices now fully paid in QBO
    // ============================================================
    const paidQboIds = new Set(
      allInvoicesForClose
        .filter((i: any) => parseFloat(i.Balance) === 0)
        .map((i: any) => i.Id)
    );

    const toClose = allLedgerInvoices.filter(inv =>
      inv.qboId &&
      !inv.qboId.startsWith("CM-") &&
      inv.paymentStatus !== "Paid" &&
      inv.collectionStage !== "Closed" &&
      paidQboIds.has(inv.qboId)
    );

    if (toClose.length > 0) {
      await Promise.all(toClose.map(inv =>
        db.update(invoices).set({
          paymentStatus: "Paid", collectionStage: "Closed",
          paid: inv.total, qboBalance: 0, qboSyncedAt: new Date(), updatedAt: new Date(),
        }).where(eq(invoices.id, inv.id))
      ));
      results.invoicesClosed = toClose.length;
    }

    // ============================================================
    // STEP 9: Calculate Ledger total AR for reconciliation
    // Only count Invoice type (not Credit Memos — those are separate)
    // ============================================================
    const currentInvoices = await db.select().from(invoices);
    results.ledgerTotalAR = currentInvoices
      .filter(i => i.txnType !== "CreditMemo" && i.paymentStatus !== "Paid" && i.collectionStage !== "Closed")
      .reduce((s, i) => s + (i.total - (i.paid || 0)), 0);

    results.difference = Math.abs(results.qboTotalAR - results.ledgerTotalAR);

    // ============================================================
    // STEP 10: Write sync log
    // ============================================================
    await db.insert(qboSyncLog).values({
      userId, orgId,
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

    return ok({ success: true, synced: results });

  } catch (e: any) {
    console.error("QBO sync error:", e);
    // Log the error
    await db.insert(qboSyncLog).values({
      userId, orgId, status: "error",
      errorMessage: e.message,
      durationMs: Date.now() - startTime,
    }).catch(() => {});
    return bad(`Sync failed: ${e.message}`, 500);
  }
}

export async function GET() {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;
  const userId = (session!.user as any).id;
  const [token] = await db.select().from(qboTokens).where(eq(qboTokens.orgId, orgId!)).limit(1);
  if (!token) return ok({ connected: false });
  // Get last sync log
  const syncLogs = await db.select().from(qboSyncLog).where(eq(qboSyncLog.userId, userId));
  const lastSync = syncLogs.sort((a, b) => new Date(b.syncedAt).getTime() - new Date(a.syncedAt).getTime())[0];
  return ok({ connected: true, companyName: token.companyName, realmId: token.realmId, lastSync });
}
