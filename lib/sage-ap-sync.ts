/**
 * lib/sage-ap-sync.ts
 *
 * Sage Intacct AP sync — vendors (apSuppliers) and bills (apBills).
 * Shares the XML helper approach with sage-sync.ts but is invoked separately
 * so AR and AP can be parallelised or retried independently.
 */

import { db } from "@/db";
import { apSuppliers, apBills, sageIntacctCredentials, sageSyncLog } from "@/db/schema";
import { eq, and, desc } from "drizzle-orm";
import { decryptSecret } from "@/lib/crypto";

// ─── XML helpers (same pattern as sage-sync.ts) ──────────────────────────────

function xmlVal(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([^<]*)</${tag}>`, "i"));
  return m ? m[1].trim() : "";
}

function xmlBlocks(xml: string, tag: string): string[] {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi");
  const results: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) results.push(m[1]);
  return results;
}

type SageCreds = {
  companyId: string;
  sageUserId: string;
  password: string;
  entityId?: string | null;
};

let _ctrlSeqAp = 1000;

function buildXml(creds: SageCreds, functionXml: string): string {
  const senderId = process.env.SAGE_SENDER_ID ?? "Primeaccountax";
  const senderPwd = process.env.SAGE_SENDER_PASSWORD ?? "Primeaccountax1!";
  const ctrlId = `ctrlap${_ctrlSeqAp++}_${Date.now()}`;
  const entityEl = creds.entityId ? `<locationid>${creds.entityId}</locationid>` : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<request>
  <control>
    <senderid>${senderId}</senderid>
    <password>${senderPwd}</password>
    <controlid>${ctrlId}</controlid>
    <uniqueid>false</uniqueid>
    <dtdversion>3.0</dtdversion>
    <includewhitespace>false</includewhitespace>
  </control>
  <operation>
    <authentication>
      <login>
        <userid>${creds.sageUserId}</userid>
        <companyid>${creds.companyId}</companyid>
        <password>${creds.password}</password>
        ${entityEl}
      </login>
    </authentication>
    <content>${functionXml}</content>
  </operation>
</request>`;
}

