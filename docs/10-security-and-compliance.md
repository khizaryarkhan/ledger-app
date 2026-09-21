# Security and Compliance

- **Purpose:** How the system authenticates, authorises, isolates tenants, and protects sensitive data — and where the visible gaps are.
- **Audience:** A developer touching auth, tenancy or secrets; a reviewer assessing the system.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `middleware.ts`, `auth.config.ts`, `lib/auth.ts`, `lib/credentials.ts`, `lib/api.ts`, `lib/crypto.ts`, `lib/mfa.ts`, `lib/oauth-state.ts`, `lib/mobile-auth.ts`, `lib/rate-limit.ts`, `next.config.js`, `DEPLOY.md`

This document records what the code does. It is not a security assessment and no
penetration testing was performed.

## Authentication

**Web:** NextAuth v5 (beta), JWT session strategy, credentials provider.

- Passwords hashed with **bcrypt** (`bcryptjs`), verified in `lib/credentials.ts`.
- **Session lifetime 8 hours** (`lib/auth.ts`). Note the discrepancy: `auth.config.ts` — the Edge config used by middleware — declares **30 days**. `lib/auth.ts` is what issues the token, so 8 hours is what applies; the Edge value is a maximum age for reading, not issuing. [INFERRED] The divergence looks unintentional.
- In production the cookie is `__Secure-next-auth.session-token`: `httpOnly`, `secure`, `sameSite: lax`, domain `.primeaccountax.com` so it is shared with `admin.primeaccountax.com`.
- `auth.config.ts` declares **no providers** — credentials cannot run on the Edge runtime. Middleware only reads the JWT; login goes through `/api/auth` on Node.
- Login attempts are throttled: **10 per email per 15 minutes** (`lib/rate-limit.ts`). A throttled attempt returns null, indistinguishable from a wrong password.
- A successful sign-in writes a `user_login` row to `audit_events`.

**Multi-factor (`lib/mfa.ts`):** TOTP via `otplib`, opt-in per user. It blocks
only users who have enrolled. The secret is encrypted at rest. Recovery codes
are hashed and single-use — `consumeRecoveryCode` returns the remaining set,
which is written back.

**Mobile (`lib/mobile-auth.ts`)** — out of scope for the rest of this
documentation set, but it shares the web trust model and is therefore in scope
here. Stateless JWTs signed with the *same* `AUTH_SECRET`, in three types:
`mobile_preauth` (10 minutes, user id only, issued after password and MFA but
before an org is chosen), `mobile_access` (1 hour), `mobile_refresh` (30 days).
Every claim is re-validated against the database by `requireOrg()` on every
request, exactly as for a cookie session. **There is no server-side revocation
list** — the same trust model as the existing JWT sessions. Short access-token
lifetime is the mitigation.

## Authorisation

Two layers, and both are needed.

### Layer 1 — `middleware.ts` (Edge, every request)

Gates whole URL families before any handler runs:

- Unauthenticated: API paths get 401, pages redirect to `/login`.
- `/admin/*` and `/api/admin/*`: `platform_admin` or `super_admin` only; others get 403 or a redirect.
- `admin.primeaccountax.com`: unauthenticated users get a dedicated admin login; non-admins are bounced back to it.
- `rep` users may reach only `/rep-portal` and `/api/*`; non-reps are kept out of `/rep-portal`.
- An API request carrying `Authorization: Bearer …` is let through for the route handler to verify, because `req.auth` only ever sees the cookie.

### Layer 2 — `lib/api.ts` (Node, per handler)

`requireOrg()` is the real gate, and it re-derives everything from the database:

1. Re-read the `users` row. Deleted user → 401. `status !== "Active"` → 403.
2. Resolve the active organisation from the `active_org_id` cookie, or from the bearer token's `orgId`.
3. **Require a current `user_organisations` membership for that organisation** — the JWT's `orgId` alone is not sufficient. Super admins are exempt and may act on any org via the cookie.
4. Resolve the role from the per-org membership row, not the JWT.
5. Validate `repId` belongs to the active organisation.

The practical consequence: removing a `user_organisations` row, or setting
`users.status = 'Inactive'`, blocks access on the **next request**, not at the
next login.

Related helpers:

- `requireReadScope()` — widens reads across an org group when `active_group_id` is set *and* `org_group_users` authorises it. **Writes deliberately keep using `requireOrg()`**, because a write always targets one organisation.
- `requirePlatformAdmin()` — re-reads the user row and checks role and status from the database, never the JWT alone.
- `requireModule(orgId, key)` — entitlement, called inside module-gated routes so a direct request gets a real 403 rather than merely a hidden nav link.
- `canPostInventoryTxn(role)` — floor staff (`company_user`) may post goods receipts, shipments and production builds, because those are physical-stock facts recorded by warehouse staff. Turning a receipt into a bill, a shipment into an invoice, voiding a posted document, and all master data remain admin-only. `rep` and `platform_admin` are excluded — they are not org operators.

