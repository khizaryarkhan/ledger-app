// One-off repair for the deleteDocument gap just fixed in lib/accounting/
// documents.ts: deleting a Bill created from a Goods Receipt never reverted
// goods_receipts.billed_amount / goods_receipt_lines.billed_qty, so a receipt
// whose only bill was deleted stays permanently "billed" and un-voidable.
// Dry run by default; --commit to apply. Scoped to receipts with NO surviving
// receipt_bill link at all (a receipt still correctly linked to a live Bill
// is left untouched).
//
// Usage:
//   npx tsx scripts/_fix_orphaned_grn_billed_amounts.ts                                   # dry run, .env.local
//   npx tsx scripts/_fix_orphaned_grn_billed_amounts.ts --env .env.production.vercel       # dry run, production
//   npx tsx scripts/_fix_orphaned_grn_billed_amounts.ts --env .env.production.vercel --receipt GRN-0003 --commit
import { config as loadEnv } from "dotenv";
const argv = process.argv.slice(2);
const envArg = argv.indexOf("--env");
loadEnv({ path: envArg >= 0 ? argv[envArg + 1] : ".env.local", quiet: true });
// Vercel stores DATABASE_URL as a Secret, which pulls down empty/[SENSITIVE]
// in a plain .env file — DATABASE_URL_UNPOOLED is the usable string for a
// Vercel-pulled env file (see CLAUDE.md's "There is ONE Neon project" note).
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

async function main() {
  const commit = argv.includes("--commit");
  const receiptArgIdx = argv.indexOf("--receipt");
  const onlyReceiptNo = receiptArgIdx >= 0 ? argv[receiptArgIdx + 1] : null;
  const { db } = await import("../db");
  const { dbIdentity } = await import("./db-identity");
  const S = await import("../db/schema");
  const { eq, and, sql } = await import("drizzle-orm");

  const id = await dbIdentity(process.env.DATABASE_URL!);
  console.log(`Connected to: endpoint=${id.endpointId} branch=${id.branchId} orgs=${id.orgNames.join(", ")}`);

  const receipts = onlyReceiptNo
    ? await db.select().from(S.goodsReceipts).where(eq(S.goodsReceipts.receiptNo, onlyReceiptNo))
    : await db.select().from(S.goodsReceipts).where(sql`${S.goodsReceipts.billedAmount}::numeric > 0.005`);
  console.log(onlyReceiptNo
    ? `Found ${receipts.length} receipt(s) matching "${onlyReceiptNo}".`
    : `Found ${receipts.length} receipt(s) with billedAmount > 0.`);

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
