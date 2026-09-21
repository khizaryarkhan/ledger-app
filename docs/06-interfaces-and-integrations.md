# Interfaces and Integrations

- **Purpose:** Every way something outside the application talks to it, and every external system it talks to.
- **Audience:** A developer adding an endpoint, debugging an integration, or assessing blast radius.
- **Last verified against:** commit `3eec3df` (2026-09-17)
- **Primary sources:** `app/api/**`, `middleware.ts`, `lib/*-sync.ts`, `lib/*-token.ts`, `app/api/webhooks/`, `vercel.json`, `next.config.js`

## 1. The HTTP API

422 route handlers under `app/api/`. They are internal — consumed by this
application's own pages and by the mobile client — not a published API. There is
no OpenAPI document and no versioning scheme.

### Shape

- One `route.ts` per path; HTTP verbs are named exports (`GET`, `POST`, `PATCH`, `DELETE`).
- Request and response bodies are JSON.
- Success: `ok(data)`; failure: `bad(message, status)` — both from `lib/api.ts`, producing `{ "error": "..." }` with the status.
- Standard statuses in use: 400 invalid input, 401 unauthenticated, 403 wrong role / no org / module not enabled, 404 not found, 410 expired token, 429 rate limited, 500 unhandled.

### Route families

| Prefix | Handlers | Purpose | Auth |
|---|---|---|---|
| `/api/admin/**` | 97 | Platform back office: leads, CRM accounts, opportunities, campaigns, org provisioning, module assignment, Stripe billing, reconciliation, guide content, admin mailbox | `requirePlatformAdmin()`; middleware also gates `platform_admin` / `super_admin` |
| `/api/payables/**` | 36 | Suppliers, bills, purchase orders, approvals, payment runs, workflow rules, supplier queries | `requireOrg()` |
| `/api/inventory/**` | 33 | Items, SKUs, lots, BOMs, receiving, shipping, production, job work, alerts, procurement and sales reports | `requireOrg()` + `requireModule(orgId, "manufacturing")` — except `items`, `skus`, `supplier-skus`, which are master data every org uses |
| `/api/batch/**` | 30 | Data Studio: upload, chunk, commit, delete, bulk-edit, download, templates, refs, mappings, scheduled imports, job history | `requireOrg()` |
| `/api/invoices/**` | 14 | Invoice detail, PDF, pay links, attachments, bulk pay-links | `requireOrg()` |
| `/api/qbo/**`, `/api/xero/**`, `/api/sage/**` | 23 | Connect, callback, disconnect, manual sync, history, verification and diagnostics | `requireOrg()`; the callbacks are public and verify a signed `state` |
| `/api/mobile/**` | 12 | Mobile auth and mobile-shaped reads (**out of scope for this document set**) | Bearer token |
| `/api/reporting/**`, `/api/reports/**` | 15 | Provider-native reports (Reporting module) and in-app AR reports | `requireOrg()`; reporting gated on `organisations.reporting_enabled` |
| `/api/accounting/**`, `/api/ledger/**`, `/api/transactions/**`, `/api/trade-documents/**`, `/api/period-close`, `/api/numbering` | ~20 | Native GL: posting, reversal, trial balance, opening balances, document numbering | `requireOrg()` |
| `/api/org/**`, `/api/settings`, `/api/me`, `/api/user` | 13 | Org settings (feeds `components/data-provider.tsx`), profile, MFA | `requireOrg()` / `requireAuth()` |
| `/api/billing/**` | 9 | Self-service checkout, portal, plans, invoices, reactivate | `requireOrg()` |
| `/api/cron/**` | 10 | Scheduled HTTP jobs | `CRON_SECRET`; bypasses session auth in middleware |
| `/api/webhooks/**` | 3 | QuickBooks, Xero, Stripe | Per-provider signature |
| `/api/portal/**`, `/api/owner-portal/**`, `/api/approver/**` | 11 | Token-authenticated public portals | The token itself |
| `/api/public/**`, `/api/register/**`, `/api/interest`, `/api/health`, `/api/countries` | ~8 | Unauthenticated: registration, marketing chat, uptime probe | None (rate-limited where it matters) |
| `/api/inngest` | 1 | Serves 15 Inngest functions | HMAC via `INNGEST_SIGNING_KEY` |
| `/api/migrate/*` | 5 | One-off SQL patches, kept as endpoints | `Bearer <CRON_SECRET>` |
| `/api/seed`, `/api/backfill-*` | 3 | Demo data and one-off data corrections | `requireOrg()`; `/api/seed` additionally refuses to run when `NODE_ENV=production` |
| `/api/debug-auth` | 1 | **Retired** — now a 404 stub. It previously leaked environment and user information. Still listed as public in `middleware.ts`. | none |

