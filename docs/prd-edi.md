# EDI and trade standards — PRD (whole trade cycle, both directions)

Status: **research done, nothing built.** Rewritten 2026-11-19 against `main` at `f39332e`.
Every code reference in §4 was re-checked against `db/schema.ts` and `lib/` on 2026-11-19
(table columns, function names and locations); four corrections from that pass are marked **(verified)**.
Supersedes the earlier "EDI for purchase orders" brief, which was framed as a PO feature.
Audience: the agent picking this up. Read `CLAUDE.md` first (conventions, neon-http has no
transactions, migration rules, module gating, "a date is a date").

## 1. Why, and what changed from the first brief

A supplier has asked us to send purchase orders by EDI instead of email/PDF; their ERP cannot
import our PDF. That is the trigger, but the product answer is **not a PO feature**. It is a
**standards layer** that carries every trade document in both directions, because:

- a customer will ask for the mirror image (send us 850s, expect 855/856/810 back);
- receiving and shipping are where the standards actually bite (ASN, SSCC, GS1-128 labels);
- anything built PO-only gets rebuilt for the sales side.

Ledger is an ERP that must fit any organisation (see CLAUDE.md, "Resources menu is capability-driven"):
nothing here may hard-code one partner's codes, IDs or document set.

**Principle: canonical documents first, formats second.** The app speaks a neutral internal
model (PO, PO acknowledgement, ASN, Invoice, change/cancel). X12 and EDIFACT are **adapters**
that read and write that model. App logic never touches segments or qualifiers. X12 now and
EDIFACT later is a new adapter, not a rewrite.

## 2. What EDI is (so the scope is clear)

EDI is **an agreed file format plus an agreed way to deliver the file**. We never connect to the
partner's ERP: we produce a file, deliver it, and their EDI gateway imports it (and the reverse).

```
our app -> canonical doc -> adapter (X12 / EDIFACT) -> AS2 | SFTP | VAN | provider API -> partner gateway -> partner ERP
```

- **Standard**: X12 (North America; PO = 850) or EDIFACT (UK/EU; PO = ORDERS). Each partner
  publishes an *implementation guide* naming the exact segments, codes and version
  (e.g. X12 4010/5010, EDIFACT D96A). **We have not received this partner's guide yet.**
- **Transport**: SFTP (simplest), AS2 (certificates, signed receipts, hard to run ourselves),
  a VAN (paid mailbox network), or an EDI-as-a-service API.
- **Identifiers**: every document carries sender/receiver IDs with qualifiers (ISA/GS or UNB),
  and usually GLNs or partner codes for ship-to / bill-to.

### The document set, by side

| Side | Doc | Direction | X12 | EDIFACT | Lands in the app |
|---|---|---|---|---|---|
| **Purchasing** (we buy) | Purchase order | out | 850 | ORDERS | native `trade_documents` kind `PurchaseOrder` |
| | PO change / cancel | out | 860 | ORDCHG | needs a PO edit path (not built) |
| | PO acknowledgement | in | 855 | ORDRSP | existing supplier-response path |
| | Advance ship notice | in | 856 | DESADV | pre-fills a Goods Receipt |
| | Invoice | in | 810 | INVOIC | bill draft matched to receipts |
| **Receiving** | Receiving advice | out (optional) | 861 | RECADV | from a posted Goods Receipt |
| | Pallet / carton label | in (scan) | SSCC, GS1-128 | same | receiving screen (parser exists: `lib/gs1.ts`) |
| **Sales** (we sell) | Customer PO | in | 850 | ORDERS | creates a native `SalesOrder` |
| | Customer change / cancel | in | 860 | ORDCHG | changes/cancels the SO (rules needed) |
| | PO acknowledgement | out | 855 | ORDRSP | from SO confirm / revise |
| | Advance ship notice | out | 856 | DESADV | from a posted Shipment (SSCC, carrier, tracking) |
| | Invoice | out | 810 | INVOIC | from `invoiceFromShipments` / Invoice |
| **Both** | Functional acknowledgement | both | 997 | CONTRL | message status only |

Example X12 850 line, to show what the data has to support:

