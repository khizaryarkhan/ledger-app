/**
 * The proof gate: does our mirrored ledger reproduce QBO's books?
 *
 * This is the whole reason the ingestion is built shadow-first. Rather than
 * argue that the mappings are right, we post them, ask QuickBooks for its own
 * TrialBalance, and diff the two account by account. If every account agrees to
 * the cent, the ingestion is correct by demonstration. If it doesn't, the
 * differences say exactly which mapping is wrong.
 *
 * Nothing may move onto the GL until this comes back clean.
 *
 * Accounts are matched on QBO's own account id, never on name: names are
 * user-editable, get renamed, and collide between parents and sub-accounts.
 * `accounts.external_id` holds that id already because the COA sync puts it
 * there.
 */

import { db } from "@/db";
import { accounts } from "@/db/schema";
import { and, eq, isNotNull } from "drizzle-orm";
import { getValidToken } from "@/lib/qbo-sync";
import { trialBalance } from "./financials";

const QBO_API = process.env.QBO_ENV === "sandbox"
  ? "https://sandbox-quickbooks.api.intuit.com/v3/company"
  : "https://quickbooks.api.intuit.com/v3/company";

const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

export type TbDiffRow = {
  qboAccountId: string | null;
  name: string;
  /** Net debit-positive balance, so one number per account rather than two. */
  qbo: number;
  ours: number;
  diff: number;
  /** Why this row is here, when it isn't simply a value mismatch. */
  note?: "missing-in-ours" | "missing-in-qbo" | "unmapped-account";
};

export type TbComparison = {
  asOf: string;
  matched: number;
  rows: TbDiffRow[];
  qboTotal: number;
  ourTotal: number;
  /** True when every account agrees within tolerance. */
  clean: boolean;
};

/**
 * QBO's TrialBalance as { accountId → net debit-positive balance }.
 *
 * The report nests rows (sections, sub-accounts, totals), so this walks the
 * tree and takes only leaf rows that carry an account id — summary rows would
 * otherwise be counted a second time on top of their children.
 */
export async function fetchQboTrialBalance(orgId: string, asOf: string): Promise<Map<string, { name: string; net: number }>> {
  const token = await getValidToken(orgId);
  if (!token) throw new Error(`org ${orgId} has no QuickBooks connection`);

  const url = `${QBO_API}/${token.realmId}/reports/TrialBalance`
            + `?start_date=1900-01-01&end_date=${asOf}&testing_migration=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) {
    throw new Error(`QuickBooks TrialBalance returned ${res.status}: ${(await res.text().catch(() => "")).slice(0, 300)}`);
  }
  const report = await res.json();

  const out = new Map<string, { name: string; net: number }>();
  const walk = (rows: any[]) => {
    for (const r of rows ?? []) {
      if (Array.isArray(r?.Rows?.Row)) walk(r.Rows.Row);
      // Only leaf data rows carry ColData with an account id. Section headers
      // and the grand total do not, which is exactly how we avoid them.
      const cd = r?.ColData;
      if (r?.type === "Data" && Array.isArray(cd) && cd[0]?.id) {
        const debit  = round2(parseFloat(cd[1]?.value || "0") || 0);
        const credit = round2(parseFloat(cd[2]?.value || "0") || 0);
        const id = String(cd[0].id);
        const prev = out.get(id);
        out.set(id, { name: cd[0]?.value ?? id, net: round2((prev?.net ?? 0) + debit - credit) });
      }
    }
  };
  walk(report?.Rows?.Row ?? []);
  return out;
}

/** our accounts.id → QBO account id, for lining the two trial balances up. */
async function ourIdToQboId(orgId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: accounts.id, externalId: accounts.externalId })
    .from(accounts)
    .where(and(eq(accounts.orgId, orgId), isNotNull(accounts.externalId)));
  return new Map(rows.map(r => [r.id, String(r.externalId)]));
}

/**
 * Compare the two trial balances as at a date.
 *
 * `tolerance` is per account, in currency units. It exists for genuine rounding
 * only — anything larger is a mapping defect and must show up as a row, not be
 * smoothed away.
 */
export async function compareTrialBalance(orgId: string, asOf: string, tolerance = 0.01): Promise<TbComparison> {
  const [qbo, ours, idMap] = await Promise.all([
    fetchQboTrialBalance(orgId, asOf),
    trialBalance([orgId], asOf),
    ourIdToQboId(orgId),
  ]);

  const oursByQboId = new Map<string, { name: string; net: number }>();
  const rows: TbDiffRow[] = [];

  for (const r of ours.rows) {
    const net = round2(r.debit - r.credit);
    const qboId = idMap.get(r.accountId);
    if (!qboId) {
      // An account of ours with no QBO id — a native account, or the Suspense
      // account. A non-zero balance here is itself a finding: it means lines
      // landed somewhere QBO has no counterpart for.
      if (net !== 0) {
        rows.push({ qboAccountId: null, name: r.name, qbo: 0, ours: net, diff: net, note: "unmapped-account" });
      }
      continue;
    }
    const prev = oursByQboId.get(qboId);
    oursByQboId.set(qboId, { name: r.name, net: round2((prev?.net ?? 0) + net) });
  }

  let matched = 0;
  for (const [qboId, q] of qbo) {
    const o = oursByQboId.get(qboId);
    const ourNet = o?.net ?? 0;
    const diff = round2(q.net - ourNet);
    if (Math.abs(diff) <= tolerance) { matched++; continue; }
    rows.push({
      qboAccountId: qboId, name: q.name, qbo: q.net, ours: ourNet, diff,
      note: o ? undefined : "missing-in-ours",
    });
  }

  // Accounts we hold a balance on that QBO's trial balance never mentioned.
  for (const [qboId, o] of oursByQboId) {
    if (qbo.has(qboId) || o.net === 0) continue;
    rows.push({ qboAccountId: qboId, name: o.name, qbo: 0, ours: o.net, diff: round2(-o.net), note: "missing-in-qbo" });
  }

  rows.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

  const qboTotal = round2([...qbo.values()].reduce((s, v) => s + v.net, 0));
  const ourTotal = round2([...oursByQboId.values()].reduce((s, v) => s + v.net, 0));

  return { asOf, matched, rows, qboTotal, ourTotal, clean: rows.length === 0 };
}
