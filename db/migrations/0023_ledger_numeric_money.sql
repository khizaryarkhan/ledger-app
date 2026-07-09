-- float4 loses cents above ~131k; ledger money must be exact.
ALTER TABLE "journal_lines" ALTER COLUMN "debit" TYPE numeric(14,2);
--> statement-breakpoint
ALTER TABLE "journal_lines" ALTER COLUMN "credit" TYPE numeric(14,2);