```
PO1*1*40*BG*12.50**VP*SUP-88231*UP*012345678905*BP*RM-RICE-01~
PO4*1*25*KG~
```
40 bags at 12.50; VP = **partner's** part number, UP = GTIN, BP = **buyer's** item code;
PO4 = each bag holds 25 kg. On our own outbound 850 we are the buyer (BP is ours, VP theirs);
on an inbound 850 the roles flip (their BP is the code we must map to one of our items).

### How items correlate across registers
The receiving side matches each line using the codes sent. Send all we have, and on inbound
resolve in this order:
1. **Part number (VP / BP)**, most reliable, usually identifies a specific pack.
2. **GTIN (UP/EN)**, universal; we store GTINs per pack level (`item_identifiers`).
3. **The sender's own item code**, only if a cross-reference exists.

Cross-references live on OUR side: supplier link (`item_supplier_skus`) for purchasing, and
**a customer-item link that does not exist yet** for sales (see §4).

### How the unit is unambiguous
Every quantity carries a **unit code** (X12 `KG`, `LB`, `BG`, `CA`, `EA`, `PL`; EDIFACT UN/ECE
Rec 20/21 `KGM`, `LBR`, `XBG`…). A bag/case is pinned down by the part number and optionally a
pack segment (PO4 / PAC). Pallets are normally a *shipping* unit reported in the 856 (SSCC), not
an ordering unit.

## 3. Architecture

### 3.1 Partner = any party
Customers and suppliers share the `parties` table (migration `0079`; `customers` and
`ap_suppliers` are compatibility **views**, so FK/write to `parties`, see CLAUDE.md). One
**EDI partner profile** per party covers both directions:

- enabled, test/live, standard + version, our and their interchange IDs + qualifiers,
  transport + endpoint/credentials (encrypted via `lib/crypto.ts`), the document set enabled
  per direction, per-partner overrides (unit-code map, qualifier choices, required fields).
- A party that is both customer and supplier is two `parties` rows today; do not try to unify
  that here. Each gets its own profile.

### 3.2 Canonical model (pure, client-safe)
`lib/edi/model.ts`: neutral types for `EdiOrder`, `EdiOrderAck`, `EdiOrderChange`, `EdiAsn`,
`EdiInvoice`. Header, parties (buyer / seller / ship-to / bill-to with GLN or partner code),
lines (line no, qty, UoM code, price, part numbers by qualifier, GTIN, dates), totals, notes.

- **Builders** (our docs -> canonical): `lib/edi/build/*`, pure, unit-tested from fixtures.
- **Adapters** (canonical <-> wire): `lib/edi/x12/*` first; EDIFACT later behind the same interface.
- **Parsers** (wire -> canonical): same adapters, idempotent on control number.
- **Mappers** (canonical -> our records): db halves in `*-server.ts`, e.g. inbound order ->
  `createTradeDoc` for a SalesOrder. Reuse the existing posting/creation paths; **never write a
  second way to create an SO, receipt or bill** (CLAUDE.md "one creation path per record").
- **Validators**: pre-send (refuse a PO whose line lacks part number/GTIN or unit code, naming
  the line) and on-receive (unknown item/unit/ship-to queues for a person, never fails silently
  and never guesses).

### 3.3 Transport (pluggable)
`lib/edi/transport/*` behind one interface: `send(file, partner)` and an inbound entry
(webhook or poll). First implementation chosen by decision D1 (§7). Transport never contains
business rules.

### 3.4 Message log and control numbers
- `edi_messages`: every file in/out, direction, doc type, partner, control numbers, status
  (queued / sent / delivered / acked / rejected / error), 997 result, error text, **raw payload**,
  link to the app record (`doc_type` + `doc_id`, same polymorphic no-FK convention as
  `transaction_links`).
- `edi_control_numbers`: per-partner, per-direction sequences, **never reused**; allocated with
  a single atomic UPDATE (neon-http has no transactions).
- **Inbound is idempotent** on (partner, interchange control number, doc control number): a
  replayed file changes nothing.

### 3.5 Where it plugs into existing flows
- **Send**: "Send by EDI" beside "Send to supplier" on POs (`sendPurchaseOrders` in
  `lib/accounting/po-supplier-server.ts`); stamps `sent_at` like the email path. Same pattern on
  Shipment (ASN) and Invoice (810) for sales.
- **Acknowledgement in**: 855 feeds the SAME proposal/confirm path the supplier portal uses
  (`po_supplier_responses`, `po_line_revisions`, `decideProposal`, `confirmTradeDoc`). A revision
  is only stored, never auto-applied (existing rule).
