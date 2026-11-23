import { sql } from "drizzle-orm";
import { journalEntries } from "@/db/schema";

/**
 * True for every entry EXCEPT the reversal of a year-end "Closing" entry.
 *
 * A P&L / "profit to close" sum leaves Closing entries out so it shows real trading. But reopening a closed
 * period reverses the Closing entry, and that reversal (sourceType "Reversal") is a mirror image of an entry the
 * sum never saw: counting it re-credits revenue that was never debited, overstating profit by the whole close.
 * So the reversal must be left out with it. The pair nets to zero on the balance sheet either way.
 */
export const notReversalOfClosing = sql`not exists (
  select 1 from journal_entries closing_entry
  where closing_entry.id = ${journalEntries.reversesEntryId} and closing_entry.source_type = 'Closing'
)`;