### Roles

| Role | Scope |
|---|---|
| `super_admin` | Everything, any organisation |
| `platform_admin` | Platform back office; not an org operator |
| `company_admin` | Full access within their organisations |
| `company_user` | Operational access; may post floor inventory transactions |
| `rep` | Confined to `/rep-portal`, scoped to their own customers |
| `ho_manager` / `ho_finance` | Group-level **read** across an org group (`org_group_users`) |

## Multi-tenant isolation

Every tenant table carries `org_id`, usually with `ON DELETE CASCADE` to
`organisations`. **There is no row-level security in the database** — the
application is the sole enforcement point, so the correctness of `requireOrg()`
and of each handler's filtering is the tenancy boundary.

**Insecure direct object references are handled explicitly.** A Postgres foreign
key proves a row exists, not that it belongs to the caller's organisation. Any
id accepted from a request body (`customerId`, `projectId`, `repId`,
`assigneeId`) must pass `ownsInOrg(table, id, orgId)` — or `userInOrg(userId,
orgId)` for a `users` reference, since `users` rows are not org-scoped.
Null or undefined is treated as "not provided" and allowed.

## Token-authenticated public surfaces

Three no-login portals. Their authorisation *is* the token.

| Portal | Token | Lifetime | Additional controls |
|---|---|---|---|
| Customer response | `customer_portal_tokens.token` — 32 random bytes, base64url (~43 chars), unique | 30 days | **Single use** — submitting marks it `Completed` and the link dies; an expired or spent token returns **410**. Submissions rate-limited to 10 per token per hour. Only invoice ids inside the token's own snapshot are accepted. |
| Owner escalation | `owner_portal_tokens` | 30 days | **Ownership re-checked live on every request**, not just at issue |
| Bill approver | `ap_approval_tokens` | per token | Scoped to the specific approval |

`lib/portal.ts`'s `isPublicHost()` refuses to build a customer link on a
`*.vercel.app` host, because those sit behind Vercel Deployment Protection and a
debtor opening one is redirected to Vercel's login page. This reached customers
once and is now guarded by `tests/portal-url.test.ts`.

## Sensitive data

| Data | Handling |
|---|---|
| **Passwords** | bcrypt hashes in `users.password_hash`. Never logged. |
| **MFA secrets and recovery codes** | Secret encrypted (`lib/crypto.ts`); recovery codes hashed. |
| **OAuth tokens** (QuickBooks, Xero, Gmail, Microsoft, Google Sheets) | Encrypted at rest via `encryptSecret()` before insert. |
| **Mailbox passwords** (`org_smtp_settings`, `admin_email_accounts`) | Encrypted at rest. |
| **Card data** | **Never touches the application.** Stripe Checkout and the Stripe customer portal handle it; the app stores only brand and last four digits, which Stripe returns. This keeps the app out of PCI scope. |
| **Customer and invoice data** | Plaintext in Postgres; Neon provides encryption at rest and TLS in transit. |
| **Debtor contact details** | Plaintext; used for chasing. |

**`lib/crypto.ts`** — AES-256-GCM with a random 12-byte IV per value and an auth
tag, key derived as `sha256(ENCRYPTION_KEY || AUTH_SECRET || NEXTAUTH_SECRET)`.
Stored values are prefixed `enc:v1:`. Two deliberate behaviours to understand:

- **Decrypt passes through any value without the prefix**, so pre-existing plaintext keeps working and rows get encrypted naturally as they are next written. There is no migration requirement — and equally, no guarantee that every row is encrypted today.
- **With none of the three secrets set, values are stored as plaintext** with a single `console.warn`. There is no hard failure.

A corrupt or forged ciphertext returns `null` rather than the raw bytes.

## Secrets management

Secrets live in environment variables, set per environment in the Vercel project
settings. `.env.local`, `.env.production` and `.env.production.vercel` exist in
the working tree; `.gitignore` should be checked before adding any new one.
There is no vault, no rotation process and no key versioning beyond the
`enc:v1:` prefix.

**`ENCRYPTION_KEY` deserves its own dedicated value.** Deriving it from
`AUTH_SECRET` means rotating the session secret also renders every stored secret
undecryptable.

## Other controls

