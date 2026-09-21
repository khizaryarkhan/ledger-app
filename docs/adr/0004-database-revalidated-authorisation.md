# ADR 0004 — Re-derive authorisation from the database on every request

- **Status:** Accepted
- **Rationale:** [EVIDENCED] — the reasoning is written out in `lib/api.ts`'s header comment on `requireOrg()`.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `lib/api.ts`, `middleware.ts`, `auth.config.ts`, `lib/billing.ts`, `lib/modules-server.ts`

## Context

Sessions are JWTs with an 8-hour lifetime carrying `role` and `orgId`. A user
may belong to several organisations and switch between them with a cookie.
Serverless functions keep nothing between requests. The system is multi-tenant
with **no row-level security** in the database.

## Decision

Treat the JWT as a **hint**, never as an authority. `requireOrg()` performs, on
every protected request:

1. Re-read the `users` row — a deleted user gets 401, a non-`Active` user 403.
2. Resolve the active organisation from the `active_org_id` cookie, or from a mobile bearer token's `orgId`.
3. Require a current `user_organisations` membership for that organisation. Super admins are exempt and may act on any org via the cookie.
4. Take the role from the per-organisation membership row, not from the JWT.
5. Validate that `repId` belongs to the active organisation.

Two layers, not one: `middleware.ts` gates whole URL families at the Edge
(admin host, admin paths, rep portal, public paths), and the per-handler gate
does the real work.

Part of the same decision:

- `requireReadScope()` widens **reads** across an org group when one is selected and authorised; **writes** keep using `requireOrg()`, because a write always targets exactly one organisation.
- `ownsInOrg()` / `userInOrg()` exist because a Postgres foreign key proves a row exists, not that it belongs to the caller's tenant — the classic insecure-direct-object-reference gap.
- `requireModule()` is called inside module-gated routes, so entitlement is a real 403 rather than merely a hidden navigation link.

## Consequences

- **Immediate revocation.** Removing a membership row or deactivating a user blocks access on the *next request*, not at the next login.
- **Extra database round-trips on every request**, accepted as the price of correctness. The result is not cached.
- **Every handler must remember to call it.** Nothing mechanical enforces that across 422 route handlers; this remains the largest correctness risk in the system.
- The mobile bearer path reuses the same function, so both session types get identical enforcement — which is also why `middleware.ts` lets a bearer-carrying API request through rather than 401'ing it, since `req.auth` only ever sees the cookie.
