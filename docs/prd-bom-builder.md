# PRD — BOM Builder (single-drawer recipe editor)

Status: Phase 1 shipped (2026-11-11). Phase 2 slice 1 shipped (substitutes, SKU limits, weight, allergens: saved, NOT enforced). Phase 2 slice 2 shipped: orders honour substitutes and SKU limits (unknown-SKU lots refused; substitutes proposed, planner confirms). See CLAUDE.md for the design and what is not built. · Owner: product owner · Mockup: `docs/bom-builder-mockup.html`
Reference concept: "Recipe Builder Concepts v2" (another product; used for ideas, not copied wholesale)

## 1. Problem

Creating a BOM today takes a header drawer plus four more drawers (output pack, ingredient, packaging, operation), each saved on its own. A 10-line recipe is dozens of clicks and many saves, a half-built BOM is a valid saved state, and nothing checks the recipe for sense (typo'd quantities, weights that don't add up, missing packaging). Users who already have recipes in spreadsheets retype every line.

## 2. Goals / non-goals

Goals
1. Create or edit a whole BOM in **one drawer with one Save**, atomically validated.
2. Cut the effort: copy from the product's existing BOM, one-line entry (`honey 7` + Enter), paste a list, smart defaults.
3. Catch mistakes before save: duplicate outputs, typo'd quantities, weight imbalance, unlinked packaging.
4. Show cost per unit live (materials, packaging, labour, overhead).
5. (Phase 2) Ordered substitutes and allowed-SKU limits that Manufacturing Orders actually honour.
6. (Phase 3) Import from text/file/photo and bulk library tools.