### Public endpoints, exhaustively

From the `isPublic` set in `middleware.ts` — this list *is* the contract:

`/` · `/blog`, `/blog/*`, `/alternatives`, `*-alternative`, and five solution
landing pages · `/login` · `/admin-login` · `/forgot-password` ·
`/reset-password` · `/register`, `/register/success` · `/privacy` · `/terms` ·
`/api/register/*` · `/api/auth/*` · `/api/mobile/auth/*` · `/api/public/*` ·
`/api/qbo/callback` · `/api/xero/callback` · `/api/gmail/callback` ·
`/api/microsoft/callback` · `/api/debug-auth` · `/api/interest` · `/api/health` ·
all `/portal/*`, `/owner-portal/*`, `/approver/*` and their API equivalents.

Separately bypassed as "cron": `/api/cron/*`, `/api/webhooks/*`,
`/api/admin/sequences/process`, `/api/inngest`.

Also excluded from middleware entirely by the `matcher`: `_next/static`,
`_next/image`, `favicon.ico`, `sw.js`, `service-worker.js`, `robots.txt`,
`sitemap.xml`, `opengraph-image`, and `google<hex>.html`. **The Google
verification exclusion is load-bearing**: without it Google's anonymous fetch is
redirected to `/login`, verification fails with nothing in the logs, and that
blocks the OAuth consent-screen review that Gmail sending depends on.
`tests/architecture.test.ts` guards it.

## 2. Inbound webhooks

| Source | Path | Verification | Behaviour |
|---|---|---|---|
| **QuickBooks Online** | `POST /api/webhooks/qbo` | HMAC-SHA256 over the raw body against `QBO_WEBHOOK_VERIFIER_TOKEN`, compared with `timingSafeEqual`, **before** any 200 is returned | Returns 200 immediately, processes via `waitUntil`. QuickBooks drops a webhook after 45 s. `maxDuration = 60`. Events recorded in `qbo_webhook_events`; entity split lives in `lib/qbo-webhook-entities.ts` so it is unit-testable. |
| **Xero** | `POST /api/webhooks/xero` | HMAC against `XERO_WEBHOOK_SIGNING_KEY` | Xero requires 200 within **5 seconds**; signature is verified synchronously, processing runs in `waitUntil`. Handles the "Intent To Receive" handshake (empty body) explicitly. Only INVOICE / CREDITNOTE / CONTACT / PAYMENT categories are processed. Recorded in `xero_webhook_events`. |
| **Stripe** | `POST /api/webhooks/stripe` | `stripe.webhooks.constructEvent` against `STRIPE_WEBHOOK_SECRET` | Idempotent: `stripe_webhook_events` is checked first and an already-processed event returns 200 immediately. Handles registration completion, subscription sync, `invoice.paid` (including the two-step subscription creation), and org activation. |

A `/api/cron/replay-webhooks` job (04:00 daily) exists to re-process events that
failed, and `/api/qbo/webhook-health` plus `/api/xero/webhook-health` report
delivery health.

## 3. Scheduled work

Two independent schedulers. Knowing which one owns a job is the difference
between a five-minute and a two-hour debugging session.

### Vercel Cron (HTTP, `vercel.json`)

| Schedule (UTC) | Path |
|---|---|
| `0 6 * * *` | `/api/cron/forecast-snapshot` |
| `30 7 * * *` | `/api/cron/sync-inbound` |
| `0 8 * * *` | `/api/admin/sequences/process` |
| `0 2 * * *` | `/api/cron/qbo-sync` |
| `0 3 * * *` | `/api/cron/xero-sync` |
| `0 4 * * *` | `/api/cron/replay-webhooks` |
| `0 5 * * *` | `/api/cron/sage-sync` |
| `0 7 * * *` | `/api/cron/sync-inbound-ar` |

