# Configuration and Environments

- **Purpose:** Every configuration input — environment variables, per-organisation settings, feature gates — where it is read and what it controls. **Names and behaviour only; no values.**
- **Audience:** Anyone setting up an environment, or debugging "it works locally but not in production".
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** every `process.env.*` reference in `app/`, `lib/`, `inngest/`, `scripts/`, `db/`, `middleware.ts`, `auth.config.ts`, `next.config.js`, `sentry.*.config.ts`; `.env.example`; `db/schema.ts`

## How configuration is loaded

There is **no central configuration module**. Every value is read from
`process.env` at the point of use, usually with an inline fallback.

Precedence, in practice:

1. **Platform environment variables.** On Vercel, set per environment in the project settings. Locally, `.env.local`.
2. **Inline fallback chains in code.** For example `AUTH_SECRET || NEXTAUTH_SECRET`; `ENCRYPTION_KEY || AUTH_SECRET || NEXTAUTH_SECRET`; `SENTRY_DSN || NEXT_PUBLIC_SENTRY_DSN`.
3. **Database settings**, which override nothing but layer on top: per-organisation rows in `organisations`, `org_smtp_settings`, `org_email_settings`, and the provider token tables.

Scripts under `scripts/` load `.env.local` explicitly via `dotenv`
(`scripts/migrate.ts`). Next.js loads it automatically for the app.

**`.env.example` is badly out of date.** It lists five variables; the code reads
more than fifty. Treat the table below as the real list, and
`SETUP-GUIDE.md` / `DEPLOY.md` as the operator-facing companions.

## Environment variables

Grouped by what stops working without them.

### Required for the application to run

| Name | Read in | Purpose | Default / absence behaviour |
|---|---|---|---|
| `DATABASE_URL` | `db/index.ts`, `scripts/migrate.ts` | Neon Postgres connection string | Client construction throws at first query. Lazily resolved so the build still succeeds. |
| `AUTH_SECRET` | `lib/auth.ts`, `auth.config.ts` | NextAuth JWT signing | Falls back to `NEXTAUTH_SECRET`. Without either, sessions cannot be signed. |
| `NEXTAUTH_SECRET` | same | Legacy alias | — |
| `AUTH_URL` | NextAuth, OAuth callbacks | Canonical app URL | Used as a base-URL fallback in the QuickBooks callback |

### Strongly recommended

| Name | Read in | Purpose | Absence behaviour |
|---|---|---|---|
| `ENCRYPTION_KEY` | `lib/crypto.ts` | AES-256-GCM key material for secrets at rest | **Falls back to `AUTH_SECRET`, then `NEXTAUTH_SECRET`. With none of the three, secrets are stored as plaintext and a one-time `console.warn` is emitted.** |
| `NEXT_PUBLIC_APP_URL` | `lib/portal.ts`, `lib/system-mailer.ts` | The public base URL used in every emailed link | Falls back to the request host (only if it is a safe public host), then `VERCEL_PROJECT_PRODUCTION_URL`, then `VERCEL_URL`, then `localhost:3000`. Reaching the `VERCEL_URL` rung means links are behind Deployment Protection and will break for debtors. |
| `CRON_SECRET` | 19 routes: `/api/cron/*`, `/api/admin/sequences/process`, `/api/migrate/*` | Authenticates scheduled and one-off HTTP jobs. These paths bypass session auth in `middleware.ts`, so this is their **only** guard. | Fails closed either way, but inconsistently: some routes return 500 when the variable is unset, others simply compare against `Bearer undefined`. |

### QuickBooks Online

| Name | Read in | Purpose |
|---|---|---|
| `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET` | OAuth exchange and refresh across `lib/qbo-*` and `app/api/qbo/*` | App credentials |
| `QBO_REDIRECT_URI` | `app/api/qbo/*` | Must match the Intuit app registration exactly |
| `QBO_WEBHOOK_VERIFIER_TOKEN` | `app/api/webhooks/qbo/route.ts` | HMAC verifier. Unset **in production** makes the endpoint return 503 for every request; unset in development accepts unverified POSTs with a warning. |
| `QBO_REPORTS_MODERN` | `lib/qbo-aging-report.ts`, `/api/reports/ar-reconcile`, `/api/qbo/debug-aging` | Opts into Intuit's modernised Reports API (`testing_migration=true`) |
| `QBO_NO_TOKEN_REFRESH` | `lib/qbo-token.ts`, `scripts/qbo-gl-ingest.ts` | Safety switch: blocks token refresh so a script cannot invalidate a live customer's tokens |
| `QBO_ENV` | `lib/accounting/qbo-gl-verify.ts` | Sandbox versus production host selection |
| `QBO_SANDBOX_TOKEN`, `QBO_SANDBOX_REALM` | `scripts/qbo-sandbox-link-test.ts` | Sandbox-only test harness |

