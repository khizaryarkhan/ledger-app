# EDI for purchase orders — brief and gap analysis

Status: **research done, nothing built.** Written 2026-11-19 against `main` at `f39332e`.
Audience: the agent picking this up. Read `CLAUDE.md` first (conventions, neon-http has no
transactions, migration rules, module gating, "a date is a date").

## 1. Why

A supplier has asked us to send purchase orders by EDI instead of email/PDF. Today a PO
leaves the app only as an emailed PDF with a supplier-portal link
(`lib/accounting/po-supplier-server.ts`, `sendPurchaseOrders`). Their ERP cannot import that.

## 2. What EDI is (so the scope is clear)

EDI is **an agreed file format plus an agreed way to deliver the file**. We never connect
to the partner's ERP: we produce a file, deliver it, and their EDI gateway imports it.

```
PO in our app -> EDI file (X12 850 / EDIFACT ORDERS) -> AS2 | SFTP | VAN -> their gateway -> their ERP
```

- **Standard**: X12 (North America; PO = 850) or EDIFACT (UK/EU; PO = ORDERS). Each partner
  publishes an *implementation guide* naming the exact segments, codes and version
  (e.g. X12 4010/5010, EDIFACT D96A). **We have not received this partner's guide yet.**
- **Transport**: SFTP (simplest), AS2 (certificates, signed receipts — hard to run ourselves),
  or a VAN (paid mailbox network).
- **Document set**, usually more than the PO:
  | X12 | Meaning | Direction |
  |---|---|---|
  | 850 | Purchase order | out |
  | 997 | "File received" functional acknowledgement | both |
  | 855 | PO acknowledgement (accept / change / reject) | in |
  | 860 | PO change / cancel | out |
  | 856 | Advance ship notice (ASN) | in |
  | 810 | Invoice | in |

Example 850 line, to show what the data has to support:

```
PO1*1*40*BG*12.50**VP*SUP-88231*UP*012345678905*BP*RM-RICE-01~
PO4*1*25*KG~
```
40 bags at 12.50; VP = **their** part number, UP = GTIN, BP = **our** item code;
PO4 = each bag holds 25 kg.

### How items correlate with the partner's item register
The partner matches each line using the codes we send. Send all we have:
1. **Their part number (VP)** — most reliable, most partners require it. Usually identifies a
   specific pack ("25 kg bag"), so it should be stored **per pack level**.
2. **GTIN (UP/EN)** — universal; we already store GTINs per pack level.
3. **Our item code (BP)** — works only if they keep a customer cross-reference for us.

The cross-reference lives on OUR side, on the supplier link (`item_supplier_skus`).

### How the unit is unambiguous
Every quantity carries a **unit code** (X12: `KG`, `LB`, `BG`, `CA`, `EA`, `PL`; EDIFACT uses
UN/ECE Rec 20/21: `KGM`, `LBR`, `XBG`…). A bag/case is pinned down by the part number
(their catalog defines it) and optionally a PO4 pack segment. Pallets are normally a
*shipping* unit reported in the 856, not an ordering unit.

## 3. Current state — what an 850 needs vs what exists

Legend: ✅ have · 🟡 partly · ❌ missing.

### Header
| Needed | | Where / gap |
|---|---|---|
| PO number, date, currency | ✅ | `trade_documents.doc_number`, `issue_date`, `currency` (kind `PurchaseOrder`) |
| Buyer / bill-to name + address | ✅ | `organisations.address*`, `phone`, `email`, `tax_number` |
| Supplier name + address | ✅ | `parties.address*` (via `ap_suppliers` view — FK/write to `parties`, see CLAUDE.md) |
| Requested delivery date | ✅ | line `requested_date`; header `expiry_date` is labelled "Delivery date" |
| Payment terms | 🟡 | `parties.payment_terms` is **integer days only** (default 30); no discount terms; not copied onto the PO |
| **Ship-to address** | ❌ | PO has no ship-to. `stock_locations.address` is free text, not structured |
| **GLN** (org, locations, supplier) | ❌ | none anywhere (already listed as "next" in the GS1 section of CLAUDE.md) |
| **Our account number with the supplier** | ❌ | no field on `parties` |
| **EDI interchange IDs + qualifiers** (ISA/UNB) | ❌ | nothing on org or supplier |
| Buyer contact (name/phone/email) | 🟡 | `created_by` gives the user; no phone. `contacts` table is **customers only** (`customer_id` NOT NULL) — suppliers have no contacts |
| Incoterms / shipping terms, carrier, ship-via | ❌ | not stored |
| Notes | ✅ | `memo` |
| PO type (standard/blanket/drop-ship) | ❌ | all standard — acceptable for v1 |

### Lines (`trade_document_lines`)
| Needed | | Where / gap |
|---|---|---|
| Line number | ✅ | `line_no` — must be echoed back to match 855/856 |
| Qty, unit price, amount | ✅ | `qty`, `rate`, `amount` (rate is per ORDER unit) |
| **Their part number** | 🟡 | `item_supplier_skus` has BOTH `supplier_sku` ("Supplier's SKU") and `item_code_by_supplier` ("Supplier's item code") with no defined difference (`components/products-register.tsx` ~L731). One per link, not per pack level |
| GTIN | ✅ | `item_identifiers` (scheme GTIN, per pack level, normalised to 14 digits; `lib/gs1.ts`) |
| Our item code | ✅ | item / `item_skus.sku_code` |
| **Unit code** | ❌ | `lib/inventory/uom.ts` has fixed `UOMS` and `PACK_TYPES` lists but **no EDI codes**. `lib/inventory/order-options.ts` (~L112–141) writes `order_uom` = pack type, or the literal `"inner"`/`"outer"`/`"pack"` when none was chosen — uncodeable. Pack type is a UI dropdown only; not enforced server-side |
| Pack size | ✅ | `units_per_order_unit`, `pack_level`, `ordered_base_qty`, link pack sizes |
| Line dates | ✅ | `requested_date`, `promised_date`, `original_promised_date` |
| Charges/allowances (freight, discount) | ❌ | only as an extra line |

