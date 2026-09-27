-- Process MO list view needs a Started and a Manufactured timestamp per
-- order. Neither existed: status transitions only ever touched updatedAt,
-- which is overwritten by every later transition, so it can't answer "when
-- did this order start" once it moves on, and lot_allocations (the only
-- other trace of a start) are deleted at completion/cancel. Both columns are
-- nullable — every existing order predates them and simply shows "—".
ALTER TABLE "manufacturing_orders"
	ADD COLUMN IF NOT EXISTS "started_at" timestamp,
	ADD COLUMN IF NOT EXISTS "completed_at" timestamp;