Non-goals
- Food-safety plans, floor-step checklists, allergen plans (the reference product's domain; we are a general ERP).
- BOM versions/effectivity dates (see Open questions) and multi-level "explode" costing.
- Changing how MOs, lots or posting work, except where Phase 2 requires it.

## 3. Current state (verified in code, 2026-11-11)

- Tables `boms`, `bom_lines` (role = output | input | pack), `bom_operations`, `work_centres` (db/schema.ts ~2339-2409). Routes: `/api/inventory/boms`, `boms/[id]`, `bom-lines`, `bom-operations`; UI `components/bom-register.tsx` (506 lines, 5 private drawers).
- **A BOM makes `batch_size` of the output item's BASE unit.** Output lines are PACKS (SKUs) of that same item: `qty` = base content per pack, `output_pack_qty` = pack count. Pack lines carry `packaging_for_sku_id`. The mockup's "also makes X" is therefore only valid for **other SKUs of the same item**.
- **MO planning reads the BOM at creation and snapshots it** (`snapshotMaterials`, `lib/inventory/manufacturing-orders.ts:148`): ingredients summed per item, packaging per pack SKU, operations with work-centre rates, yield. Later BOM edits never re-plan a live MO. Completion (`mo-completion.ts`) consumes exactly the lots allocated.
- `exp_yield` exists on the BOM and feeds yield costing (`mo-costing.ts`).
- Writes are admin-only (`company_admin`/`super_admin`) and module-gated (`manufacturing`).
- No transactions on neon-http (`db.transaction()` throws).

## 4. Things the mockup/reference does not cover, and we must (the "not missing anything" list)

| # | Gap | Evidence | Decision |
|---|-----|----------|----------|
| G1 | **Duplicate output SKU** in one BOM silently overwrites: `new Map(outLines.map(l => [l.skuId, ...]))` keeps the last. Reported by the user. | manufacturing-orders.ts:82,156 | Enforce uniqueness in UI, API **and** DB (partial unique index on `(bom_id, role, item_id, coalesce(sku_id,'0000…'))` for outputs). Scan production for existing duplicates first; resolve by script before adding the index. |
| G2 | **Duplicate input item** in one BOM is silently summed in the MO snapshot (`ing.set(itemId, +…)`). | manufacturing-orders.ts:163 | Block in UI with "already in this recipe: add to its amount?"; same DB index for inputs `(bom_id, role, item_id)`; packaging unique on `(bom_id, item_id, packaging_for_sku_id)`. |
| G3 | **Co-products of a different item / rework crumbs** are not supported by MO completion (one output item per MO). | mo-completion.ts | Out of Phase 1. Mockup chip marked "phase 2". Needs its own PRD (secondary output lots + cost split). |
| G4 | **No atomic create.** neon-http has no transactions; one drawer = header + N lines + ops. | CLAUDE.md gotchas | New `POST /api/inventory/boms/full`: validate everything first (items belong to org, units convert, no duplicates, SKUs belong to output item), then multi-row inserts per table; on failure delete the header (cascade) and log loudly. `PUT /boms/[id]/full` for edit = validate, then replace lines/ops in one statement each; reject if `updated_at` changed since load (optimistic concurrency). |
| G5 | **Lots do not record the supplier SKU** (only `supplier_id` and our `sku_id`). | inventory_lots, schema ~2198 | Phase 2 prerequisite: add `inventory_lots.supplier_sku_id`, set from the receipt/PO line (`trade_document_lines.supplier_sku_id` exists). Backfill via receipt→PO link where possible; unknown stays NULL. Rule for NULL under a restriction is an open question (proposed: refuse with a clear message; admin can clear the restriction). |
| G6 | **No weight per unit on items** for the in/out weight check (litres, cases). | no column | Phase 2: `ap_items.weight_per_unit_kg numeric(18,6)` null; asked once when first needed (inline in drawer); items in kg/g need nothing. Weight check is advisory, never blocks Save. |
| G7 | **No allergen data on items.** | none | Phase 2: `ap_items.allergens text[]` (fixed picklist plus org additions). Substitute warning only; no regulatory claims. |
| G8 | **Existing `qty` defaults to 0** and 0-qty lines are savable. | bom_lines.qty default "0" | Builder API requires qty > 0 for inputs and batch > 0. Old routes untouched for compatibility. |
| G9 | **Cost source is weak**: `ap_items.unit_cost` is a 4-byte `real` (known issue in CLAUDE.md); true cost comes from lots consumed. | CLAUDE.md "unitCost still real()" | Roll-up uses average cost of open lots, falling back to `unit_cost`, labelled "estimate". Money shown via `lib/format.ts` only (architecture guard); costs in org home currency. |
| G10 | **Archive/Draft status semantics**: does the MO picker offer only Active BOMs? | not verified | Verify during build; if not, filter to Active. |
| G11 | **Large catalogs**: `GET /boms` returns everything. | boms/route.ts | Server-side search + pagination before Phase 3 library filters. |
| G12 | **Delete blockers** (`bomReferences`) and copy-from: copying must create new ids and a new code; never share lines. | references.ts | Copy is a client-side prefill of a NEW BOM (code `<source>-V2` suggestion, editable, unique per org). |
| G13 | **Unsaved work**: closing the drawer loses everything. | mockup | Confirm on close when dirty; no autosave in v1. |
| G14 | **Conventions**: drawer must be form-kit `Drawer` (size `2xl`, pinned footer via `DrawerFooter`, fields `controlInset`); quantities use `CalcInput`; no private formatter/drawer; text-size and radius guards. | CLAUDE.md, tests/architecture.test.ts | Build to these; the mockup is visual direction only. |
| G15 | **Registries**: new routes need `API_OWNERS` (manufacturing) coverage, MCP route-manifest regenerated (`npm run mcp:manifest`), migration journal `when` > 1794100000000 (latest is 0133). | modules.ts, mcp-manifest test | Add to checklist. |
| G16 | **Audit**: BOM changes are not logged today. | audit_events | Log `bom_created/edited/deleted` with `(docType:'bom', docId)` via `logEvent` (fire-and-forget). |
| G17 | **Substitutes vs sourcing/posting**: a substitute must be a tracked item whose posting group is mapped (else completion fails at `loadItemCostInfo`). | account-roles-server.ts | Validate at save: same unit family, consumable, group mapped, not the primary, not duplicated. |

## 5. Requirements

### Phase 1: Core builder (no new engine behaviour)

R1 **Single drawer.** "+ New BOM" and row click open one `Drawer`: product, batch, ingredients/packaging, operations, cost; footer shows weight balance (info only), blocker text, Cancel, Save.
R2 **Product pick.** Typeahead over producible items (FP/WIP). If a BOM already exists for the item, prefill from the most recently updated Active one and show the "Started from … / Start blank" banner. New code defaults to `<source>-V2`, editable, org-unique.
R3 **One-line entry.** `name amount[unit]` + Enter adds a line; results ranked: "in your other recipe" first, items already present penalised; unit converted into the item's base unit by the existing converter (mass and volume families only; incompatible is refused with a message, as `bom-lines` does today). Pasting several lines into the box or "Paste a list" adds all; unmatched lines become a banner with "Use…/Add as new item/Leave out" (new item opens the real `NewItemDrawer`).
R4 **No duplicates** (G1, G2): the add box penalises items already present; "Also as <SKU>" chips disappear once used; the main SKU is never offered again; the server rejects with 409 naming the exact item/SKU.
R5 **Outputs.** Main output = BOM item + chosen SKU (or base unit); extra outputs = other SKUs of the same item only (G3). Each shows content per pack and count; unit display (kg/lb/oz/g) is display-only per output.
R6 **Packaging.** Pack lines link to output SKUs automatically when there is one output; otherwise the line asks which pack(s). Quantity auto-derived from batch ÷ pack content until the user types over it.
R7 **Operations** kept as today (work centre + hours per batch), inline in the drawer; empty state says costs are materials-only.
R8 **Sanity checks (advisory):** an amount 4× above/below the same item in another BOM of the same product (one-click "use X"); weight balance only when every ingredient has a kg weight (otherwise "incomplete", naming the item); unlinked packaging.
R9 **Live cost per batch and per unit** (G9) with the breakdown bar; clearly an estimate.
R10 **Atomic save** (G4) with optimistic concurrency; errors shown beside the Save button (`DrawerFooter` `err`).
R11 **Permissions/gating** unchanged: admins write, any role with manufacturing access reads. Audit events (G16).
R12 Old per-line drawers are removed from `bom-register.tsx`; the file is split (target under 400 lines per file) into register, editor and line components. Old API routes stay (MCP and scripts use them).

Acceptance (Phase 1): creating the 10-line bar recipe from an existing BOM takes 5 clicks or fewer and one save; creating from scratch by typing 10 lines takes 10 Enters and one save; a duplicate output SKU cannot be saved by the UI, by `/boms/full`, or by the legacy `/bom-lines` route (the index returns a friendly 409).

### Phase 2: Substitutes, SKU limits, weight and allergens

R13 **Ordered substitutes per ingredient** (`bom_line_substitutes`: bom_line_id, item_id, qty, follows_primary, sort_order). Rules in G17. "Same weight as primary" keeps qty in sync using item weights (needs G6), or the same number when units are equal.
R14 **MO behaviour** (the real work): the `mo_materials` snapshot gains the substitute list (new `mo_material_substitutes`, copied at MO creation like everything else). Allocation suggestion offers the primary's lots first; if stock cannot cover the whole requirement, it proposes the next substitute in order (never mixes silently; the user confirms). Allocation/consumption record the item actually used; completion consumes lots of that item at their own cost; the MO detail and genealogy show "Honey replaced by Agave syrup". Editing the substitute list after MO creation does not affect an existing MO.
R15 **Allowed SKUs per line** (`bom_line_allowed_skus`: bom_line_id, supplier_sku_id; same for substitutes). Empty = any. Enforced in allocation (lots whose `supplier_sku_id` is outside the set are not offered and are refused if picked); G5 is a prerequisite. The control is hidden for items with `sourcing_policy = 'open'` (they have no supplier SKUs).
R16 Weight balance becomes complete once items carry weights (G6); allergen "adds" pill on substitutes (G7).

### Phase 3: Import and library

R17 **Import** (paste, then file, photo, catalogue): parsing and matching through the PAX model gateway under the user's own model key and the org's consent rules; every line shows what was read and its confidence; nothing is saved without a click; the import lands in the same drawer as a draft. Spreadsheet-only import (column mapping, no AI) can ship earlier.
R18 **Library**: search, saved filters (Draft, packaging not linked, weights off), server-side paging (G11).
R19 **Swap an item in all BOMs**: preview list, per-BOM result, 30-day undo (needs a history table); never touches MO snapshots.
R20 Co-products / rework outputs (G3) as a separate PRD.

## 6. Data model changes

Phase 1 (migration `0134`, additive; hand-written, one command per chunk, `when` > 1794100000000; run `npm run db:verify` after):
- Partial unique indexes from G1/G2, **only after** a read-only scan script (`scripts/_scan_duplicate_bom_lines.ts`) reports zero duplicate rows in production, or the owner has resolved them. A failed migration breaks `vercel-build` for every deploy.

Phase 2 (migration `0135+`): `bom_line_substitutes`, `bom_line_allowed_skus`, `mo_material_substitutes`, `inventory_lots.supplier_sku_id`, a "used item" record on allocation/consumption if not derivable, `ap_items.weight_per_unit_kg`, `ap_items.allergens`.

Phase 3: `bom_change_history` (for undo), import job tables if async.

## 7. API

Phase 1: `POST /api/inventory/boms/full`, `GET/PUT /api/inventory/boms/[id]/full` (header + lines + ops, `updatedAt` token), `GET /api/inventory/boms/suggest?itemId=` (existing BOM to copy + usual packaging). A shared pure module `lib/inventory/bom-rules.ts` (client-safe, no `db` import) holds duplicate detection, sanity checks, weight balance and cost roll-up so the UI and server cannot disagree (same split as `modules.ts` / `modules-server.ts`).

## 8. Testing

- Unit (vitest, no DB): `bom-rules` (duplicate detection, unit conversion edge cases g/kg, ml/L, incompatible; typo thresholds; weight balance incl. missing weight; cost roll-up; copy-from prefill), and in Phase 2 substitute validation and the allowed-SKU filter.
- Guards in `tests/architecture.test.ts`, each proven to fail on a real violation: no private Drawer in BOM files; no hand-written currency/quantity formatter; the uniqueness index exists in the migrations.
- `npm run db:verify` after each migration; the read-only duplicate scan before the index.
- Manual: a browser walk-through of the real drawer on the dev server (the mockup is not a test).

## 9. Rollout and risk

- Phase 1 ships without a flag (UI replacement), old routes retained. Main risk: the G1/G2 index failing on existing duplicates, hence scan first.
- Phase 2 touches allocation and completion on the money path: its own PRD review, tests on `allocation.ts` / `mo-completion.ts`, and end-to-end verification on the dev branch including void.
- Update `CLAUDE.md` with a BOM Builder section as each phase lands.

## 10. Open questions (need owner decision)

1. **Versions / effectivity:** do we need BOM revisions with dates, or is "copy to V2 + archive old" enough? (The mockup assumes the latter.)
2. A NULL supplier SKU on a lot under an SKU restriction (G5): refuse (proposed) or allow with a warning?
3. Duplicate input item (G2): hard block (proposed) or allow two lines for process reasons (e.g. oil added at two stages)?
4. Should a substitute ever auto-apply at allocation, or always need confirmation (proposed: confirmation)?
5. Weight check: advisory only (proposed) or blocking above a tolerance?
6. Who may edit BOMs: keep admins only, or add a production-planner capability via Settings → Roles?