### Inbound documents
| Doc | | Notes |
|---|---|---|
| 855 ack | 🟡 | Supplier portal already stores confirm / decline / qty+date revisions (`po_supplier_responses`, `po_line_revisions`, `decideProposal`, `confirmTradeDoc`). EDI 855 should feed the SAME path. Gaps: price changes (portal forbids them by design), per-line reject |
| 860 change/cancel (out) | ❌ | no PO edit after send exists at all (CLAUDE.md, PO workflow "Not built") |
| 856 ASN | 🟡 | receiving has `delivery_note_no`, supplier batch / production / best-before / expiry on lots. Missing: SSCC, carrier/tracking on receipts, an "expected delivery" record to pre-fill a receipt |
| 810 invoice | 🟡 | `billFromReceipts` matching exists; no import path |

### EDI layer itself — all missing
- Partner profile per supplier (enabled, standard+version, IDs, transport, required docs, test/live).
- Code mapping (our UoM / pack type → EDI code; per-partner override).
- Transmission log (every file in/out, control numbers, 997 status, errors, raw payload).
- Control-number sequences per partner (never reused).
- Pre-send validation (refuse a PO whose line lacks part number/GTIN or unit code; name the line).

## 4. Proposed plan

### Phase 0 — data foundations (useful without EDI; do first)
1. **Ship-to on the PO**: structured address on `stock_locations` (+ optional GLN); PO header
   `ship_to_location_id`. Default = org default location.
2. **One "their part number", per pack level**: decide the meaning of `supplier_sku` vs
   `item_code_by_supplier` (proposal: `supplier_sku` = their part number, the other = alternate
   or retired); allow a per-pack-level supplier code, e.g. `item_identifiers` scheme `SUPPLIER`
   owned by the supplier link. Mind the uniqueness rules in `identifiers-server.ts`.
3. **EDI unit codes**: add X12 + UN/ECE codes to `UOMS` and `PACK_TYPES` (pure, in `uom.ts`);
   stop writing `"inner"/"outer"/"pack"` as `order_uom`; validate pack type server-side.
4. **Supplier contacts + our account number** with the supplier (`parties` column or new
   `party_contacts`; `contacts` FKs customers, don't overload it).
5. **Payment terms with discount + Incoterms** on the supplier, copied to the PO.

### Phase 1 — outbound 850
- `edi_partners` (per supplier), `edi_messages` (log), control-number sequence.
- Pure builder `lib/edi/x12-850.ts` (PO → segments), unit-tested from fixtures; pre-send
  validator shared by UI and server.
- "Send by EDI" beside "Send to supplier"; stamps `sent_at` like the email path.
- Transport: **decide build vs buy** (see §5).

### Phase 2 — inbound
997 → message status; 855 → existing proposal/confirm path; 856 → staged goods receipt;
810 → bill draft matched to receipts. Inbound webhook/SFTP poll, idempotent on control number.

### Phase 3 — 860 change/cancel (needs a PO edit path first).

## 5. Open decisions (for the product owner)
1. **Build vs buy transport.** EDI-as-a-service (Stedi, Orderful, SPS Commerce, TrueCommerce):
   we POST JSON, they translate, deliver (AS2/VAN), test with the partner, webhook replies back —
   days of work, monthly fee. Self-build: 850 generator is easy, SFTP is easy, **AS2 is not**.
   Recommendation: provider for the first partner unless they accept SFTP.
2. Module: new opt-in `edi` module key (`lib/modules.ts`) or part of `manufacturing`/`payables`?
3. Which PO table: native `trade_documents` PurchaseOrder (feeds Receiving) — NOT Payables'
   `purchase_orders` (pushes to QBO/Xero; see CLAUDE.md duplication note).

## 6. Questions to send the partner
1. Standard and version? Please send the implementation guide.
2. Transport: AS2, SFTP or VAN (which)?
3. Required documents: 850 only, or 855 / 856 / 810 / 860 / 997?
4. IDs: interchange ID + qualifier for both sides; how ship-to is identified (their code, DUNS, GLN)?
5. Which product identifier is mandatory (VP, GTIN, both)? Which unit codes per product?
6. Testing/certification process and timeline.

## 7. Constraints to respect
- Pure rules in client-safe `lib/...` modules, db halves in `*-server.ts`; unit tests, no DB in CI.
- neon-http: no transactions — validate first, single multi-row writes, compensate loudly.
- Hand-written migrations: `--> statement-breakpoint`, one command per chunk, journal `when`
  strictly increasing (latest is in CLAUDE.md), run `npm run db:verify`.
- New routes must be registered in `lib/modules.ts` `API_OWNERS`/`PAGE_OWNERS`
  (`tests/module-gating.test.ts` enforces it); regenerate `npm run mcp:manifest`.
- Forms: `components/form-kit.tsx` `Drawer` + pinned footer.
- Money/quantity formatting via `lib/format.ts`; quantities 6dp (`roundQty`), never 4.
- EDI dates are calendar dates (`YYYYMMDD`) — build from the stored `YYYY-MM-DD` string, never
  via `new Date()`.
