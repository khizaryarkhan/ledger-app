# Prime Accountax — Technical Documentation

- **Purpose:** Index and reading order for the handover documentation set.
- **Audience:** A competent developer new to this codebase and to the accounts-receivable domain.
- **Last verified against:** commit `3eec3df` (2026-09-17); written 2026-09-19
- **Primary sources:** the whole repository — see each document's own source list

## The system in one paragraph

**Prime Accountax** is a multi-tenant SaaS application for accounts receivable
management and collections. An organisation connects QuickBooks Online, Xero or
Sage Intacct; the app mirrors its customers and invoices and then runs the
chasing process on top of them — scheduled branded reminder emails from the
organisation's own mailbox, a daily collections board, a no-login customer
portal where a debtor can promise a payment date or raise a dispute, and
escalation to an account owner. Around that core it also provides accounts
payable, a native double-entry general ledger, perpetual FIFO inventory and
manufacturing, and a spreadsheet-driven bulk import/export tool for QuickBooks
and Xero. It is one Next.js 14 application deployed as serverless functions on
Vercel, backed by Neon Postgres, with background work on Inngest and Vercel Cron.

## Start here

If you are new, read in this order. The first three take about an hour and are
enough to work safely.

1. **[01-system-overview.md](01-system-overview.md)** — what it does and for whom.
2. **[02-architecture.md](02-architecture.md)** — the shape of it, and the three constraints that explain most of the code.
3. **[03-codebase-guide.md](03-codebase-guide.md)** — where everything is and where to put new code.
4. Then whichever of **[04](04-data-model.md)**–**[07](07-configuration-and-environments.md)** matches your first task.
5. **[09-development-guide.md](09-development-guide.md)** when you are ready to run it.
6. **[11-risks-debt-and-open-questions.md](11-risks-debt-and-open-questions.md)** before you plan anything.

**Also read `CLAUDE.md` in the repository root.** It is the project's living
engineering log — the incident-by-incident record of why the code is the way it
is. This documentation set summarises and organises it; it does not replace it.

## The documents

| Document | What it covers |
|---|---|
| [01-system-overview.md](01-system-overview.md) | Purpose, users, domain vocabulary, scope and non-goals, tech stack, system context diagram |
| [02-architecture.md](02-architecture.md) | Architectural style, container and component diagrams, layering rules, key patterns, cross-cutting concerns, request lifecycle |
| [03-codebase-guide.md](03-codebase-guide.md) | Annotated directory map, the five entry points, conventions, where to add new code, "if you change X also check Y" |
| [04-data-model.md](04-data-model.md) | Entity groups, three ER diagrams, the two schema seams (party views, dual settlement graphs), migration approach and its traps |
| [05-key-flows.md](05-key-flows.md) | Eight workflows with sequence diagrams: sign-in, the tenancy gate, provider connect and sync, the daily chase, the customer portal, native posting, bulk write-back, subscription billing |
| [06-interfaces-and-integrations.md](06-interfaces-and-integrations.md) | The API surface, the exhaustive public-path list, webhooks, both schedulers, every external system and its failure behaviour |
| [07-configuration-and-environments.md](07-configuration-and-environments.md) | Every environment variable (names only), per-organisation settings, environment differences, manual steps outside the repo |
| [08-build-deploy-operations.md](08-build-deploy-operations.md) | Build, CI, the production smoke test, deployment topology, scheduled jobs, monitoring, runbook, failure signatures |
| [09-development-guide.md](09-development-guide.md) | Prerequisites, local setup, testing strategy, debugging, recipes for common changes |
| [10-security-and-compliance.md](10-security-and-compliance.md) | Authentication, authorisation, tenant isolation, token portals, secrets, controls, and the visible gaps |
| [11-risks-debt-and-open-questions.md](11-risks-debt-and-open-questions.md) | Structural risks, fragility, incomplete work, and 14 numbered questions for the original team |
| [glossary.md](glossary.md) | Domain and technical terms |
| [adr/](adr/README.md) | Seven architecture decision records reconstructed from the code |
| [_documentation-plan.md](_documentation-plan.md) | What was surveyed, what was skipped and why, and how coverage was prioritised |

One pre-existing document also lives here and was **not** written as part of this
set: [admin-portal-account-model-plan.md](admin-portal-account-model-plan.md), a
proposal for unifying the admin portal's account model. It is a proposal, not a
description of what exists.

## Scope of this documentation

**Included:** the web application — `app/`, `components/`, `lib/`, `db/`,
`inngest/`, `scripts/`, `tests/`, and the root configuration.

**Excluded:** the `mobile/` React Native project, at the requester's
instruction. It is a separate npm project, excluded from `tsconfig.json` and
from CI. It appears here only where the web app carries surface built for it —
the bearer-token path in `lib/api.ts` and the `app/api/mobile/*` routes —
because omitting that would misrepresent the authentication model.

This set **documents what exists**. Problems are recorded as observations in
[11-risks-debt-and-open-questions.md](11-risks-debt-and-open-questions.md); no
code, configuration or file outside `/docs` was changed.

## Conventions used

- **[UNVERIFIED]** — could not be determined from the repository; also listed as an open question.
- **[INFERRED]** — reconstructed rationale, not stated anywhere in the repository.
- Every non-trivial claim cites its source as a relative path, collected at the end of each document.
- Diagrams are Mermaid, in fenced blocks, and render on GitHub and in VS Code.

## Verification performed

- `npm test` — 17 files, 252 tests, all passing.
- `npx tsc --noEmit` — exit 0.
- `next build` was **not** run: the repository's own CI declines to, because several routes need real Stripe and Intuit keys and fail at page-data collection without them.
- `npm audit` was **not** run: it contacts the npm registry, outside the read-only-local boundary set for this exercise. Dependency currency is therefore an open question, not a finding.
- No command was run against production, and nothing was mutated.