async function sagePost(xml: string): Promise<string> {
  const res = await fetch("https://api.intacct.com/ia/xml/xmlgw.php", {
    method: "POST",
    headers: { "Content-Type": "application/xml" },
    body: xml,
  });
  if (!res.ok) throw new Error(`Sage HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.text();
}

function assertSuccess(responseXml: string, fnId: string): string {
  const results = xmlBlocks(responseXml, "result");
  const block = results.find(r => xmlVal(r, "function") === fnId || xmlVal(r, "controlid") === fnId);
  if (!block) {
    const errDesc = xmlVal(responseXml, "description2") || xmlVal(responseXml, "description");
    throw new Error(`Sage Intacct: no result for ${fnId}${errDesc ? ` — ${errDesc}` : ""}`);
  }
  const status = xmlVal(block, "status");
  if (status !== "success") {
    const errDesc = xmlVal(block, "description2") || xmlVal(block, "description");
    throw new Error(`Sage Intacct error [${fnId}]: ${errDesc || "Unknown error"}`);
  }
  return block;
}

async function sageFetchAll(
  creds: SageCreds,
  objectType: string,
  fields: string[],
  filterXml = "",
  pageSize = 1000
): Promise<string[]> {
  const selectXml = fields.map(f => `<field>${f}</field>`).join("");
  const records: string[] = [];
  let offset = 0;
  const objTag = objectType.toLowerCase();

  while (true) {
    const fnId = `qap_${objectType}_${offset}`;
    const fn = `<function controlid="${fnId}">
  <query>
    <object>${objectType}</object>
    <select>${selectXml}</select>
    ${filterXml}
    <pagesize>${pageSize}</pagesize>
    <offset>${offset}</offset>
  </query>
</function>`;

    const resp = await sagePost(buildXml(creds, fn));
    const resultBlock = assertSuccess(resp, fnId);
    // numremaining is an attribute on the <data> tag itself, not child content
    const numRemainingMatch = resultBlock.match(/numremaining="(\d+)"/i);
    const numRemaining = numRemainingMatch ? parseInt(numRemainingMatch[1]) : 0;
    const dataBlock = xmlBlocks(resultBlock, "data")[0] ?? "";
    const batch = xmlBlocks(dataBlock, objTag);
    records.push(...batch);
    if (numRemaining === 0 || batch.length === 0) break;
    offset += pageSize;
    await sleep(300);
  }
  return records;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function formatSageDate(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${m}/${day}/${d.getFullYear()}`;
}

function parseSageDate(raw: string): string {
  if (!raw) return new Date().toISOString().slice(0, 10);
  const datePart = raw.split(" ")[0];
  const parts = datePart.split("/");
  if (parts.length !== 3) return new Date().toISOString().slice(0, 10);
  const [m, d, y] = parts;
  return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

// ─── Main AP sync ─────────────────────────────────────────────────────────────

export async function runSageApSync(orgId: string, userId: string, opts: { fullSync?: boolean } = {}) {
  const t0 = Date.now();

  const [cred] = await db
    .select()
    .from(sageIntacctCredentials)
    .where(eq(sageIntacctCredentials.orgId, orgId))
    .limit(1);
  if (!cred) throw new Error("No Sage Intacct credentials configured");

  const sageCreds: SageCreds = {
    companyId:  cred.companyId,
    sageUserId: cred.sageUserId,
    password:   decryptSecret(cred.password) ?? "",
    entityId:   cred.entityId,
  };

  const [lastLog] = await db
    .select({ syncedAt: sageSyncLog.syncedAt })
    .from(sageSyncLog)
    .where(and(eq(sageSyncLog.orgId, orgId), eq(sageSyncLog.status, "success")))
    .orderBy(desc(sageSyncLog.syncedAt))
    .limit(1);

  // fullSync forces a complete historical re-fetch (ignores the last-sync log).
  const sinceDate = (!opts.fullSync && lastLog)
    ? new Date(lastLog.syncedAt.getTime() - 10 * 60 * 1000)
    : undefined;

  const dateFilter = sinceDate
    ? `<filter><greaterthanorequalto><field>WHENMODIFIED</field><value>${formatSageDate(sinceDate)}</value></greaterthanorequalto></filter>`
    : "";

  let suppliersCreated = 0;
  let billsCreated     = 0;
  let billsUpdated     = 0;

  try {
    // ── STEP 1: Vendors → apSuppliers ─────────────────────────────────────
    const vendorFields = ["VENDORID", "NAME", "CURRENCY", "STATUS", "EMAIL1", "PHONE1", "BILLTOCOUNTRYCODE", "TERMNAME"];
    const sageVendors = await sageFetchAll(sageCreds, "VENDOR", vendorFields, dateFilter);

    for (const v of sageVendors) {
      const sageId   = xmlVal(v, "VENDORID");
      const name     = xmlVal(v, "NAME") || sageId;
      const currency = xmlVal(v, "CURRENCY") || "USD";
      const rawStatus = xmlVal(v, "STATUS");
      const status   = rawStatus === "active" ? "Active" : "Inactive";
      const email    = xmlVal(v, "EMAIL1") || null;
      const phone    = xmlVal(v, "PHONE1") || null;
      const country  = xmlVal(v, "BILLTOCOUNTRYCODE") || null;
      if (!sageId) continue;

      const [existing] = await db
        .select({ id: apSuppliers.id })
        .from(apSuppliers)
        .where(and(eq(apSuppliers.orgId, orgId), eq(apSuppliers.sageIntacctId, sageId)))
        .limit(1);

      if (!existing) {
        await db.insert(apSuppliers).values({
          orgId, name, currency, status,
          email: email ?? undefined,
          phone: phone ?? undefined,
          country: country ?? undefined,
          sageIntacctId: sageId,
          source: "sage",
          lastSyncedAt: new Date(),
        }).onConflictDoNothing();
        suppliersCreated++;
      } else {
        await db.update(apSuppliers)
          .set({ name, currency, status, lastSyncedAt: new Date(), updatedAt: new Date() })
          .where(eq(apSuppliers.id, existing.id));
      }
    }

    // ── STEP 2: AP Bills ──────────────────────────────────────────────────
    const billFields = [
      "RECORDNO", "BILLNO", "VENDORID", "WHENCREATED", "WHENDUE",
      "TOTALENTERED", "TOTALPAID", "TOTALDUE", "STATE", "CURRENCY", "DESCRIPTION",
    ];
    const sageBills = await sageFetchAll(sageCreds, "APBILL", billFields, dateFilter);

    for (const b of sageBills) {
      const recordNo     = xmlVal(b, "RECORDNO");
      const billNo       = xmlVal(b, "BILLNO") || recordNo;
      const vendorId     = xmlVal(b, "VENDORID");
      const whenCreated  = xmlVal(b, "WHENCREATED");
      const whenDue      = xmlVal(b, "WHENDUE");
      const totalEntered = parseFloat(xmlVal(b, "TOTALENTERED") || "0");
      const totalDue     = parseFloat(xmlVal(b, "TOTALDUE") || "0");
      const totalPaid    = parseFloat(xmlVal(b, "TOTALPAID") || "0");
      const state        = xmlVal(b, "STATE");
      const currency     = xmlVal(b, "CURRENCY") || "USD";
      const description  = xmlVal(b, "DESCRIPTION");

      if (!recordNo || state === "Draft" || state === "Voided") continue;

      let payStatus: string;
      if (state === "Paid" || totalDue <= 0) payStatus = "Paid";
      else if (totalPaid > 0) payStatus = "Partially Paid";
      else payStatus = "Unpaid";

      const [supplier] = await db
        .select({ id: apSuppliers.id })
        .from(apSuppliers)
        .where(and(eq(apSuppliers.orgId, orgId), eq(apSuppliers.sageIntacctId, vendorId)))
        .limit(1);

      const billDate = parseSageDate(whenCreated);
      const dueDate  = parseSageDate(whenDue) || billDate;
      const now = new Date();

      const [existing] = await db
        .select({ id: apBills.id })
        .from(apBills)
        .where(and(eq(apBills.orgId, orgId), eq(apBills.sageIntacctId, recordNo)))
        .limit(1);

      if (!existing) {
        await db.insert(apBills).values({
          orgId,
          supplierId:               supplier?.id ?? null,
          billNumber:               billNo,
          billDate,
          dueDate,
          currency,
          subtotal:                 totalEntered,
          taxTotal:                 0,
          total:                    totalEntered,
          amountPaid:               totalPaid,
          balance:                  totalDue,
          accountingPaymentStatus:  payStatus,
          workflowStatus:           "Synced from Accounting",
          sageIntacctId:            recordNo,
          source:                   "sage",
          privateNote:              description || null,
          lastSyncAt:               now,
        });
        billsCreated++;
      } else {
        await db.update(apBills)
          .set({
            amountPaid:               totalPaid,
            balance:                  totalDue,
            accountingPaymentStatus:  payStatus,
            lastSyncAt:               now,
            updatedAt:                now,
          })
          .where(eq(apBills.id, existing.id));
        billsUpdated++;
      }
    }

    const durationMs = Date.now() - t0;
    return { suppliersCreated, billsCreated, billsUpdated, durationMs };
  } catch (e: any) {
    console.error("Sage AP sync error:", e.message);
    throw e;
  }
}
