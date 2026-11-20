/**
 * EDI 810 → a bill, when a PERSON presses "Create bill" on a received invoice.
 * Kept out of lib/edi on purpose: nothing there posts (tests/edi-x12.test.ts).
 *
 * The match is run again against the records as they stand now and must
 * propose the same receipts as when the file was read; otherwise it is refused
 * and the person bills by hand. The message is claimed (status → processing)
 * so a double click cannot post twice, and billFromReceipts itself refuses
 * receipts already billed. The bill is the ordinary bill-from-receipts bill:
 * GR/IR clears, a price difference goes to purchase price variance (P-03).
 */

import { db } from "@/db";
import { ediMessages, ediPartners } from "@/db/schema";
import { and, eq, inArray } from "drizzle-orm";
import { matchInvoice, invoiceSegmentsIn, type TxnResult } from "@/lib/edi/inbound-server";
import { EdiError } from "@/lib/edi/edi-server";
import { billFromReceipts } from "@/lib/inventory/receiving";
import { logEvent } from "@/lib/audit";

export async function createBillFromEdiInvoice(orgId: string, messageId: string, index: number, taxRateId: string | null, actorId: string | null) {
  const [m] = await db.select().from(ediMessages).where(and(eq(ediMessages.id, messageId), eq(ediMessages.orgId, orgId))).limit(1);
  if (!m || m.direction !== "in") throw new EdiError("Inbound file not found.", 404);
  const results = (Array.isArray(m.result) ? m.result : []) as TxnResult[];
  const r = results[index];
  if (!r || r.setId !== "810" || !r.proposal) throw new EdiError("That part of the file is not an invoice ready to bill.", 409);
  if (r.bill) throw new EdiError(`This invoice is already billed as ${r.bill.docNumber ?? "a bill"}.`, 409);

  const [partner] = await db.select().from(ediPartners).where(eq(ediPartners.id, m.partnerId)).limit(1);
  const segments = invoiceSegmentsIn(m.payload, r.controlNo);
  if (!partner || !segments) throw new EdiError("The invoice could not be found in the stored file.", 409);
  const now = await matchInvoice(orgId, partner, segments);
  if (now.existingBill) throw new EdiError(`Invoice ${now.invoiceNo} is already recorded as ${now.existingBill}.`, 409);
  if (now.outcome.ok === false) throw new EdiError(`The invoice no longer matches what is waiting to be billed: ${now.outcome.problems.join(" ")}`, 409);
  const p = now.outcome.proposal;
  const same = (a: string[], b: string[]) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
  if (!same(p.receiptIds, r.proposal.receiptIds)) throw new EdiError("The receipts waiting to be billed have changed since the file was read. Bill it by hand from Receiving.", 409);

  const claimed = await db.update(ediMessages).set({ status: "processing" })
    .where(and(eq(ediMessages.id, messageId), eq(ediMessages.orgId, orgId), inArray(ediMessages.status, ["review", "processed"]))).returning({ id: ediMessages.id });
  if (!claimed.length) throw new EdiError("This file is being billed already.", 409);
  let bill;
  try {
    bill = await billFromReceipts(orgId, {
      receiptIds: p.receiptIds, billDate: p.invoiceDate, dueDate: p.dueDate, reference: p.invoiceNo,
      taxRateId, prices: p.prices, memo: `Bill from EDI invoice ${p.invoiceNo} (${p.receiptNos.join(", ")})`,
    }, actorId);
  } catch (e) {
    await db.update(ediMessages).set({ status: m.status }).where(eq(ediMessages.id, messageId));
    throw e;
  }
  const next = results.map((x, i) => i === index
    ? { ...x, outcome: "applied" as const, proposal: p, bill: { entryId: bill.id, docNumber: bill.docNumber ?? null },
        summary: `Invoice ${p.invoiceNo} billed as ${bill.docNumber ?? "a bill"} from ${p.receiptNos.join(", ")}.` }
    : x);
  const status = next.some(x => x.outcome === "review") ? "review" : "processed";
  await db.update(ediMessages).set({ status, result: next }).where(eq(ediMessages.id, messageId))
    .catch(e => console.error("[edi] bill posted but the file could not be updated", { orgId, messageId, billId: bill.id, e }));
  logEvent({ orgId, eventType: "edi_received", docType: "ledger", docId: bill.id, actorId,
    meta: { messageId, action: "bill_created", invoiceNo: p.invoiceNo, receipts: p.receiptNos } })
    .catch(e => console.error("[audit] edi bill failed:", e));
  return { bill, message: { ...m, status, result: next } };
}