| Control | Detail |
|---|---|
| **Security headers** | HSTS `max-age=63072000; includeSubDomains; preload`; `X-Frame-Options: DENY`; `X-Content-Type-Options: nosniff`; `Referrer-Policy: strict-origin-when-cross-origin`; `Permissions-Policy` disabling camera, microphone, geolocation and payment. Applied to every route in `next.config.js`. |
| **Server Action CSRF** | `serverActions.allowedOrigins` restricted to the Prime Accountax hosts, `*.primeaccountax.com` and `localhost:3000`. |
| **OAuth state forgery** | `lib/oauth-state.ts` signs `orgId:userId:exp` with HMAC-SHA256 keyed on `AUTH_SECRET`, 10-minute TTL, verified with `timingSafeEqual`. **Fail-closed** — an unset secret or a bad signature yields null and the callback rejects. Previously `state` was a plain `orgId:userId` string, so a connection could be bound to an arbitrary organisation. |
| **Webhook authenticity** | QuickBooks and Xero: HMAC-SHA256 over the raw body with `timingSafeEqual`, verified **before** a 200 is returned. Stripe: `constructEvent`, plus idempotency through `stripe_webhook_events`. |
| **Rate limiting** | `lib/rate-limit.ts` — atomic fixed-window counter in Postgres. Applied to login (10 / 15 min per email) and portal submission (10 / hour per token). **Fail-open by design**: a database problem allows the request rather than locking users out. |
| **Audit trail** | `audit_events` (append-only) records logins, deactivations, role changes, password resets, integration connect/disconnect, data exports, stage changes, approvals and procurement actions. `billing_audit_logs` covers billing. `logEvent` is always wrapped so logging cannot break the primary action. |
| **Soft delete** | Invoices are hidden, not destroyed, so a mis-firing deletion detector cannot lose data. |
| **Ledger immutability** | Entries are never edited or deleted; corrections are reversals with bidirectional pointers. Stricter than QuickBooks' own model. |
| **Demo-data endpoint** | `/api/seed` refuses to run when `NODE_ENV=production`, in addition to requiring an admin role. |
| **Retired diagnostic** | `/api/debug-auth` was removed for leaking environment and user information; it now returns 404. |

## Visible gaps

Recorded as observations, not changes. Ranked roughly by exposure.

1. **No Content-Security-Policy header.** The header set is otherwise thorough, which makes the omission conspicuous.
2. **`ENCRYPTION_KEY` silently falls back to plaintext.** No secret at all means secrets are stored in the clear with a single warning. A deployment could run this way indefinitely without anyone noticing.
3. **Encryption is opportunistic, not complete.** Legacy plaintext rows are read as-is and are only encrypted when next written. Nothing reports how many remain.
4. **Webhook verification is skipped in development.** With `QBO_WEBHOOK_VERIFIER_TOKEN` unset, `/api/webhooks/qbo` accepts unverified POSTs outside production. Production correctly returns 503 rather than processing them, so this is a local-only exposure — but it means the verified path is the one least exercised while developing.
5. **No row-level security.** One missed `org_id` filter in one of 422 handlers is a cross-tenant leak. The controls above are good but are entirely application-side.
6. **No token revocation.** Neither web sessions nor mobile refresh tokens can be invalidated server-side; the mitigations are the 8-hour session and per-request database re-validation.
7. **Rate limiting is narrow and fails open.** Only two paths are covered. Registration, portal reads, PDF downloads and the API generally are unthrottled at the application layer.
8. **Session lifetime is declared twice and differently** (8 hours versus 30 days).
9. **Type checking is disabled at build time.** `ignoreBuildErrors: true` means a type error reaches production if CI is bypassed or a deploy is triggered outside the normal path. There is no lint step at all.
10. **Several `.env*` files sit in the working tree** (`.env.local`, `.env.local.db`, `.env.production`, `.env.production.vercel`). `.gitignore` covers `.env*` and only `.env.example` is tracked, so this is a workstation-hygiene concern rather than a repository one.
11. **`/api/debug-auth` is still listed as a public path** in middleware even though the handler is now a 404 stub — harmless, but stale.
12. **No dependency vulnerability scanning** in CI (no `npm audit`, no Dependabot configuration in `.github/`).

## Compliance posture

- **PCI:** out of scope by design — card data never reaches the application.
- **GDPR / data protection:** the app stores personal data (names, emails, phone numbers of customer contacts). There is no data-subject export or erasure mechanism, no documented retention policy, and no automatic purge job. `/privacy` and `/terms` pages exist. [UNVERIFIED] Whether a data-processing agreement or retention policy exists outside the repository.
- **Financial record-keeping:** the immutable, reversal-only ledger and the append-only audit log are the relevant controls, and both are well built.

## Sources

`middleware.ts`; `auth.config.ts`; `lib/auth.ts`; `lib/credentials.ts`;
`lib/mfa.ts`; `lib/api.ts`; `lib/crypto.ts`; `lib/oauth-state.ts`;
`lib/mobile-auth.ts`; `lib/rate-limit.ts`; `lib/audit.ts`; `lib/portal.ts`;
`lib/billing.ts`; `next.config.js`; `app/api/webhooks/*`; `app/api/seed/route.ts`;
`app/api/debug-auth/route.ts`; `db/schema.ts`; `DEPLOY.md`; `CLAUDE.md`.
