# ADR 0002 — Live without database transactions

- **Status:** Accepted (forced by [ADR 0001](0001-serverless-monolith-on-vercel-and-neon.md))
- **Rationale:** [EVIDENCED] — stated in `db/index.ts`, `lib/ledger.ts`, `lib/batch/lease.ts` and `CLAUDE.md`.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `db/index.ts`, `lib/ledger.ts`, `lib/batch/lease.ts`, `lib/rate-limit.ts`, `CLAUDE.md`

## Context

Drizzle's `neon-http` driver sends every statement as its own `fetch` call.
`db.transaction()` throws. The application nonetheless performs multi-statement
writes that must not be left half-done: posting a journal entry (header plus
lines), committing an inventory receipt (lot, movement, cache), and recording
progress through a bulk job against a third-party API.

## Decision

Do not swap to a driver that supports transactions. Instead adopt two patterns,
applied consistently:

1. **Validate fully, then write, then compensate.** All business validation
   happens before the first write, so the only failure mode inside the write
   window is infrastructure. `lib/ledger.ts` inserts the entry header, then the
   lines, and deletes the header if a line insert fails.

2. **One atomic conditional `UPDATE` where a lock would otherwise be needed.**
   `lib/batch/lease.ts`'s `claimChunk` flips a row on `(id, processedCount,
   expired lease)`; only the caller that wins proceeds. `recordItem` advances
   the cursor, appends the result, increments counters and renews the lease in a
   single statement, so a crash loses at most the in-flight item. The Postgres
   rate limiter uses the same technique via `INSERT … ON CONFLICT DO UPDATE`.

Inventory follows a third, derived rule: **plan read-only, then commit, then
recalculate the cache.**

## Consequences

- Every multi-write site carries its own correctness argument. There is no systemic guarantee — a contributor who assumes atomicity will write a bug that only appears under failure. This is the single most important thing to tell a new developer.
- Compensating deletes are logged loudly rather than silently swallowed.
- One residual gap is explicitly accepted: in Data Studio, a QuickBooks write that succeeds before `recordItem` commits can be replayed on retry, producing a duplicate whose id is never recorded, so Undo cannot find it either. The window is one database write, not a whole chunk.

## Alternatives not taken

Switching to the Neon WebSocket or TCP driver, which does support transactions,
is not discussed anywhere in the repository. It would change the connection
profile of every serverless function.
