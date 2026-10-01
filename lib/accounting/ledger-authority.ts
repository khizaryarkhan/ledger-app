import { db } from "@/db";
import { organisations } from "@/db/schema";
import { eq } from "drizzle-orm";
import { bad } from "@/lib/api";

export type BookOfRecord = "native" | "qbo" | "xero";

export type LedgerAuthority = {
  bookOfRecord: BookOfRecord;
  /** True only when our own journal_lines are this org's complete books.
   *  GL ingestion from a synced provider is still shadow-only (see CLAUDE.md
   *  "Provider transactions into our own GL"), so a synced org's native
   *  ledger is never complete — this is deliberately just `bookOfRecord ===
   *  "native"` today, not a finer-grained "reconciled" check. */
  nativeStatementsValid: boolean;
};

export async function ledgerAuthority(orgId: string): Promise<LedgerAuthority> {
  const [org] = await db.select({ bookOfRecord: organisations.bookOfRecord })
    .from(organisations).where(eq(organisations.id, orgId)).limit(1);
  const bookOfRecord = (org?.bookOfRecord as BookOfRecord | undefined) ?? "native";
  return { bookOfRecord, nativeStatementsValid: bookOfRecord === "native" };
}

/** Same `{ error }` shape as requireModule() — call before serving a
 *  statement/report that reads only journal_lines. Refuses for a
 *  consolidated scope if ANY org in it isn't the book of record, naming
 *  which ones so the caller can explain why. */
export async function requireLedgerAuthority(orgIds: string[]) {
  const authorities = await Promise.all(orgIds.map(id => ledgerAuthority(id)));
  const invalid = authorities.filter(a => !a.nativeStatementsValid);
  if (invalid.length > 0) {
    return {
      error: bad(
        "This organisation's ledger lives in its connected accounting provider, not here — see the provider's own report instead.",
        409,
      ),
      code: "LEDGER_NOT_BOOK_OF_RECORD" as const,
      providers: invalid.map(a => a.bookOfRecord),
    };
  }
  return { error: null };
}