Authenticated by `CRON_SECRET`. `/api/cron` (the legacy chase and the promise
sweeps) and `/api/cron/trigger` (manual, supports `dryRun`) are not on this
schedule but are reachable the same way.

### Inngest (15 functions, served at `/api/inngest`)

| Function | Trigger |
|---|---|
| `chaseScheduler` | cron `0 8 * * *` — fans out one event per org |
| `runOrgChase` | event `invoice/chase-org`, 2 retries |
| `brokenPromiseSweep` | cron `0 8 * * *` |
| `supplyChainWatchdog` | cron `0 7 * * *` |
| `ledgerHealthCheck` | cron `0 6 * * *` |
| `qboSyncScheduler` / `runOrgQboSync` | cron `0 3 * * *` / event `qbo/sync-org` |
| `xeroSyncScheduler` / `runOrgXeroSync` | cron `0 2 * * *` / event `xero/sync-org` |
| `runBatchCommit`, `runBatchUndo` | events `batch/commit`, `batch/undo` |
| `runBatchChunkLoop` | event `batch/chunk-run`, self-chaining, 2 retries |
| `batchJobWatchdog` | cron `*/2 * * * *` |
| `scheduledImportScan` / `runScheduledImportFn` | cron `0 * * * *` / event `batch/scheduled-run` |

Adding a function requires **three** edits: define it in `inngest/functions/`,
export it from `inngest/index.ts`, and register it in
`app/api/inngest/route.ts`. Miss the third and it silently never runs.

**A historical warning worth keeping:** `/api/inngest` was not in middleware's
bypass list, so every request Inngest made — including its own app-sync
introspection — received a blanket 401 before the SDK's HMAC check ran.
Self-chained background processing effectively never worked in production until
2026-09-06; jobs only completed via a manual nudge or the client-side poke.

## 4. External integrations

