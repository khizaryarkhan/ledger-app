// One-off repair for the gap closed in lib/accounting/documents.ts (deleteDocument):
// deleting an invoice/bill made from an Estimate or Purchase Order never gave the
// invoiced amounts back, so the source stayed "Fully invoiced" with nothing behind
// it and could neither be invoiced again nor deleted.
// Scope: Estimates and Purchase Orders with invoiced amounts (or a converted entry)
// and NO surviving conversion link. Sales Orders are left alone (they are fulfilled
// through shipments, not conversion). Dry run by default; --commit to apply.
//
// Usage:
//   npx tsx scripts/_fix_orphaned_converted_trade_docs.ts --env .env.production.vercel --org-name "Test Organization"
//   npx tsx scripts/_fix_orphaned_converted_trade_docs.ts --env .env.production.vercel --org-name "Test Organization" --commit
import { config as loadEnv } from "dotenv";
const argv = process.argv.slice(2);
const envArg = argv.indexOf("--env");
loadEnv({ path: envArg >= 0 ? argv[envArg + 1] : ".env.local", quiet: true });
if (!process.env.DATABASE_URL && process.env.DATABASE_URL_UNPOOLED) process.env.DATABASE_URL = process.env.DATABASE_URL_UNPOOLED;

async function main() {
  const commit = argv.includes("--commit");
  const nameIdx = argv.indexOf("--org-name");
  const orgName = nameIdx >= 0 ? argv[nameIdx + 1] : null;
  if (!orgName) throw new Error("Pass --org-name so this never runs against every organisation by accident.");
  const { db } = await import("../db");
  const { dbIdentity } = await import("./db-identity");
  const S = await import("../db/schema");
  const { eq, and, or, inArray } = await import("drizzle-orm");

  const id = await dbIdentity(process.env.DATABASE_URL!);
  console.log(`Connected to: endpoint=${id.endpointId} branch=${id.branchId}`);

  const [org] = await db.select({ id: S.organisations.id, name: S.organisations.name }).from(S.organisations).where(eq(S.organisations.name, orgName)).limit(1);
  if (!org) throw new Error(`No organisation named "${orgName}".`);

  const docs = await db.select().from(S.tradeDocuments)
    .where(and(eq(S.tradeDocuments.orgId, org.id), inArray(S.tradeDocuments.kind, ["Estimate", "PurchaseOrder"])));
  let fixed = 0;
  for (const d of docs) {
    const lines = await db.select().from(S.tradeDocumentLines).where(eq(S.tradeDocumentLines.documentId, d.id));
    const touched = d.convertedEntryId || lines.some((l) => Number(l.invoicedAmount) > 0.005);
    if (!touched) continue;
    const [link] = await db.select({ id: S.transactionLinks.id }).from(S.transactionLinks)
      .where(and(eq(S.transactionLinks.orgId, org.id),
        or(eq(S.transactionLinks.fromId, d.id), eq(S.transactionLinks.toId, d.id)),
        inArray(S.transactionLinks.relation, ["progress_invoice", "conversion", "po_bill"]))).limit(1);
    if (link) { console.log(`  ${d.docNumber}: still linked to a live document — left alone`); continue; }
    console.log(`  ${d.docNumber} (${d.kind}, ${d.status}): no surviving link — ${commit ? "reopening" : "would reopen"}`);
    fixed++;
    if (!commit) continue;
    await db.update(S.tradeDocumentLines).set({ invoicedAmount: "0" }).where(eq(S.tradeDocumentLines.documentId, d.id));
    await db.update(S.tradeDocuments).set({ status: "Open", convertedEntryId: null }).where(eq(S.tradeDocuments.id, d.id));
  }
  console.log(commit ? `Reopened ${fixed}.` : `${fixed} would be reopened — rerun with --commit.`);
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
