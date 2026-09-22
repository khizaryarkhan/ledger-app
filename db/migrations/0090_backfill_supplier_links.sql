-- Back-fill item↔supplier links from purchase history, so 0089's sourcing rule
-- blocks only what it should.
--
-- 0089 makes every tracked item `restricted`: a PO / Bill / Expense for it is
-- refused unless the supplier is linked to the item. Production held ONE link
-- across every org, while 249 tracked items (EDC, AM Merchandising, ACC,
-- Aberny, EDC London) had none — so without this, every purchase of a stock
-- item those orgs already buy would start failing the day 0089 deployed.
--
-- The rule, from the product owner: if the system shows an item was bought
-- from a supplier, that supplier is linked. If there is no purchase anywhere,
-- nothing is created — the user links the supplier before raising a PO, which
-- is exactly the decision `restricted` exists to ask for. So history RECORDS
-- decisions that were already made; it never invents one.
--
-- Evidence of "bought from" (every place a purchase names both sides):
--   1. inventory_lots          — purchase lots carry supplier_id (native Bills/receipts)
--   2. goods_receipts/_lines   — not Reversed
--   3. trade_documents/_lines  — kind PurchaseOrder, not cancelled/void
--   4. ap_bills/ap_bill_lines  — QBO/Xero-synced AND native bills. ap_bill_lines.item_id
--                                is TEXT holding the provider's id, so it is mapped:
--                                QBO → ap_items.external_id, Xero → ap_items.code
--                                (the sync stores Xero's ItemCode on the line), native → id.
--                                The provider is read from qbo_id / xero_id, NOT
--                                ap_bills.source, which is unreliable (CLAUDE.md).
--   5. purchase_orders/_lines  — Payables' own PO screen; not cancelled/rejected
--
-- Deliberately NOT evidence: job work (material sent to a knitter was never bought
-- from them — the same exemption the sourcing check makes) and vendor credits.
--
-- The link is minimal: item + supplier only. No UoM, pack or price is made up —
-- a NULL supplier_uom orders in the item's base unit and a NULL unit_price leaves
-- the line's rate alone (lib/inventory/order-options.ts), which is today's
-- behaviour. The user adds commercial terms when they have them.
--
-- Guards: only items that are `restricted` after 0089 (an `open` item needs no
-- link); the supplier must exist IN THE SAME ORG (ap_suppliers is a view over
-- parties, so no FK proves tenancy); an existing link is never duplicated.
-- The supplier most recently bought from becomes preferred, but only for items
-- with no preferred link yet — 0089 already chose one where a link existed, and
-- the partial unique index allows only one.
--
-- ONE statement: neon-http sends each chunk as a prepared statement.
INSERT INTO "item_supplier_skus" ("org_id", "item_id", "supplier_id", "is_preferred")
WITH bought AS (
	SELECT l."org_id", l."item_id", l."supplier_id", l."created_at" AS "at"
	FROM "inventory_lots" l
	WHERE l."source_type" = 'purchase' AND l."supplier_id" IS NOT NULL
	UNION ALL
	SELECT g."org_id", gl."item_id", g."supplier_id", g."created_at"
	FROM "goods_receipts" g JOIN "goods_receipt_lines" gl ON gl."receipt_id" = g."id"
	WHERE g."supplier_id" IS NOT NULL AND g."status" <> 'Reversed'
	UNION ALL
	SELECT d."org_id", dl."item_id", d."party_id", d."created_at"
	FROM "trade_documents" d JOIN "trade_document_lines" dl ON dl."document_id" = d."id"
	WHERE d."kind" = 'PurchaseOrder' AND d."party_id" IS NOT NULL AND dl."item_id" IS NOT NULL
	  AND lower(d."status") NOT IN ('cancelled', 'canceled', 'void', 'voided')
	UNION ALL
	SELECT b."org_id", i."id", b."supplier_id", b."created_at"
	FROM "ap_bills" b
	JOIN "ap_bill_lines" bl ON bl."bill_id" = b."id"
	JOIN "ap_items" i ON i."org_id" = b."org_id" AND (
		(b."qbo_id" IS NOT NULL AND i."source" = 'qbo' AND i."external_id" = bl."item_id")
		OR (b."xero_id" IS NOT NULL AND i."source" = 'xero' AND i."code" = bl."item_id")
		OR (b."qbo_id" IS NULL AND b."xero_id" IS NULL AND i."id"::text = bl."item_id")
	)
	WHERE b."supplier_id" IS NOT NULL AND bl."item_id" IS NOT NULL
	  AND lower(b."accounting_payment_status") NOT IN ('void', 'voided')
	UNION ALL
	SELECT p."org_id", i."id", p."supplier_id", p."created_at"
	FROM "purchase_orders" p
	JOIN "purchase_order_lines" pl ON pl."purchase_order_id" = p."id"
	JOIN "ap_items" i ON i."org_id" = p."org_id" AND (
		i."id"::text = pl."item_id" OR i."external_id" = pl."item_id"
	)
	WHERE p."supplier_id" IS NOT NULL AND pl."item_id" IS NOT NULL
	  AND lower(p."status") NOT IN ('cancelled', 'canceled', 'rejected')
),
pairs AS (
	SELECT b."org_id", b."item_id", b."supplier_id", max(b."at") AS "last_at", count(*) AS "n"
	FROM bought b
	JOIN "ap_items" i ON i."id" = b."item_id" AND i."org_id" = b."org_id" AND i."sourcing_policy" = 'restricted'
	JOIN "ap_suppliers" s ON s."id" = b."supplier_id" AND s."org_id" = b."org_id"
	WHERE NOT EXISTS (
		SELECT 1 FROM "item_supplier_skus" x
		WHERE x."org_id" = b."org_id" AND x."item_id" = b."item_id" AND x."supplier_id" = b."supplier_id"
	)
	GROUP BY b."org_id", b."item_id", b."supplier_id"
),
ranked AS (
	SELECT p.*, row_number() OVER (PARTITION BY p."org_id", p."item_id" ORDER BY p."last_at" DESC, p."n" DESC, p."supplier_id") AS "rk"
	FROM pairs p
)
SELECT r."org_id", r."item_id", r."supplier_id",
	(r."rk" = 1 AND NOT EXISTS (
		SELECT 1 FROM "item_supplier_skus" x
		WHERE x."org_id" = r."org_id" AND x."item_id" = r."item_id" AND x."is_preferred"
	))
FROM ranked r;