- **ASN in**: creates an expected-delivery record that pre-fills a Goods Receipt; the receipt still
  posts through `postGoodsReceipt` after a person counts it. An ASN is a claim, not stock.
- **Customer 850 in**: creates a SalesOrder through `createTradeDoc` with the customer's PO number
  in `party_ref`. Anything unresolvable goes to a review queue.
- **Module gating**: new opt-in module key `edi` (`lib/modules.ts`), owner of `/api/edi/**` and
  its pages; register in `PAGE_OWNERS`/`API_OWNERS`; `tests/module-gating.test.ts` enforces it.

## 4. Current state vs what the cycle needs

Legend: ✅ have · 🟡 partly · ❌ missing.

### Shared foundations (both sides)
| Needed | | Where / gap |
|---|---|---|
| Document number, date, currency | ✅ | `trade_documents.doc_number`, `issue_date`, `currency` |
| Our address, phone, tax no. | ✅ | `organisations.address*`, `phone`, `email`, `tax_number` |
| Partner address | 🟡 | `parties.address_street/line2/city/state/postcode` are structured, but parties have **no `address_country` column** (verified); see country row |
| **ISO country code** (ISO 3166) | ❌ | (verified) `parties.country` is a free-text name, `countries` is an org-defined list of NAMES with no code, `organisations.address_country` is free varchar(64). EDI addresses need the 2-letter code |
| Line number echoed back | ✅ | `trade_document_lines.line_no` (needed to match 855/856/860) |
| Qty, price, amount, pack size, line dates | ✅ | `qty`, `rate` (per ORDER unit), `amount`, `units_per_order_unit`, `pack_level`, `requested_date`/`promised_date` |
| GTIN per pack level | ✅ | `item_identifiers`, normalised to 14 digits, `lib/gs1.ts` |
| Identifier owner for a CUSTOMER code | ❌ | (verified) `item_identifiers` owners are `item_sku_id` or `supplier_sku_id` only; `scheme` is varchar(**8**) (`GTIN`/`OTHER`), so `SUPPLIER`/`CUSTOMER` fit exactly but nothing longer |
| **GLN** (org, locations, parties) | ❌ | none anywhere (listed "next" in CLAUDE.md GS1 section) |
| **Structured ship-to / bill-to** | ❌ | `stock_locations.address` is free text; PO/SO carry no ship-to; no customer ship-to locations |
| **EDI interchange IDs + qualifiers** | ❌ | nothing on org or party |
| **EDI unit codes** | ❌ | `lib/inventory/uom.ts` `UOMS`/`PACK_TYPES` have no EDI codes; `lib/inventory/order-options.ts` (~L112-141) writes `order_uom` = pack type or the literal `"inner"`/`"outer"`/`"pack"` (uncodeable; verified at lines 112, 116, 133, 137, 141); pack type is a UI dropdown only, not enforced server-side. (verified) `PACK_TYPES` includes `"pallet"`, so a pallet can be an ORDER unit today; EDI normally treats it as a shipping unit (SSCC), so each partner's guide decides whether `PL` is allowed on an order line |
| **SSCC** (pallet/carton IDs) | ❌ | not stored on shipments or receipts (logistic units are SSCC per CLAUDE.md) |
| Payment terms, discount terms, Incoterms | 🟡 | `parties.payment_terms` is integer days only (default 30); no discount terms; not copied onto documents; no Incoterms |
| Party contacts | 🟡 | `contacts` is **customers only** (`customer_id` NOT NULL); suppliers have none |
| Our account number with the partner | ❌ | no field on `parties` |
| Charges / allowances (freight, discount) | ❌ | only as an extra line |

### Purchasing side
| Needed | | Where / gap |
|---|---|---|
| **Their part number, per pack level** | 🟡 | `item_supplier_skus` has BOTH `supplier_sku` and `item_code_by_supplier` with no defined difference (`components/products-register.tsx` ~L731), one per link, not per pack level |
| PO ack in (855) | 🟡 | portal stores confirm / decline / qty+date revisions; gaps: price changes (portal forbids by design), per-line reject |
| PO change/cancel out (860) | ❌ | no PO edit-after-send exists (CLAUDE.md PO workflow "Not built") |
| ASN in (856) | 🟡 | receiving has `delivery_note_no`, supplier batch / production / best-before / expiry on lots; missing SSCC, carrier/tracking on receipts, an "expected delivery" record |
| Invoice in (810) | 🟡 | `billFromReceipts` matching exists; no import path |
| Buyer contact | 🟡 | `created_by` gives the user; no phone |

