# ADR 0003 — An immutable, reversal-only general ledger

- **Status:** Accepted
- **Rationale:** [EVIDENCED] — stated at the top of `lib/ledger.ts` and in `CLAUDE.md`'s accounting invariants.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `lib/ledger.ts`, `lib/accounting/documents.ts`, `lib/accounting/reconcile.ts`, `tests/ledger-invariants.test.ts`, `db/schema.ts`, `db/migrations/0086_gl_external_identity.sql`

## Context

The native accounting engine had to let an organisation keep its books in the
app, and had to accept QuickBooks-shaped documents without impedance.
QuickBooks' own model permits silent edits guarded by a `SyncToken`.

## Decision

`journal_entries` **is** the transaction header (`source_type` is the document
discriminator, alongside `docNumber`, `dueDate`, `reference`, `txnNo`,
`entryNumber`, `status` and `sourcePayload`) and `journal_lines` are the typed
lines carrying full dimensions. There is no separate `transactions` /
`transaction_lines` pair and none is needed.

`postJournalEntry` in `lib/ledger.ts` is the **single** GL writer. It enforces
four invariants before anything is written:

1. Debits equal credits to the cent (tolerance 0.005).
2. Each line has exactly one side, greater than zero.
3. Every account exists in the organisation and is Active.
4. Entries are never edited or deleted — corrections are posted as reversals,
   with `reversedByEntryId` and `reversesEntryId` pointing both ways.

Adopt QuickBooks' *shape*; do not adopt its wire quirks (sparse updates,
line-append-on-update, create-only balances) — those stay quarantined in the
sync and batch adapters.

Two supporting rules follow:

- **One creation path per document type, and it must post.** Payables once had a bill endpoint that inserted a lines-less header which never reached the GL — a liability visible in the UI and absent from the books. It is gone.
- **Derived state has exactly one writer.** `invoices.paid` / `paymentStatus` are a cache of the settlement graph. They once had four competing writers, one of which added to `paid` with no link, no journal entry and no cash account. `paidAt` must come from the settling document's `entryDate`, never `new Date()` — stamping "today" corrupts every historical-dated aging run.

## Consequences

- Stricter than QuickBooks. A mistake produces two entries, not one amended one — correct for an audit trail, occasionally surprising to users.
- **Mirrored provider entries are the one exception: they are replaced, not reversed**, because the provider is the book of record. Five edits in QuickBooks must not become eleven entries here. A partial unique index on `(org_id, external_source, external_id)` (migration `0086`) enforces it — without which a webhook replay is not a duplicate row but a wrong trial balance.
- The invariants are **proved, not asserted**. `lib/accounting/reconcile.ts` checks, per organisation: entries balance; A/R and A/P control accounts agree with their subledgers; nothing is posted-but-missing from its subledger; nothing is off-ledger; `invoices.paid` agrees with the links graph. Surfaced at `/admin/reconcile` and as `scripts/reconcile-foundation.ts` (exit 1 on failure). Run it after any change to posting, bridging or settlement.
