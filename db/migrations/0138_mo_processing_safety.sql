-- Manufacturing order processing safety. ALL ADDITIVE and nullable; no existing row changes meaning.
--
-- completing_at: an atomic claim taken before a completion posts, so a double click, a second tab or a
-- double approval cannot post the same completion twice. A stale claim is taken over after a few minutes.
ALTER TABLE "manufacturing_orders" ADD COLUMN IF NOT EXISTS "completing_at" timestamp;
--> statement-breakpoint
-- completion_pending_at: set while a completion waits for approval; locks the order's lots and refuses a second
-- staged completion, so the approver reviews what actually posts.
ALTER TABLE "manufacturing_orders" ADD COLUMN IF NOT EXISTS "completion_pending_at" timestamp;
--> statement-breakpoint
-- lot_allocations.expiry_reason: why an expired lot was chosen anyway. Required at allocation when the lot is past
-- its expiry date; recorded on the audit trail when the run consumes it.
ALTER TABLE "lot_allocations" ADD COLUMN IF NOT EXISTS "expiry_reason" varchar(255);
