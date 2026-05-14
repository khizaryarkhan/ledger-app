/**
 * Reset QBO-synced data across all organisations.
 *
 * POST /api/admin/reset-qbo-data
 *   ?full=true     also wipe customers/projects/contacts (loses local
 *                  classification — rep/region/owner/notes). Default false.
 *   ?orgId=<uuid>  restrict the wipe to a single org. Default: all orgs.
 *
 * Super admin only. Returns counts of rows deleted per table.
 *
 * After running this, kick off a fresh QBO sync from Settings → Integrations
 * (or POST /api/qbo/sync) to repopulate. Recommended when payment-application
 * or JE-state drift has accumulated and you want a known-good starting point.
 */

import { db } from "@/db";
import {
  invoices, payments, paymentApplications, refundReceipts,
  journalEntryArLines, deposits, qboWebhookEvents, qboSyncLog,
  customers, projects, contacts,
} from "@/db/schema";
import { requireAuth, isSuperAdmin, ok, bad } from "@/lib/api";
import { eq } from "drizzle-orm";

export const maxDuration = 120;

export async function POST(req: Request) {
  const { error, session } = await requireAuth();
  if (error) return error;
  if (!isSuperAdmin(session)) return bad("Super admin only", 403);

  const url = new URL(req.url);
  const full       = url.searchParams.get("full") === "true";
  const targetOrg  = url.searchParams.get("orgId"); // null = all orgs

  const filter = (table: any) => targetOrg ? eq(table.orgId, targetOrg) : undefined;

  const deleted: Record<string, number> = {};

  // Order matters: children before parents.
  const wipe = async (label: string, table: any) => {
    const w = filter(table);
    const result = w ? await db.delete(table).where(w) : await db.delete(table);
    // Drizzle returns the row-count in different shapes depending on the driver;
    // best-effort capture.
    deleted[label] = (result as any)?.rowCount ?? (Array.isArray(result) ? result.length : 0);
  };

  await wipe("payment_applications",    paymentApplications);
  await wipe("payments",                payments);
  await wipe("refund_receipts",         refundReceipts);
  await wipe("journal_entry_ar_lines",  journalEntryArLines);
  await wipe("deposits",                deposits);
  await wipe("invoices",                invoices); // also wipes credit memos (txn_type=CreditMemo)
  await wipe("qbo_webhook_events",      qboWebhookEvents);
  await wipe("qbo_sync_log",            qboSyncLog);

  if (full) {
    // WARNING path: also drops customers/projects/contacts. Local rep/region
    // assignments and notes are lost; next sync will recreate from QBO.
    await wipe("contacts", contacts);
    await wipe("projects", projects);
    await wipe("customers", customers);
  }

  return ok({
    scope:    targetOrg ? { orgId: targetOrg } : { allOrgs: true },
    full,
    deleted,
    note:
      "Wipe complete. Trigger a fresh QBO sync to repopulate. " +
      (full
        ? "Customers/projects/contacts were also cleared — they will be recreated from QBO with default classification (no rep / region / owner assignments)."
        : "Customers/projects/contacts were preserved — their classification (rep, region, owner, notes) remains intact. The next sync will update QBO-sourced fields only."),
  });
}
