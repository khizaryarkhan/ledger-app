// One-off repair for the deleteDocument gap just fixed in lib/accounting/
// documents.ts: deleting a Bill created from a Goods Receipt never reverted
// goods_receipts.billed_amount / goods_receipt_lines.billed_qty, so a receipt
// whose only bill was deleted stays permanently "billed" and un-voidable.
// Dry run by default; --commit to apply. Scoped to receipts with NO surviving
// receipt_bill link at all (a receipt still correctly linked to a live Bill
// is left untouched).
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

async function main() {
  const commit = process.argv.includes("--commit");
  const { db } = await import("../db");
  const S = await import("../db/schema");
  const { eq, and, sql } = await import("drizzle-orm");

  const receipts = await db.select().from(S.goodsReceipts).where(sql`${S.goodsReceipts.billedAmount}::numeric > 0.005`);
  console.log(`Found ${receipts.length} receipt(s) with billedAmount > 0.`);

  let fixed = 0;
  for (const r of receipts) {
    const [link] = await db.select({ id: S.transactionLinks.id }).from(S.transactionLinks)
      .where(and(eq(S.transactionLinks.orgId, r.orgId), eq(S.transactionLinks.fromId, r.id), eq(S.transactionLinks.relation, "receipt_bill"))).limit(1);
    if (link) { console.log(`  ${r.receiptNo}: still linked to a live bill — left alone`); continue; }

    console.log(`  ${r.receiptNo}: billedAmount=${r.billedAmount}, no surviving bill link — ${commit ? "clearing" : "would clear"}`);
    if (!commit) { fixed++; continue; }
    await db.update(S.goodsReceipts).set({ billedAmount: "0", updatedAt: new Date() }).where(eq(S.goodsReceipts.id, r.id));
    await db.update(S.goodsReceiptLines).set({ billedQty: "0" }).where(eq(S.goodsReceiptLines.receiptId, r.id));
    const lines = await db.select().from(S.goodsReceiptLines).where(eq(S.goodsReceiptLines.receiptId, r.id));
    for (const l of lines) if (l.poLineId) {
      // Only zero the PO line's billedQty if nothing ELSE still contributes to it.
      await db.update(S.tradeDocumentLines).set({ billedQty: sql`greatest(0, ${S.tradeDocumentLines.billedQty} - ${l.qtyBase})` })
        .where(eq(S.tradeDocumentLines.id, l.poLineId));
    }
    fixed++;
  }
  console.log(commit ? `Cleared ${fixed} orphaned receipt(s).` : `${fixed} receipt(s) would be cleared — rerun with --commit to apply.`);
}
main().catch(e => { console.error(e); process.exit(1); });
