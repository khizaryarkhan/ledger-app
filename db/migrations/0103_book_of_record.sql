-- Whose books are authoritative for this org. Previously guessed two
-- different, disagreeing ways (isSyncedOrg() by chart source vs
-- detectProvider() by token) -- they already disagreed for AM MERCHADISING,
-- which holds a Xero token but keeps its books natively. This is the single
-- explicit answer, backfilled from today's chart, with AM forced to 'native'
-- deliberately (matching the recorded decision, not the chart-derived guess).
ALTER TABLE "organisations" ADD COLUMN "book_of_record" varchar(16) NOT NULL DEFAULT 'native';
--> statement-breakpoint
UPDATE "organisations" o
SET "book_of_record" = COALESCE(
  (SELECT a."source" FROM "accounts" a WHERE a."org_id" = o."id" AND a."source" <> 'native' LIMIT 1),
  'native'
)
WHERE trim(o."name") NOT ILIKE 'AM MERCHADISING%';
--> statement-breakpoint
UPDATE "organisations" SET "book_of_record" = 'native' WHERE trim("name") ILIKE 'AM MERCHADISING%';
