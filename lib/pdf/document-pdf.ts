/**
 * One loader-to-PDF function per native document family. Every PDF-producing
 * route for a native (non-QBO/Xero) document should call one of these three
 * instead of building its own pdf-lib document or leaving native unhandled —
 * see tests/architecture.test.ts's "the one PDF engine" guard.
 */
import { renderHtmlToPdf } from "./render-html";
import { renderDocumentHtml } from "./render-document";
import { loadLedgerDocumentForPrint, loadTradeDocumentForPrint, loadBillForPrint } from "@/lib/accounting/document-print";

/** A native document already posted to our own GL — Invoice, SalesReceipt,
 *  CreditNote, RefundReceipt, Bill, Expense, or VendorCredit. Keyed on the
 *  journal_entries id (invoices.journalEntryId / apBills.entryId for a
 *  native bill), not the document's own row id. */
export async function renderLedgerDocumentPdf(orgId: string, entryId: string): Promise<Buffer | null> {
  const doc = await loadLedgerDocumentForPrint(orgId, entryId);
  if (!doc) return null;
  return renderHtmlToPdf(renderDocumentHtml(doc));
}

/** A Quote / Purchase Order / Sales Order (trade_documents). */
export async function renderTradeDocumentPdf(orgId: string, id: string): Promise<Buffer | null> {
  const doc = await loadTradeDocumentForPrint(orgId, id);
  if (!doc) return null;
  return renderHtmlToPdf(renderDocumentHtml(doc));
}

/** A QBO/Xero/Sage-mirrored bill with no native GL entry — see
 *  loadBillForPrint's own comment for why this is a separate data source. */
export async function renderBillSnapshotPdf(orgId: string, billId: string): Promise<Buffer | null> {
  const doc = await loadBillForPrint(orgId, billId);
  if (!doc) return null;
  return renderHtmlToPdf(renderDocumentHtml(doc));
}
