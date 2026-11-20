/**
 * Dev-database check of expected deliveries (0144). Uses an existing open PO line, records a
 * delivery against it, exercises the duplicate-reference guard, the receipt check and link, the
 * FK that reopens a delivery when its receipt goes, cancel/reopen and delete, then removes
 * everything it made. The "receipt" is a bare goods_receipts row with no GL entry, deleted again.
 * Refuses to run against anything but the dev endpoint.
 *
 *   npx tsx scripts/_e2e_expected_deliveries.ts
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

let failed = 0;
const check = (name: string, pass: boolean, detail = "") => { console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  - " + detail : ""}`); if (!pass) failed++; };

async function main() {
  if (!process.env.DATABASE_URL?.includes("ep-ancient-math-ab44z2jn")) throw new Error("Refusing to run: not the dev endpoint");
  const { db } = await import("../db");
  const S = await import("../db/schema");
  const { eq, and, isNotNull, inArray } = await import("drizzle-orm");
  const X = await import("../lib/inventory/expected-delivery-server");
  const { buildSscc } = await import("../lib/inventory/sscc");

  const [pl] = await db.select({ id: S.tradeDocumentLines.id, itemId: S.tradeDocumentLines.itemId, orgId: S.tradeDocumentLines.orgId, poId: S.tradeDocuments.id, partyId: S.tradeDocuments.partyId })
    .from(S.tradeDocumentLines).innerJoin(S.tradeDocuments, eq(S.tradeDocuments.id, S.tradeDocumentLines.documentId))
    .where(and(eq(S.tradeDocuments.kind, "PurchaseOrder"), isNotNull(S.tradeDocumentLines.itemId), isNotNull(S.tradeDocuments.partyId))).limit(1);
  if (!pl) throw new Error("No PO line with an item and supplier on dev");
  const orgId = pl.orgId;
  const ref = `E2E-ASN-${Date.now()}`;
  const made: string[] = [];
  let receiptId: string | null = null;
  try {
    const sscc = buildSscc(9, "0614141", Date.now() % 1e9);
    const d = await X.createExpectedDelivery(orgId, { poId: pl.poId, reference: ref, source: "asn", shipDate: "2026-11-20", expectedDate: "2026-11-22",
      lines: [{ poLineId: pl.id, qtyBase: 3, supplierBatchNo: "B-1", sscc }, { poLineId: pl.id, qtyBase: 2, supplierBatchNo: "B-2" }] }, null);
    made.push(d.id);
    check("created against the PO, supplier taken from it", d.supplierId === pl.partyId && d.state === "expected");

    const dup = await X.createExpectedDelivery(orgId, { poId: pl.poId, reference: ref.toLowerCase(), lines: [{ poLineId: pl.id, qtyBase: 1 }] }, null).then(() => null, e => e);
    check("same reference from the same supplier refused (case-insensitive)", X.expectedDeliveryErrorOf(dup)?.status === 409, dup?.message);

    const wrong = await X.createExpectedDelivery(orgId, { poId: pl.poId, lines: [{ poLineId: "00000000-0000-0000-0000-000000000000", qtyBase: 1 }] }, null).then(() => null, e => e);
    check("a line of another order refused", /line of the purchase order/.test(wrong?.message ?? ""));

    const list = await X.listExpectedDeliveries(orgId, { poId: pl.poId, state: "expected" });
    const mine = list.find(x => x.id === d.id);
    check("listed with lines and the line's SSCC as a package", mine?.lines.length === 2 && mine?.packages.length === 1 && mine.packages[0].sscc === sscc);

    const otherPo = await X.checkDeliveryForReceipt(orgId, d.id, ["someone-else"]).then(() => null, e => e);
    check("a receipt against another PO is refused before posting", /different purchase order/.test(otherPo?.message ?? ""));
    await X.checkDeliveryForReceipt(orgId, d.id, [pl.poId]);
    check("a receipt against its own PO passes the check", true);

    const [gr] = await db.insert(S.goodsReceipts).values({ orgId, receiptNo: `E2E-${Date.now()}`, receiptDate: "2026-11-20", supplierId: pl.partyId }).returning();
    receiptId = gr.id;
    check("linked to the receipt", await X.attachReceipt(orgId, d.id, gr.id));
    check("second link is a no-op", !(await X.attachReceipt(orgId, d.id, gr.id)));
    const exp = await X.expectedSsccsForReceipt(orgId, gr.id);
    check("receipt sees the announced SSCC", exp.ssccs.length === 1 && exp.ssccs[0] === sscc);
    const received = await X.listExpectedDeliveries(orgId, { poId: pl.poId, state: "received" });
    check("now reads as received", received.some(x => x.id === d.id));
    const noCancel = await X.setDeliveryCancelled(orgId, d.id, true).then(() => null, e => e);
    check("a received delivery cannot be cancelled", X.expectedDeliveryErrorOf(noCancel)?.status === 409);
    const noDelete = await X.deleteExpectedDelivery(orgId, d.id).then(() => null, e => e);
    check("a received delivery cannot be deleted", X.expectedDeliveryErrorOf(noDelete)?.status === 409);

    await db.delete(S.goodsReceipts).where(eq(S.goodsReceipts.id, gr.id)); receiptId = null;
    const back = await X.listExpectedDeliveries(orgId, { poId: pl.poId, state: "expected" });
    check("deleting the receipt (as a void does) reopens the delivery", back.some(x => x.id === d.id));

    const c = await X.setDeliveryCancelled(orgId, d.id, true);
    check("cancelled", c.state === "cancelled");
    const again = await X.createExpectedDelivery(orgId, { poId: pl.poId, reference: ref, lines: [{ poLineId: pl.id, qtyBase: 1 }] }, null);
    made.push(again.id);
    check("a cancelled reference can be recorded again", again.state === "expected");
    const reopen = await X.setDeliveryCancelled(orgId, d.id, false).then(() => null, e => e);
    check("reopening clashes with the new one under the same reference", X.expectedDeliveryErrorOf(reopen)?.status === 409);
    await X.deleteExpectedDelivery(orgId, again.id); made.splice(made.indexOf(again.id), 1);
    check("deleted", !(await X.listExpectedDeliveries(orgId, { poId: pl.poId })).some(x => x.id === again.id));
  } finally {
    if (receiptId) await db.delete(S.goodsReceipts).where(eq(S.goodsReceipts.id, receiptId));
    if (made.length) await db.delete(S.expectedDeliveries).where(inArray(S.expectedDeliveries.id, made));
    const left = await db.select({ id: S.expectedDeliveries.id }).from(S.expectedDeliveries).where(eq(S.expectedDeliveries.orgId, orgId));
    const leftLines = await db.select({ id: S.expectedDeliveryLines.id }).from(S.expectedDeliveryLines).where(eq(S.expectedDeliveryLines.orgId, orgId));
    console.log(`cleanup: ${left.length} deliveries and ${leftLines.length} lines left in that org`);
  }
  if (failed) { console.log(`${failed} FAILED`); process.exit(1); }
  console.log("all passed");
}
main().catch(e => { console.error(e); process.exit(1); });