| System | Direction | Purpose | Auth | Where configured | Failure behaviour |
|---|---|---|---|---|---|
| **QuickBooks Online** | both | Invoice/customer/payment mirror; bulk write-back; hosted pay links; PDF export; Reports API | OAuth 2.0, tokens encrypted in `qbo_tokens` | `QBO_CLIENT_ID`, `QBO_CLIENT_SECRET`, `QBO_REDIRECT_URI`, `QBO_WEBHOOK_VERIFIER_TOKEN`, `QBO_ENV`, `QBO_REPORTS_MODERN` | Sync logs to `qbo_sync_log` and reports partial results; `QboTokenRefreshBlocked` prevents a refresh storm; pay-link and PDF failures degrade silently |
| **Xero** | both | Same mirror role for Xero organisations | OAuth 2.0, tokens in `xero_tokens` | `XERO_CLIENT_ID`, `XERO_CLIENT_SECRET`, `XERO_REDIRECT_URI`, `XERO_WEBHOOK_SIGNING_KEY` | Logs to `xero_sync_log`; no pay links (QuickBooks-only feature) |
| **Sage Intacct** | inbound | Invoice and bill sync | Stored sender credentials in `sage_intacct_credentials` | `SAGE_SENDER_ID`, `SAGE_SENDER_PASSWORD` | Logs to `sage_sync_log`; writes neither settlement graph |
| **Stripe** | both | Subscription billing, checkout, customer portal, invoices, coupons | Secret key; webhook signature | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRODUCT_ID`, `STRIPE_PRICE_ID` | **Stripe is the source of truth** — never hand-edit billing state. Price resolution falls back product default → newest active recurring → legacy price id |
| **Gmail API** | outbound + token | Send collections email from the org's own Google mailbox | OAuth 2.0, tokens in `gmail_tokens` | `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REDIRECT_URI` | First choice in `lib/mailer.ts`; falls through to the next transport |
| **Microsoft Graph** | outbound + token | Send from an Outlook / Microsoft 365 mailbox | OAuth 2.0, tokens in `microsoft_tokens` | `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_REDIRECT_URI` | Second choice. Graph never returns a Message-ID without `Mail.Read`, so the app generates its own |
| **SMTP** | outbound | Fallback transport | Per-org credentials in `org_smtp_settings` (password encrypted) or global `SYSTEM_SMTP_*` | Settings → Email | Last resort; `hasEmailTransport()` decides whether chasing runs at all |
| **IMAP** (imapflow) | inbound | Reads the admin mailbox and inbound AR replies | Stored mailbox credentials | `admin_email_accounts`, `/api/cron/sync-inbound*` | Cron-driven; failures logged |
| **Google Sheets** | both | Scheduled imports from a spreadsheet | OAuth 2.0, tokens in `google_sheets_tokens` | `GOOGLE_SHEETS_REDIRECT_URI` | Feeds `scheduled_imports` |
| **OpenAI** | outbound | In-app assistant (`/api/chat`), marketing chat, next-action suggestions | `OPENAI_API_KEY` | | A failure degrades the feature only |
| **Vercel Blob** | outbound | Direct upload of Data Studio spreadsheets and guide assets | `BLOB_READ_WRITE_TOKEN` | | Upload failure surfaces in the UI |
| **Inngest** | both | Job scheduling, retries, self-chaining | HMAC signing key | Managed by the SDK | If the endpoint is unreachable, background processing stalls — see the warning above |
| **Neon Postgres** | outbound | All persistence | `DATABASE_URL` | | 3 retries on `fetch` failure; a Postgres error is not retried |
| **Sentry** | outbound | Exception capture | `SENTRY_DSN` / `NEXT_PUBLIC_SENTRY_DSN` | `sentry.*.config.ts` | Completely inert without a DSN; the build is not even wrapped |

`groq-sdk` is a declared dependency with **no import anywhere** in the tree — see
[11-risks-debt-and-open-questions.md](11-risks-debt-and-open-questions.md).

## 5. Outbound interfaces the app itself publishes

| Interface | Consumer | Notes |
|---|---|---|
| **Customer response portal** | Debtors | `/portal/<token>`; 30-day, single-use token; 410 when spent |
| **Owner escalation portal** | Escalation owners | `/owner-portal/<token>`; 30-day; ownership re-checked live on every request |
| **Approver portal** | Bill approvers | `/approver/<token>`; backed by `ap_approval_tokens` |
| **Branded chase email** | Debtors | `lib/ar-email.ts`; drops the pay column entirely when nothing is payable |
| **Statement / approval / invoice PDFs** | Debtors, approvers | `lib/statement-pdf.ts`, `lib/approval-pdf.ts`, `lib/qbo-pay-button.ts` |
| **Print views** | Staff | `/print/invoice`, `/print/trade`, `/print/lot-trace` |
| **Marketing site and blog** | Public / search engines | `app/(marketing)/`; `robots.txt`, `sitemap.xml`, OG image |
| **`/api/health`** | Uptime monitors | 200 with DB latency, or 503 when Postgres is unreachable. No auth. |
| **White-label subdomain** | A specific org's staff | `<subdomain>.primeaccountax.com` on four pre-auth paths. **Requires a wildcard domain on the Vercel project and matching wildcard DNS — a manual step outside this repository.** |

## 6. Multi-tenant nuance for pay links

Three layers decide whether a debtor ever sees "Pay online", and they are worth
knowing because two real clients need opposite answers:

1. **QuickBooks self-gates.** It only mints an `InvoiceLink` when the company has online payments enabled, so a non-payments organisation gets `null` everywhere and every surface hides the whole affordance rather than rendering a dead one.
2. **`organisations.pay_links_enabled`** (default **true**) is an opt-*out* for an organisation that can take online payments but would rather customers did not self-pay. It is deliberately not opt-in, because an opt-in toggle invites "I switched it on and still see nothing" tickets.
3. **Enforced at the choke point, not per surface.** Every path resolves through `fetchQboInvoicePayInfo`, so both checks cover all seven send paths at once. Do not re-check in individual surfaces.

Cost matters here: the org flag and the company preference are cached in-process
(60 s and 10 minutes) and short-circuit before any per-invoice call. Before that,
a chase run burned one QuickBooks call per invoice — and a portal load up to 20 —
for organisations that could never have a link.

## Sources

`app/api/**`; `middleware.ts`; `vercel.json`; `inngest/index.ts`;
`app/api/inngest/route.ts`; `app/api/webhooks/{qbo,xero,stripe}/route.ts`;
`lib/qbo-token.ts`; `lib/qbo-sync.ts`; `lib/xero-sync.ts`; `lib/sage-sync.ts`;
`lib/mailer.ts`; `lib/stripe.ts`; `lib/portal.ts`; `next.config.js`;
`package.json`; `tests/architecture.test.ts`; `CLAUDE.md`.