### Receiving side
| Needed | | Where / gap |
|---|---|---|
| Scan GS1-128 / SSCC | 🟡 | `parseGs1` and `item_identifiers` exist; the scan -> receiving-line path is "next, not built" |
| Pre-fill from ASN | ❌ | needs the expected-delivery record above |
| Receiving advice out (861) | ❌ | optional; derive from a posted Goods Receipt |

### Sales side
| Needed | | Where / gap |
|---|---|---|
| Customer PO number | ✅ | `trade_documents.party_ref` |
| **Customer's part number for OUR item/SKU** | ❌ | only the supplier-side link exists; need a customer-item link (per pack level) so an inbound 850 line resolves to one of our SKUs |
| Customer ship-to locations | ❌ | one customer, many delivery addresses; none modelled |
| Ack out (855) | 🟡 | SO has Created / Sent / Confirmed status; no outbound send |
| ASN out (856) | 🟡 | `sales_shipments` has `carrier`, `tracking_no`, `delivered_date`; missing SSCC, per-carton/pallet packing structure |
| Invoice out (810) | 🟡 | `invoiceFromShipments` builds the invoice; no outbound EDI send |
| Customer change/cancel in (860) | ❌ | rules for changing a confirmed / partly shipped SO are undefined |

### EDI layer itself: all missing
Partner profile, canonical model, adapters, transport, `edi_messages`, `edi_control_numbers`,
validators, review queue, module key.

## 5. Phased plan

