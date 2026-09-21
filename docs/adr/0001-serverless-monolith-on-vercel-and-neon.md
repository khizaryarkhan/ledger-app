# ADR 0001 — Serverless modular monolith on Vercel and Neon

- **Status:** Accepted (in force)
- **Rationale:** [INFERRED] — the choice is visible everywhere in the code; no document states why it was made.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `package.json`, `vercel.json`, `db/index.ts`, `next.config.js`, `middleware.ts`

## Context

A small team building a multi-tenant SaaS product covering receivables,
payables, a general ledger, inventory and bulk provider integration. The
repository shows 1,231 commits across roughly four months with a single primary
author.

## Decision

One Next.js App Router application holds the UI, the HTTP API and all domain
logic. Vercel splits it into per-route serverless functions at deploy time.
Persistence is Neon serverless Postgres over HTTP. Background work runs on
Inngest and Vercel Cron, both of which call back into the same application.
There are no internal services and no message bus.

## Consequences

**Accepted willingly**

- One deployable, one build, one log stream. A feature spanning UI, API and domain logic is one commit.
- No service-to-service authentication, no distributed tracing, no orchestration.
- `main` auto-deploys; migrations run as part of `vercel-build`.

**Accepted as costs, and visible throughout the codebase**

- **No database transactions** — see [ADR 0002](0002-no-transactions-compensating-writes.md).
- **Short function lifetimes**, so any long job must be resumable — hence `lib/batch/lease.ts`.
- **No in-process memory between requests**, so authorisation must be re-derived every time — see [ADR 0004](0004-database-revalidated-authorisation.md).
- **Two runtimes.** `middleware.ts` runs on Edge, which is why `auth.config.ts` exists as a second, Node-free auth config declaring no providers.
- **Background work is reachable only over HTTP**, which is how `/api/inngest` came to be silently 401'd behind middleware for weeks until the bypass was added.

## Alternatives not taken

No evidence of a considered alternative exists in the repository.
