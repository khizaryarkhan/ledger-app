# Admin Portal — Account-Centric Unification Plan

> Status: **proposal for review** (system architect + product). No code changes implied by this doc.
> Author context: written against the *actual* current codebase, not an idealized one.

## 1. The problem (today, factually)

A single real-world company is represented by up to **four disconnected records**, each owned by a different page:

| Concept | Table | Created by | Page that "owns" it |
|---|---|---|---|
| Lead | `landing_page_requests` | landing page / manual | Leads |
| Deal | `opportunities` | won-lead convert | Opportunities |
| Customer (tenant/billing) | `organisations` | invoice creation (bridge) | Customers |
| Stripe customer | (Stripe) | create-invoice | — |

These are linked by ad-hoc foreign keys (`opportunities.lead_id`, `opportunities.org_id`) but there is **no single entity that *is* the company**. Result:
- The same company looks like a Lead on one page, a Customer on another, a Deal on a third — "every page tells a new story."
- No reliable answer to "show me everything about Acme Ltd."
- Duplication risk grows with volume → does not scale to 1000 customers/month.

## 2. Target: the **Account** is the spine

One canonical record per company. Everything else hangs off it.

```
crm_account (the company — one row per real company, whole lifecycle)
 ├── contacts            (people)
 ├── leads               (inbound origin / qualification facet)
 ├── opportunities       (deals)
 ├── quotes              (proposals)              [future]
 ├── invoices            (billing mirror of Stripe)
 ├── subscription        (1:1, when a customer)
 ├── organisation        (1:1 tenant shell, when provisioned)
 ├── activities          (emails, calls, notes, status changes)
 └── tasks
```

Rules:
- **One fact, one owner.** Stripe = money truth; QBO/Xero = customer-AR truth; the Account = the *relationship* truth. Pages are **views**, never second copies.
- `organisation` (the tenant the customer logs into) becomes a **1:1 facet** of the account (`account.organisation_id`), created at provisioning — not a competing "company."
- `stripe_customer_id` lives on the account (1:1).

## 3. Current → target mapping

| Current | Becomes |
|---|---|
| `landing_page_requests` | `crm_leads` (origin/qualification) **attached to** a `crm_accounts` row |
| `lead_contacts` | `crm_contacts` (FK `account_id`) |
| `opportunities` | `crm_opportunities` (FK `account_id`, keep `lead_id`) |
| `organisations` | unchanged table, but referenced via `account.organisation_id` (the tenant facet) |
| `subscriptions` | unchanged, gains `account_id` |
| Stripe customer | `account.stripe_customer_id` |
| `lead_notes` | `crm_activities` (typed: note/email/call/stage_change/…) |
| `lead_tasks` | `crm_tasks` (FK `account_id`) |
| `catalog_items` | `billing_items` / price book (already close) |

## 4. Guiding principles (how we do it safely)

1. **Strangler, never big-bang.** The live app + real customers stay working throughout. No table renames in place.
2. **Read-path before write-path.** Unify how data is *displayed* first (Account 360), then unify how it's *written*.
3. **Migrations only.** Every schema step is a Drizzle migration through the pipeline we just built (tested on a Neon branch first). No manual SQL.
4. **Backfill is idempotent + reversible.** Backfill scripts can run repeatedly; each schema change is additive (new nullable columns/tables) until the final tightening.
5. **Identity/dedup is solved before merging** (see §6) — the single biggest risk.

## 5. Phased sequence

### Phase 0 — Account 360 (read-only view, **zero schema change**)
Build one page that, given any company, assembles its Lead + Org + Deals + Invoices + Subscription + Activity from the existing tables, joined by the links we already have. Route every entry point (Leads list, Customers, a deal, an invoice) to this one page.
- **Outcome:** "every page tells a new story" is fixed *immediately*, with no migration risk.
- **Effort:** small–medium. **Risk:** none (read-only).

### Phase 1 — Introduce `crm_accounts` (additive)
- Migration: create `crm_accounts`; add nullable `account_id` to `opportunities`, `subscriptions`, `lead_contacts`, `lead_notes`, `lead_tasks`, and `organisations`.
- Backfill: one row per distinct company (dedup key = normalized domain/email → see §6), linking existing leads/orgs/deals to it.
- **Outcome:** the spine exists; nothing reads it yet. **Risk:** low (additive + backfill on a branch first).

### Phase 2 — Dual-write
- All *new* creates (lead capture, convert, invoice/provision) populate `account_id`.
- Services start resolving "the company" via `crm_accounts`.
- **Risk:** low–medium (new writes only; old data already backfilled).

### Phase 3 — Page-by-page cutover (read from account)
Move each page onto the account model, one at a time, verifying each:
`Overview → Leads → Opportunities → Customers → Subscriptions → Invoices → Mail links`.
- **Risk:** contained per page; each is independently shippable + revertible.

### Phase 4 — Tighten
- Make `account_id` NOT NULL where appropriate; deprecate redundant duplicated fields; add the richer lifecycle/state enums.
- **Risk:** low by now (everything already populated + read via account).

### Phase 5 — Cleanup
- Remove dead code paths, old direct-table reads, redundant columns.

## 6. The identity / dedup problem (must-solve, highest risk)

Today a company can exist as a Lead **and** an Org with no link. Before/while creating `crm_accounts` we need a **match key** to avoid duplicate accounts:
- Primary: **email domain** (e.g. `@gelatogo.net`) + normalized company name.
- Secondary: billing email exact match; existing `opportunities.org_id`/`lead_id` links.
- **Merge strategy:** deterministic backfill that prefers an existing Org link; manual "merge accounts" tool for ambiguous cases.
- **Decision needed from architect:** the canonical match key + tie-break rules.

## 7. Risks & de-risking

| Risk | Mitigation |
|---|---|
| Breaking live app / customers | Strangler; additive migrations; each phase shippable + revertible |
| Bad data migration | Test every migration + backfill on a **Neon branch** first (pipeline ready) |
| Duplicate accounts | §6 dedup key agreed before Phase 1 backfill |
| Long refactor stalling delivery | Phase 0 delivers the visible win immediately; later phases are background |
| Provisioning/billing regressions | Keep the idempotent `activateOrgOnPayment` + webhook-event-log already built |

## 8. Acceptance criteria

1. One company = **one** `crm_accounts` row; no duplicates for a given domain.
2. Every admin page (lead, deal, customer, invoice, mail) opens the **same** Account 360.
3. Lead → Account → Contact → Opportunity → Quote → Invoice/Subscription → Org → Activation is one continuous, auditable chain on one record.
4. Stripe IDs and org link are stored **on the account**.
5. No manual SQL — all schema via migrations (branch-tested).
6. Existing customers keep working throughout; each phase is independently deployable and revertible.

## 9. Recommendation

Start with **Phase 0 (Account 360 read view)** — it removes the day-to-day confusion immediately with zero database risk, and it *de-risks* the later phases by forcing us to define exactly what "everything about a company" means before we touch the schema.

## 10. Open decisions for the architect

1. The **dedup/match key** for creating `crm_accounts` (§6).
2. Whether `crm_leads` stays a separate facet or merges into `crm_accounts.lifecycle_stage` (HubSpot-style) — affects multi-lead-per-company handling.
3. Whether to mirror Stripe invoices locally (`billing_invoices`) or always read live from Stripe (latency vs. offline/reporting).
4. Granular admin roles (Sales/Billing/Support) — in scope now or later?
5. Target order of Phase 3 page cutovers by business priority.