### Phase 0: shared data foundation (valuable without EDI; do first)
Every item serves BOTH sides; build once.
1. **Structured addresses + GLN + ISO country**: structured address and optional GLN on
   `stock_locations`, on `parties` (add `address_country`), and on the org; an ISO 3166 country
   code wherever an address is stored, kept beside the existing country name; **customer ship-to locations**; PO/SO header `ship_to` (default:
   org default location for POs, the customer's default ship-to for SOs).
2. **Part-number cross-references, per pack level**: decide the meaning of `supplier_sku` vs
   `item_code_by_supplier` (proposal: `supplier_sku` = their part number, the other = alternate);
   add the customer-side equivalent (customer-item link). Prefer `item_identifiers`-style rows
   (scheme `SUPPLIER` / `CUSTOMER`, owned by the link) over more columns; mind the uniqueness
   rules in `lib/inventory/identifiers-server.ts` (a code may repeat across owners but never
   point at two different ITEMS).
3. **EDI unit codes**: X12 + UN/ECE codes on `UOMS` and `PACK_TYPES` (pure, in `uom.ts`); stop
   writing `"inner"/"outer"/"pack"` as `order_uom`; validate pack type server-side; per-partner
   override map.
4. **Party data**: contacts for suppliers (new `party_contacts`; do not overload `contacts`),
   our account number with the party, payment terms with discount, Incoterms, copied onto the doc.
5. **SSCC**: generate and store on shipments (outbound packing structure) and capture on receipts
   (inbound scan); extend `lib/gs1.ts` (SSCC check digit, build, parse).
6. **Expected-delivery record** (from an ASN or typed by hand) that Receiving can pre-fill from.

### Phase 1: layer + outbound PO (850)
- Module `edi`, `edi_partners`, `edi_messages`, `edi_control_numbers`, canonical `EdiOrder`,
  `lib/edi/x12` 850 writer, pre-send validator, "Send by EDI" on POs, transport per D1.
- Unit tests from fixtures; no DB in CI.

### Phase 2: purchasing inbound
997 -> message status; 855 -> existing proposal/confirm path; 856 -> expected delivery / staged
receipt; 810 -> bill draft matched to receipts. Inbound endpoint/poll, idempotent on control number.

### Phase 3: sales cycle
Inbound 850 -> SalesOrder (review queue for anything unresolved); outbound 855 from SO confirm;
outbound 856 from Shipment (SSCC, carton/pallet structure); outbound 810 from Invoice.

### Phase 4: change and cancel (860, both directions)
Needs defined rules first: a PO edit path after send (purchasing), and a policy for changing a
confirmed or partly shipped SO (sales). Do not build the wire format before those rules exist.

### Phase 5: EDIFACT adapter
Same canonical model and transport; only a new adapter + code tables.

**Sequencing note:** Phases 1 and 3 are independent once Phase 0 lands. Which comes first depends
on D4 (§7); the design must not assume either.

## 6. Hard rules this feature must respect

- **An inbound file never writes stock or ledger by itself.** 850 creates an SO (document only);
  856 creates an expectation; 810 creates a draft bill. Posting stays with the existing engines
  and a person.
- **Never silently guess a mapping.** Unknown part number / GTIN / unit / ship-to -> review queue
  with the raw line shown. A wrong guess here becomes a wrong shipment or a wrong bill.
- **Idempotent in, never-reused out.** Replay of an inbound file is a no-op; control numbers are
  allocated atomically and never reused even if a send fails.
- **Raw payload kept** for every message, in and out, so a dispute can be settled from the file.
- **Credentials encrypted** with `lib/crypto.ts`, never returned to a browser, never in audit
  rows or errors (same treatment as PAX Console keys).
- **Audit**: sends, receipts, rejects and manual overrides logged (`audit_events`,
  `docType`/`docId`).
- **EDI dates are calendar dates** (`YYYYMMDD`): build from the stored `YYYY-MM-DD` string, never
  via `new Date()` (CLAUDE.md "A date is a date").
- Money/quantity via `lib/format.ts`; quantities 6dp (`roundQty`), never 4; money to cents on the
  wire unless the guide says otherwise.

## 7. Open decisions (for the product owner)

- **D1: Build vs buy transport.** EDI-as-a-service (Stedi, Orderful, SPS Commerce, TrueCommerce):
  we POST JSON or X12, they deliver (AS2/VAN), test with the partner, webhook replies back; days
  of work, monthly fee. Self-build: the 850 generator and SFTP are easy, **AS2 is not**.
  Recommendation: provider for the first partner unless they accept SFTP. The transport interface
  (§3.3) keeps this reversible.
- **D2: Module.** Recommendation: new opt-in `edi` module key; it is sold per org.
- **D3: Which PO table.** Native `trade_documents` PurchaseOrder (feeds Receiving), NOT Payables'
  `purchase_orders` (pushes to QBO/Xero; see CLAUDE.md duplication note). Same for SOs: native only.
- **D4: Is the requesting partner a supplier only, or also a customer?** Decides whether the sales
  slice is in the first build or only shapes the design.
- **D5: First standard.** X12 vs EDIFACT depends on the partner's guide.
- **D6: Rules for changing a confirmed / partly shipped SO** (needed before Phase 4 sales side).

## 8. Questions to send the partner
1. Standard and version? Please send the implementation guide.
2. Transport: AS2, SFTP or VAN (which)? Test and production endpoints?
3. Required documents: 850 only, or 855 / 856 / 810 / 860 / 997 / 861? Which do you send us?
4. IDs: interchange ID + qualifier for both sides; how ship-to is identified (partner code, DUNS, GLN)?
5. Which product identifier is mandatory (part number, GTIN, both)? Which unit codes per product?
6. Do you require SSCC / GS1-128 labels on pallets and cartons, and which label layout?
7. Which charges, allowances and payment-term codes do you expect?
8. Testing/certification process and timeline; who is the technical contact?

## 9. Constraints to respect (repo conventions)
- Pure rules in client-safe `lib/...` modules, db halves in `*-server.ts`; unit tests, no DB in CI.
- neon-http: no transactions. Validate first, single multi-row writes, compensate loudly.
- Hand-written migrations: `--> statement-breakpoint`, one command per chunk, journal `when`
  strictly increasing (latest is in CLAUDE.md), run `npm run db:verify` after.
- New routes registered in `lib/modules.ts` `API_OWNERS`/`PAGE_OWNERS`
  (`tests/module-gating.test.ts` enforces it); regenerate `npm run mcp:manifest`; keep EDI
  credential/transport routes off the MCP allowlist.
- Forms: `components/form-kit.tsx` `Drawer` with pinned footer.
- A new `tests/architecture.test.ts` guard is expected: only `lib/edi/**` touches X12 segments,
  nothing else imports an adapter, and nothing in `lib/edi/**` posts stock or ledger directly.