### Xero and Sage

| Name | Read in | Purpose |
|---|---|---|
| `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI` | `lib/xero-token.ts`, `app/api/xero/*` | OAuth |
| `XERO_WEBHOOK_SIGNING_KEY` | `app/api/webhooks/xero/route.ts` | Webhook HMAC |
| `SAGE_SENDER_ID`, `SAGE_SENDER_PASSWORD` | `lib/sage-sync.ts` | Sage Intacct sender credentials |

### Stripe

| Name | Read in | Purpose |
|---|---|---|
| `STRIPE_SECRET_KEY` | `lib/stripe.ts` | API client. API version is pinned in code (`2026-05-27.dahlia`). |
| `STRIPE_WEBHOOK_SECRET` | `app/api/webhooks/stripe/route.ts` | Signature verification |
| `STRIPE_PRODUCT_ID` | `lib/stripe.ts` | **Preferred.** Price is resolved from the product's `default_price`, so changing price in Stripe needs no redeploy. |
| `STRIPE_PRICE_ID` | `lib/stripe.ts` | Legacy fixed price, used only if the product route yields nothing |

### Email

| Name | Read in | Purpose |
|---|---|---|
| `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI` | `lib/gmail.ts`, `app/api/gmail/*` | Org mailbox OAuth |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` | `lib/microsoft.ts`, `app/api/microsoft/*` | Org mailbox OAuth |
| `SYSTEM_SMTP_HOST`, `SYSTEM_SMTP_PORT`, `SYSTEM_SMTP_USER`, `SYSTEM_SMTP_PASS` | `lib/system-mailer.ts` | Transactional/system mail (password resets, notifications) |
| `SYSTEM_FROM_EMAIL`, `SYSTEM_FROM_NAME` | `lib/system-mailer.ts` | System sender identity |

Per-organisation SMTP lives in the `org_smtp_settings` table, not in the
environment. **Real one-to-one collections email always sends from the
organisation's own connected mailbox**; system SMTP is only for transactional
mail.

### Other services

| Name | Read in | Purpose |
|---|---|---|
| `OPENAI_API_KEY` | `/api/chat`, `/api/public/chat`, `/api/admin/accounts/[id]/next-action` | Assistant features |
| `GOOGLE_SHEETS_REDIRECT_URI` | `app/api/google-sheets/*` | Sheets OAuth |
| `BLOB_READ_WRITE_TOKEN` | `app/api/admin/guide/upload` | Vercel Blob writes |
| `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | `sentry.*.config.ts`, `next.config.js` | **Presence also decides whether the build is wrapped with Sentry's plugin at all.** |
| `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` | `next.config.js` | Source-map upload; skipped without the token, build still succeeds |

### Platform-provided

| Name | Set by | Used for |
|---|---|---|
| `VERCEL_ENV` | Vercel | `production` enables the `.primeaccountax.com` cookie domain and the `*.vercel.app` placeholder page |
| `VERCEL_URL` | Vercel | Per-deployment host — last-resort link base only |
| `VERCEL_PROJECT_PRODUCTION_URL` | Vercel | Stable project domain, preferred over `VERCEL_URL` |
| `NEXT_PUBLIC_VERCEL_ENV` | Vercel | Client-side environment awareness |
| `NODE_ENV`, `NEXT_RUNTIME` | Next.js | Runtime branching |

### Tooling and scripts only

| Name | Read in |
|---|---|
| `SMOKE_BASE_URL`, `SMOKE_EMAIL`, `SMOKE_PASSWORD` | `scripts/smoke.ts` and `.github/workflows/smoke.yml`. Without the credentials only the anonymous checks run. |
| `DEMO_PASSWORD` | `scripts/seed-mobile-demo.ts` |
| `APP_URL` | `app/api/cron/qbo-sync/org/route.ts` |

### Documented but unused

| Name | Note |
|---|---|
| `DISABLE_PUBLIC_SIGNUP` | Present in `.env.example` with a described behaviour; **no reference exists anywhere in the codebase.** Setting it does nothing. |

## Per-organisation settings (database, not environment)

These are the real "feature flags" of this system. They live on the
`organisations` row and reach the client through `GET /api/org/settings` into
`components/data-provider.tsx`.

| Column | Type | Default | Controls |
|---|---|---|---|
| `enabled_modules` | jsonb array | `["receivables","payables","studio","accounting"]` | Which workspaces exist. `manufacturing` and `resources` are opt-in, assigned by a platform admin on `/admin/customers/[orgId]`. Enforced in routes by `requireModule()`. |
| `reporting_enabled` | boolean | false | The provider-native Reporting workspace. A separate, older, one-off toggle — deliberately **not** folded into the module registry. Do not extend it; new gated features use modules. |
| `pay_links_enabled` | boolean | **true** | Opt-*out* of QuickBooks "Pay online" links everywhere |
| `multicurrency_enabled` | boolean | false | Foreign-currency entry on documents |
| `currency` | varchar | `EUR` | Home / reporting currency |
| `fiscal_year_start_month` | integer | 1 | Balance sheet and P&L period boundaries |
| `book_close_date` | varchar | null | Lock date — entries on or before are locked |
| `date_format` | varchar | `DD MMM YYYY` | Display format |
| `classification_level` | varchar | `customer` | Whether chasing is grouped by customer or by project |
| `stages` | jsonb | null | Custom collection stages (four keys are locked) |
| `disabled_rules` | jsonb | `[]` | Paused automation rules |
| `show_payment_history` | boolean | false | Payment history tab on the customer portal |
| `subdomain` | varchar, unique | null | White-label branded subdomain for pre-auth pages |
| `logo_url`, `display_name` | | null | Branding in the app shell and portals |
| `group_id` | uuid | null | Membership of a head-office org group |

Subscription state in `subscriptions` gates access independently:
`requireActiveSubscription(orgId)` returns `full`, `readonly` or `blocked`. **No
subscription row at all means `full`** — which is how internal and
manually-provisioned organisations work.

## Environments

| Environment | Database | Notes |
|---|---|---|
| **Local development** | Your own Neon database or branch via `.env.local` | **Local `DATABASE_URL` is not production, and may be many migrations behind it.** A stale local copy holding real-looking data once produced a whole set of credible, wrong reconciliation findings. Verify with `select max(created_at) from drizzle.__drizzle_migrations` against `meta/_journal.json`, or use `/admin/reconcile`, which always runs server-side against production. |
| **Vercel preview** | Whatever the preview environment points at | Sits behind Vercel Deployment Protection, which is why `lib/portal.ts` refuses to build customer links on a `*.vercel.app` host |
| **Production** | Neon production | `VERCEL_ENV=production` enables the shared-subdomain cookie and serves the placeholder page on `*.vercel.app`. Migrations run as part of `vercel-build`. |

Behavioural differences driven purely by `VERCEL_ENV === "production"`:

- Session cookie becomes `__Secure-next-auth.session-token`, `secure: true`, domain `.primeaccountax.com` (so it is shared with `admin.primeaccountax.com`).
- `*.vercel.app` hosts serve a "coming soon" placeholder for non-API paths.

## Manual steps that are not in this repository

Changing code is not sufficient for these:

1. **Wildcard domain** `*.primeaccountax.com` attached to the Vercel project, plus matching wildcard DNS. Without it, no org's branded subdomain resolves, however the database is configured.
2. **Webhook endpoints registered** in the Intuit and Xero developer portals, with their verifier tokens copied into the environment.
3. **OAuth redirect URIs registered** with Intuit, Xero, Google and Microsoft, matching the `*_REDIRECT_URI` values exactly.
4. **Google site verification** file present in `public/` (guarded by a test) and the OAuth consent screen approved — this is what gates Gmail sending.
5. **Stripe product and price** created, and the webhook endpoint registered with its signing secret.

## Sources

Exhaustive grep of `process.env.*` across `app/`, `lib/`, `inngest/`,
`scripts/`, `db/`, `middleware.ts`, `auth.config.ts`, `next.config.js`,
`sentry.*.config.ts`; `.env.example`; `db/schema.ts` (`organisations`);
`lib/crypto.ts`; `lib/portal.ts`; `lib/stripe.ts`; `lib/billing.ts`;
`lib/system-mailer.ts`; `DEPLOY.md`; `SETUP-GUIDE.md`; `CLAUDE.md`.
