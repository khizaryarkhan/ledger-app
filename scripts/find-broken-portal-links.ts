/**
 * Which customers were emailed a portal link that lands on Vercel's login page?
 *
 * Portal links built from a `*.vercel.app` deployment host are blocked by Vercel
 * Deployment Protection — the customer is redirected to vercel.com/sso-api
 * instead of their invoices. Fixed going forward in lib/portal.ts
 * (`isPublicHost`), but emails already sent still carry the bad host and cannot
 * be recalled.
 *
 * This finds them so they can be re-sent. It is STRICTLY READ-ONLY: it issues
 * SELECTs and nothing else, so it is safe against production.
 *
 * Usage:
 *   DATABASE_URL="<production-url>" npx tsx scripts/find-broken-portal-links.ts
 *   DATABASE_URL="..." npx tsx scripts/find-broken-portal-links.ts --org <uuid>
 *   DATABASE_URL="..." npx tsx scripts/find-broken-portal-links.ts --csv > resend.csv
 *
 * Note it does NOT touch QuickBooks and never refreshes a token.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local", quiet: true });

const arg = (n: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : null;
};
const flag = (n: string) => process.argv.includes(`--${n}`);

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const orgFilter = arg("org");
  const csv = flag("csv");

  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(process.env.DATABASE_URL);

  // Outbound email whose body carries a vercel.app portal link. Matching on
  // "/portal/" as well as the host keeps unrelated mentions of vercel.app out.
  const rows: any[] = await sql(
    `select c.id,
            c.org_id,
            o.name                as org_name,
            c.customer_id,
            p.name                as customer_name,
            p.email               as customer_email,
            c.invoice_id,
            i.invoice_number,
            c.subject,
            c.sent_at
       from communications c
       left join organisations o on o.id = c.org_id
       left join customers     p on p.id = c.customer_id
       left join invoices      i on i.id = c.invoice_id
      where c.direction = 'Outbound'
        and c.body is not null
        and c.body like '%.vercel.app%'
        and c.body like '%/portal/%'
        ${orgFilter ? "and c.org_id = $1" : ""}
      order by c.sent_at desc`,
    orgFilter ? [orgFilter] : [],
  );

  if (csv) {
    console.log("sent_at,org,customer,email,invoice,subject");
    for (const r of rows) {
      const esc = (v: any) => `"${String(v ?? "").replace(/"/g, '""')}"`;
      console.log([r.sent_at, r.org_name, r.customer_name, r.customer_email, r.invoice_number, r.subject].map(esc).join(","));
    }
    return;
  }

  if (rows.length === 0) {
    console.log("\n✅ No outbound email carries a vercel.app portal link. Nothing to re-send.");
    return;
  }

  console.log(`\n⚠️  ${rows.length} email(s) went out with a portal link that hits Vercel's login page.\n`);

  const byOrg = new Map<string, any[]>();
  for (const r of rows) {
    const k = `${r.org_name ?? r.org_id}`;
    byOrg.set(k, [...(byOrg.get(k) ?? []), r]);
  }

  for (const [org, list] of byOrg) {
    const customers = new Set(list.map(r => r.customer_email ?? r.customer_name ?? r.customer_id));
    const first = list[list.length - 1]?.sent_at;
    const last  = list[0]?.sent_at;
    console.log(`${org}`);
    console.log(`  ${list.length} email(s) to ${customers.size} customer(s), ${first} → ${last}`);
    for (const r of list.slice(0, 15)) {
      console.log(`    ${String(r.sent_at).slice(0, 16)}  ${String(r.customer_name ?? "?").slice(0, 28).padEnd(30)} ${r.customer_email ?? ""}  ${r.invoice_number ? "#" + r.invoice_number : ""}`);
    }
    if (list.length > 15) console.log(`    …and ${list.length - 15} more`);
    console.log();
  }

  console.log("Re-send these from the app so the link is rebuilt on primeaccountax.com.");
  console.log("The portal TOKENS are unaffected — only the host in the URL was wrong.");
  console.log("Run with --csv to get a list you can work through.");
}

main().catch(e => { console.error(e); process.exit(1); });
