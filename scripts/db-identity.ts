/**
 * Which database am I actually talking to?
 *
 * Usage:
 *   npm run db:whoami                                  # whatever .env.local points at
 *   npm run db:whoami -- --env .env.production.vercel  # another env file
 *
 * This exists because a connection string does not say what it is. This repo
 * has had two Neon BRANCHES of the same project holding overlapping, real-
 * looking data — the same orgs, similar item names, months apart — and a
 * screenshot from one was read as evidence about the other more than once. It
 * cost a "what went wrong?" investigation that turned out to be two datasets.
 *
 * Neon answers the question itself: `neon.endpoint_id`, `neon.project_id` and
 * `neon.branch_id` are ordinary Postgres settings, readable over the same
 * connection. Combined with the org list, that is an unambiguous fingerprint —
 * no console, no API key, no guessing from a hostname.
 */

import { neon } from "@neondatabase/serverless";

export type DbIdentity = {
  host: string;
  endpointId: string | null;
  projectId: string | null;
  branchId: string | null;
  orgCount: number;
  orgNames: string[];
  invoiceCount: number;
  lastMigration: number | null;
};

/** Neon exposes these as GUCs; a non-Neon Postgres simply will not have them. */
async function guc(sql: any, name: string): Promise<string | null> {
  try {
    const r = await sql(`select current_setting($1) as v`, [name]);
    return (r as any[])[0]?.v ?? null;
  } catch { return null; }
}

export async function dbIdentity(url: string): Promise<DbIdentity> {
  const sql = neon(url);
  const [endpointId, projectId, branchId] = await Promise.all([
    guc(sql, "neon.endpoint_id"), guc(sql, "neon.project_id"), guc(sql, "neon.branch_id"),
  ]);
  const orgs: any[] = await sql(`select name from organisations order by name`);
  const inv: any[] = await sql(`select count(*)::int as n from invoices`);
  let lastMigration: number | null = null;
  try {
    const m: any[] = await sql(`select max(created_at) as m from drizzle.__drizzle_migrations`);
    lastMigration = m[0]?.m != null ? Number(m[0].m) : null;
  } catch { /* a database with no migrations table is still worth identifying */ }

  return {
    host: new URL(url).host,
    endpointId, projectId, branchId,
    orgCount: orgs.length,
    orgNames: orgs.map(o => String(o.name).trim()),
    invoiceCount: inv[0]?.n ?? 0,
    lastMigration,
  };
}

/** A compact block, printed by db:whoami and at the top of db:verify. */
export function formatIdentity(id: DbIdentity): string {
  const lines = [
    `  host      ${id.host}`,
    `  endpoint  ${id.endpointId ?? "(not a Neon database)"}`,
    `  project   ${id.projectId ?? "-"}`,
    `  branch    ${id.branchId ?? "-"}`,
    `  contents  ${id.orgCount} orgs, ${id.invoiceCount.toLocaleString()} invoices`,
    `  orgs      ${id.orgNames.join(", ") || "(none)"}`,
  ];
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (require.main === module) {
  (async () => {
    const { config } = await import("dotenv");
    const argv = process.argv.slice(2);
    const i = argv.indexOf("--env");
    config({ path: i >= 0 ? argv[i + 1] : ".env.local", quiet: true });
    const url = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
    if (!url) { console.error("DATABASE_URL is not set."); process.exit(1); }
    console.log(formatIdentity(await dbIdentity(url)));
  })().catch(e => { console.error("failed:", e.message); process.exit(1); });
}
