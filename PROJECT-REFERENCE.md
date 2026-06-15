# Ledger App — Complete Project Reference

> Comprehensive developer reference covering every system, pattern, API, and decision built in this codebase.  
> Keep this file updated as new work is added.

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Authentication & Roles](#3-authentication--roles)
4. [Database Schema](#4-database-schema)
5. [API Routes](#5-api-routes)
6. [App Pages](#6-app-pages)
7. [Components](#7-components)
8. [Key Library Files](#8-key-library-files)
9. [Core Patterns & Conventions](#9-core-patterns--conventions)
10. [Integrations](#10-integrations)
11. [Email System](#11-email-system)
12. [Stage System](#12-stage-system)
13. [Admin Portal (Super Admin)](#13-admin-portal-super-admin)
14. [Billing & Subscriptions](#14-billing--subscriptions)
15. [Security Constraints (Non-Negotiable)](#15-security-constraints-non-negotiable)
16. [Cron Jobs & Automation](#16-cron-jobs--automation)
17. [Environment Variables](#17-environment-variables)
18. [Work Completed (Chronological)](#18-work-completed-chronological)

---

## 1. Project Overview

**Ledger App** is a multi-tenant SaaS **Accounts Receivable platform** (branded for Prime Accountax). It enables businesses to:

- Sync invoices & payments from QuickBooks Online (QBO) and Xero
- Chase outstanding invoices via automated email sequences
- Manage a Kanban collections board (drag-drop stages)
- Issue customer response portals (customers set promise-to-pay, raise disputes)
- Track team performance and AR aging
- Admin portal for platform operators (leads, subscriptions, billing)

**Stack:**
- **Framework:** Next.js 14 App Router
- **Auth:** NextAuth.js v5 (JWT strategy, Credentials provider, TOTP MFA)
- **ORM:** Drizzle ORM
- **DB:** Neon PostgreSQL (serverless)
- **Email:** Gmail OAuth → Microsoft OAuth → org SMTP (per-org, never global fallback)
- **Billing:** Stripe
- **AI:** Groq (fast) + OpenAI fallback
- **Monitoring:** Sentry
- **Deployment:** Vercel (Hobby plan — one cron per day max)

---

## 2. Architecture

```
app/
├── (app)/          → Authenticated main app (sidebar layout)
│   ├── layout.tsx  → AppShell: Sidebar + header (SyncButton + OrgSwitcher)
│   ├── admin/      → Super admin area (clean shell, no sidebar)
│   └── ...pages
├── (rep-portal)/   → Rep-only dashboard
├── (marketing)/    → Public marketing pages
├── api/            → All API routes
│   └── ...domains
├── login/          → Auth pages
├── portal/[token]/ → Public customer response portal
└── layout.tsx      → Root layout

components/         → Shared React components
lib/                → Server utilities, sync engines, helpers
db/
├── schema.ts       → Drizzle table definitions
└── index.ts        → DB connection
middleware.ts       → Edge auth guard + routing
auth.config.ts      → Edge-safe NextAuth config (no DB)
vercel.json         → Cron schedules
```

**Multi-tenancy:** Every DB table has `orgId` FK. `requireOrg()` validates this on every request.

**Admin subdomain:** `admin.primeaccountax.com` → rewrites to `/admin` routes in middleware.

---

## 3. Authentication & Roles

### Login Flow
1. Email + password → bcrypt verify
2. If `mfaEnabled`: prompt TOTP code or recovery code
3. Rate limit: 10 attempts per 900s per email
4. JWT token (8-hour expiry): `{ id, email, name, role, orgId, repId }`
5. Audit event: `user_login`

### Roles (hierarchy low → high)

| Role | Access |
|---|---|
| `rep` | Own portfolio only (repScope), /rep-portal, /api (filtered) |
| `company_user` | Org data, read/edit limited records |
| `company_admin` | Full org access, settings, billing |
| `platform_admin` | Admin portal, leads, subscriptions, all orgs |
| `super_admin` | Everything; bypasses org membership checks |

### Key Auth Helpers (`lib/api.ts`)

```typescript
// Re-validates user on EVERY request (status, membership, deactivation)
const { error, orgId, role, repId } = await requireOrg();
if (error) return error;

isSuperAdmin(session)  // role === "super_admin" only

// IDOR prevention
if (!(await ownsInOrg(customers, customerId, orgId))) {
  return bad("Not found", 404);
}
```

### Response Helpers

```typescript
ok(data)               // NextResponse.json(data) — 1 arg ONLY, never ok(data, 201)
bad(message, status)   // NextResponse.json({ error: message }, { status })
```

### Middleware (`middleware.ts`)
- Admin subdomain → rewrite to `/admin`
- Vercel preview deployments → "Coming soon" splash
- Public paths (login, register, portal, marketing, webhooks, cron, OAuth callbacks) → no auth
- Authenticated paths → redirect to /login if unauthenticated
- Rep role → confined to /rep-portal + /api
- Admin routes → require platform_admin or super_admin

---

## 4. Database Schema

### Core Entities

**`organisations`**  
`id, name, slug, currency, dateFormat, stages [JSON Stage[]], disabledRules, logoUrl, displayName, showPaymentHistory, lastCronRun, lastCronStats`

**`users`**  
`id, email, passwordHash, name, role, orgId FK, repId FK, status, resetToken, resetTokenExpiry, mfaEnabled, mfaSecret [AES-encrypted], mfaRecoveryCodes [bcrypt-hashed array]`

**`user_organisations`** (many-to-many)  
`userId, orgId, role`

### Sales / Lead Management

**`landing_page_requests`** (leads)  
`fullName, email, companyName, phone, country, companySize, interestedService, status [new|contacted|qualified|converted|rejected|archived], assignedToAdminId, adminNotes, utm_*`

**`lead_notes`** — Threaded comments on leads  
**`lead_tasks`** — Tasks associated with leads  
**`lead_email_templates`** — Reusable outreach templates (name, subject, body, stage)  
**`lead_sequences`** — Drip campaigns (name, description, isActive)  
**`lead_sequence_steps`** — Steps (sequenceId, stepNumber, delayDays, subject, body)  
**`lead_sequence_enrollments`** — Enrollment state (leadId, sequenceId, status, enrolledAt)  
**`lead_sequence_sends`** — Send records (enrollmentId, stepId, scheduledAt, sentAt, status)

### Subscription & Billing

**`subscriptions`**  
`orgId, stripeCustomerId, stripeSubscriptionId, stripePriceId, status, currentPeriodStart/End, cancelAt, cancelAtPeriodEnd, trialEnd, billingEmail, planName, planAmount, planInterval, planCurrency, lastPaymentStatus, source [stripe|manual], manualExpiresAt, manualPaymentStatus, manualInvoiceRef, managedByAdminId`

**`cancellation_requests`**  
`orgId, stripeCustomerId, requestedByUserId, reason, status [pending|approved|rejected|cancelled], reviewedByAdminId, adminDecision, cancellationEffectiveDate`  
> **IMPORTANT:** No automatic cancellation when customer clicks Cancel — creates admin-review request only. Stripe only touched after admin decision.

**`billing_audit_logs`** — Billing action trail  
**`temp_access_requests`** — Override access (pending|approved|rejected, expiresAt)

### Sales / AR

**`reps`** — `orgId, name, email, tier [rep|rd|ed], managerId FK`  
**`regions`** — `orgId, name`

**`customers`**  
`orgId, name, code, country, currency, paymentTerms, taxNumber, riskRating [Low|Medium|High], creditLimit, accountOwnerId, collectionOwnerId, repId, regionId, qboId, xeroId, chaseByProject`

**`contacts`** — Billing/escalation contacts  
`customerId, orgId, name, title, email, phone, type [Billing|Escalation], isPrimary, isEscalation, receivesAuto, status, nextSendAt`

**`projects`** — `customerId, orgId, name, code, ownerId, repId, regionId, status, qboId, xeroId`

**`invoices`** (the core AR ledger)  
`orgId, invoiceNumber, customerId, projectId, invoiceDate, dueDate, currency, amount, taxAmount, total, paid, paymentStatus [Unpaid|Partially Paid|Paid|Written Off], collectionStage [key stored, label resolved at read time], collectionOwnerId, promiseDate, promiseAmount, promiseSource, hasOpenDispute, automationsPaused, disputeDate, disputeReason, qboId, qboBalance, xeroId, xeroBalance, txnType [Invoice|CreditMemo], paidAt`

### Customer Response Portal

**`customer_portal_tokens`**  
`orgId, customerId, token [unique], invoiceIds [JSON], status [Active|Completed|Expired], expiresAt`

**`invoice_promises`** — Promise-to-pay events (event table, source of truth)  
`orgId, invoiceId, customerId, promiseDate, amount, source [Customer Portal|Rep|Accountant], status [Active|Met|Broken|Superseded], tokenId`

**`invoice_disputes`** — Dispute events (event table, source of truth)  
`orgId, invoiceId, customerId, category, reason, source, assignedTo, status [Open|Under Review|Resolved|Rejected], tokenId`

### Payments

**`payments`** — QBO ReceivePayment transactions  
**`payment_applications`** — Invoice-to-payment allocation lines  
**`refund_receipts`** — QBO RefundReceipt  
**`deposits`** — QBO AR-affecting deposit lines  
**`journal_entry_ar_lines`** — AR-affecting journal entries

### Communications & Audit

**`communications`**  
`orgId, customerId, projectId, invoiceId, direction [Inbound|Outbound], channel [Email|Portal|Chat], sentAt, subject, from, to, cc, body, refNumber, sentByUserId, deliveryStatus`

**`audit_events`** (append-only)  
`orgId, customerId, invoiceId, eventType, actorId, actorName, meta [JSON], occurredAt`  
Event types: `email_sent, email_manual, note_added, stage_changed, payment_recorded, promise_to_pay, dispute_raised, programme_toggled, chase_mode_changed, invoice_synced, contact_updated, user_login, user_deactivated, integration_connected, integration_disconnected, data_exported`

### Integration Tokens

**`qbo_tokens`** — `orgId, accessToken [AES-encrypted], refreshToken [AES-encrypted], realmId, companyName, expiresAt`  
**`qbo_sync_log`** — Sync history  
**`xero_tokens`** — Same as QBO  
**`xero_sync_log`** — Sync history

**`email_providers`** — Per-org email config  
`orgId, type [smtp|gmail|microsoft], gmailRefreshToken, microsoftRefreshToken, smtpHost, smtpPort, smtpUser, smtpPass [encrypted], isDefault, status`

---

## 5. API Routes

### Authentication
| Route | Methods | Description |
|---|---|---|
| `/api/auth/[...nextauth]` | POST | NextAuth handler (Credentials + TOTP MFA) |
| `/api/auth/register` | POST | Registration (invite-only, disabled for public) |
| `/api/auth/forgot-password` | POST | Password reset flow |
| `/api/auth/reset-password` | POST | Reset confirmation |
| `/api/auth/mfa/setup` | POST | Enrol TOTP |
| `/api/auth/mfa/enable` | POST | Activate enrolled MFA |
| `/api/auth/mfa/disable` | POST | Disable MFA |
| `/api/auth/mfa/status` | GET | Check MFA status |
| `/api/auth/switch-org` | POST | Switch active org (multi-tenant) |

### Invoices
| Route | Methods | Description |
|---|---|---|
| `/api/invoices` | GET, POST | List (org-scoped, rep-filtered) / Create |
| `/api/invoices/[id]` | GET, PATCH, DELETE | Single invoice CRUD + stage/promise/dispute change events |
| `/api/invoices/[id]/payment` | POST | Record payment |
| `/api/invoices/[id]/timeline` | GET | Activity timeline |
| `/api/invoices/[id]/response` | POST | Portal submission (promise/dispute) |
| `/api/invoices/[id]/promises` | POST | Create promise event |
| `/api/invoices/[id]/disputes` | POST | Create dispute event |
| `/api/invoices/[id]/pdf` | GET | Fetch PDF from QBO/Xero |
| `/api/invoices/bulk-delete` | POST | Bulk delete |
| `/api/invoices/download-pdfs` | POST | Bulk PDF ZIP |

### Customers
| Route | Methods | Description |
|---|---|---|
| `/api/customers` | GET, POST | List / Create |
| `/api/customers/[id]` | GET, PATCH | Detail / Update |
| `/api/customers/[id]/balance` | GET | AR balance |
| `/api/customers/[id]/statement` | GET | Customer statement |
| `/api/customers/[id]/transactions` | GET | Payment history |
| `/api/customers/bulk-delete` | POST | Bulk delete |
| `/api/customers/reclassify` | POST | Move projects/reps |

### Projects, Contacts, Reps
| Route | Methods | Description |
|---|---|---|
| `/api/projects` | GET, POST | List / Create |
| `/api/projects/[id]` | GET, PATCH | Detail / Update |
| `/api/projects/[id]/transactions` | GET | Transactions |
| `/api/projects/bulk-delete` | POST | Bulk delete |
| `/api/contacts` | GET, POST | List / Create |
| `/api/contacts/[id]` | GET, PATCH | Detail / Update |
| `/api/reps` | GET, POST | List / Create |
| `/api/reps/[id]` | GET, PATCH | Detail / Update |
| `/api/me/rep` | GET | Current user's rep |
| `/api/regions` | GET | List regions |

### Email & Communications
| Route | Methods | Description |
|---|---|---|
| `/api/email/send` | POST | Unified sender (Gmail OAuth → Microsoft OAuth → SMTP); supports parallel PDF attachments |
| `/api/email/status` | GET | Delivery status |
| `/api/email-templates` | GET, POST | Org email templates |
| `/api/email-templates/[id]` | GET, PATCH, DELETE | Template CRUD |
| `/api/communications` | GET, POST | Comms log |

### Customer Response Portal
| Route | Methods | Description |
|---|---|---|
| `/api/portal/token` | POST | Issue portal token for customer |
| `/api/portal/[token]` | GET | Public: fetch customer invoices |
| `/api/portal/[token]/submit` | POST | Customer submits promise/dispute |

### Responses (Promises & Disputes)
| Route | Methods | Description |
|---|---|---|
| `/api/responses` | GET, POST | Aggregated promises + disputes (rep-filtered) |
| `/api/responses/assignees` | GET | Users available for assignment |

### QBO (QuickBooks Online)
| Route | Methods | Description |
|---|---|---|
| `/api/qbo` | GET, POST | Status / Initiate OAuth |
| `/api/qbo/callback` | GET | OAuth callback |
| `/api/qbo/disconnect` | POST | Revoke access |
| `/api/qbo/sync` | GET, POST | Status / Full sync (customers, invoices, payments, deposits, JEs) |
| `/api/qbo/history` | GET | Last 100 sync runs |
| `/api/qbo/verify` | POST | Manual AR reconciliation |
| `/api/qbo/verify-ar` | POST | Deep AR verification |
| `/api/qbo/reconcile-customers` | POST | Reconcile customer list |
| `/api/qbo/backfill-paid-at` | POST | Backfill paidAt from QBO |

### Xero
| Route | Methods | Description |
|---|---|---|
| `/api/xero` | GET, POST | Status / Initiate OAuth |
| `/api/xero/callback` | GET | OAuth callback |
| `/api/xero/disconnect` | POST | Revoke access |
| `/api/xero/sync` | GET, POST | Status / Full sync |
| `/api/xero/history` | GET | Sync history |

### Gmail & Microsoft (OAuth Email)
| Route | Methods | Description |
|---|---|---|
| `/api/gmail` | GET | Initiate OAuth |
| `/api/gmail/callback` | GET | OAuth callback |
| `/api/gmail/disconnect` | POST | Revoke access |
| `/api/microsoft` | GET | Initiate OAuth |
| `/api/microsoft/callback` | GET | OAuth callback |
| `/api/microsoft/disconnect` | POST | Revoke access |

### Reports & Audit
| Route | Methods | Description |
|---|---|---|
| `/api/reports/ar-aging` | GET | AR Aging (Current / 1-30 / 31-60 / 61-90 / 90+) |
| `/api/reports/ar-snapshot` | GET | AR snapshot at point in time |
| `/api/reports/ar-reconcile` | GET | AR reconciliation vs QBO |
| `/api/audit-events` | GET | Audit event log |
| `/api/audit-events/export` | GET | Export audit trail |

### Organisation Settings
| Route | Methods | Description |
|---|---|---|
| `/api/org/settings` | GET, PATCH | Org config (name, currency, stages, etc.) |
| `/api/org/email-settings` | GET, PATCH | Email provider config |
| `/api/org/smtp` | POST | Configure SMTP |
| `/api/org/colref` | GET, PATCH | Collection reference numbering |
| `/api/user/orgs` | GET | All orgs user is member of |

### Billing
| Route | Methods | Description |
|---|---|---|
| `/api/billing` | GET | Subscription details |
| `/api/billing/plans` | GET | Available plans |
| `/api/billing/checkout` | POST | Create Stripe checkout session |
| `/api/billing/portal` | GET | Redirect to Stripe customer portal |
| `/api/billing/invoices` | GET | Billing history |
| `/api/billing/cancel-request` | POST | Request cancellation (review-only, no auto-cancel) |
| `/api/billing/reactivate` | POST | Reactivate subscription |
| `/api/billing/access` | GET | Check subscription access |
| `/api/billing/temp-access` | POST | Grant temporary override |

### Webhooks
| Route | Methods | Description |
|---|---|---|
| `/api/webhooks/qbo` | POST | QuickBooks webhook events |
| `/api/webhooks/xero` | POST | Xero webhook events |
| `/api/webhooks/stripe` | POST | Stripe subscription/payment events |

### Import & Misc
| Route | Methods | Description |
|---|---|---|
| `/api/import` | POST | Bulk import from CSV/Excel |
| `/api/chat` | POST | AI email composition (Groq + OpenAI) |
| `/api/seed` | POST | Seed demo data |

### Admin Panel Routes (`/api/admin/*` — platform_admin / super_admin only)
| Route | Methods | Description |
|---|---|---|
| `/api/admin/overview` | GET | Platform overview (all orgs) |
| `/api/admin/organisations` | GET, POST | List / Create orgs |
| `/api/admin/organisations/[id]/users` | GET, POST | Org users |
| `/api/admin/users` | GET, POST | Platform users |
| `/api/admin/leads` | GET, POST | Leads / prospects |
| `/api/admin/leads/[id]` | GET, PATCH | Lead detail |
| `/api/admin/leads/[id]/email` | POST | Send email to lead |
| `/api/admin/leads/[id]/mark-replied` | POST | Stop all active sequences + log reply |
| `/api/admin/leads/[id]/notes` | GET, POST | Lead notes |
| `/api/admin/leads/[id]/tasks` | GET, POST | Lead tasks |
| `/api/admin/leads/[id]/tasks/[taskId]` | PATCH | Update task |
| `/api/admin/leads/[id]/enrollments` | POST | Enroll in sequence |
| `/api/admin/leads/[id]/enrollments/[enrollmentId]` | PATCH | Update enrollment |
| `/api/admin/leads/import` | POST | Bulk import leads |
| `/api/admin/leads/seed-defaults` | POST | Seed 6 templates + 1 drip sequence (idempotent) |
| `/api/admin/subscriptions` | GET, POST | All subscriptions |
| `/api/admin/subscriptions/[id]` | GET, PATCH | Subscription detail |
| `/api/admin/subscriptions/sync` | POST | Force Stripe sync |
| `/api/admin/subscriptions/manual` | POST | Create manual subscription |
| `/api/admin/cancellations` | GET | List cancellation requests |
| `/api/admin/cancellations/[id]/decide` | POST | Admin approves/rejects cancellation |
| `/api/admin/email-templates` | GET, POST | Lead email templates |
| `/api/admin/email-templates/[id]` | GET, PATCH | Template detail |
| `/api/admin/sequences` | GET, POST | Email sequences |
| `/api/admin/sequences/[id]` | GET, PATCH | Sequence detail |
| `/api/admin/sequences/[id]/steps` | POST | Add step |
| `/api/admin/sequences/[id]/steps/[stepId]` | PATCH | Update step |
| `/api/admin/sequences/process` | POST | Process drip sends (daily cron) |
| `/api/admin/temp-access` | GET, POST | Temp access requests |
| `/api/admin/temp-access/[id]` | PATCH | Approve/reject |
| `/api/admin/audit` | GET | Platform audit trail |
| `/api/admin/reset-qbo-data` | POST | Full QBO data reset |

---

## 6. App Pages

### Main App (`(app)/`)

| Page | Route | Description |
|---|---|---|
| `dashboard/page.tsx` | `/dashboard` | AR health, KPIs, top customers, responses summary, "Committed to Pay / Broken Commitments / Active Commitments" widgets |
| `invoices/page.tsx` | `/invoices` | Invoice list with filters, bulk actions (send email, stage change, delete) |
| `invoices/[id]/page.tsx` | `/invoices/[id]` | Invoice detail + edit + timeline + "Commit to Pay" / Dispute / Record payment buttons |
| `customers/page.tsx` | `/customers` | Customer list with AR balances |
| `customers/[id]/page.tsx` | `/customers/[id]` | Customer detail (contacts, invoices, projects, statement) |
| `projects/page.tsx` | `/projects` | Project list |
| `projects/[id]/page.tsx` | `/projects/[id]` | Project detail |
| `board/page.tsx` | `/board` | Kanban collections board (drag-drop by stage) |
| `responses/page.tsx` | `/responses` | Promises & Disputes inbox |
| `tasks/page.tsx` | `/tasks` | Internal task list |
| `reports/page.tsx` | `/reports` | AR Aging, DSO, concentration analysis |
| `performance/page.tsx` | `/performance` | Collection KPIs, team performance |
| `inbox/page.tsx` | `/inbox` | Communication notes (inbound emails) |
| `communications/page.tsx` | `/communications` | Full comms log |
| `automations/page.tsx` | `/automations` | Email automation rules |
| `smart-views/page.tsx` | `/smart-views` | Saved filters / custom views |
| `imports/page.tsx` | `/imports` | Bulk import (CSV/Excel) |

### Settings (`(app)/settings/`)

| Page | Route | Description |
|---|---|---|
| `page.tsx` | `/settings` | Settings hub |
| `company/page.tsx` | `/settings/company` | Org profile, logo, currency, date format, stages |
| `team/page.tsx` | `/settings/team` | Users, reps, roles, permissions |
| `billing/page.tsx` | `/settings/billing` | Subscription status |
| `email/page.tsx` | `/settings/email` | Gmail OAuth / Microsoft OAuth / SMTP config |
| `integrations/page.tsx` | `/settings/integrations` | QBO, Xero, Gmail, Microsoft status |
| `integrations/reconcile/page.tsx` | `/settings/integrations/reconcile` | Data reconciliation tools |
| `stages/page.tsx` | `/settings/stages` | Stage customization (rename, reorder, add custom; locked stages cannot be deleted/hidden) |
| `notifications/page.tsx` | `/settings/notifications` | Notification preferences |

### Admin (`(app)/admin/` — platform_admin / super_admin)

| Page | Route | Description |
|---|---|---|
| `page.tsx` | `/admin` | Admin dashboard |
| `leads/page.tsx` | `/admin/leads` | Leads management (seed defaults, import, mark replied, email sequences) |
| `subscriptions/page.tsx` | `/admin/subscriptions` | Subscription management |
| `billing/page.tsx` | `/admin/billing` | Billing audit log |
| `cancellations/page.tsx` | `/admin/cancellations` | Cancellation requests review |
| `team/page.tsx` | `/admin/team` | Users across all orgs |
| `temp-access/page.tsx` | `/admin/temp-access` | Temporary access overrides |
| `audit/page.tsx` | `/admin/audit` | Platform audit trail |

### Rep Portal (`(rep-portal)/`)

| Page | Route | Description |
|---|---|---|
| `rep-portal/page.tsx` | `/rep-portal` | Rep dashboard (own customers, AR, tasks, "📅 Committed" badges) |

### Public Pages

| Page | Route | Description |
|---|---|---|
| `portal/[token]/page.tsx` | `/portal/[token]` | Customer response portal (token-auth, no login) |
| `login/page.tsx` | `/login` | Login (email + password + MFA) |
| `register/page.tsx` | `/register` | Company signup wizard |
| `forgot-password/page.tsx` | `/forgot-password` | Password reset |
| `reset-password/page.tsx` | `/reset-password` | Reset confirmation |
| `privacy/page.tsx` | `/privacy` | Privacy policy |
| `terms/page.tsx` | `/terms` | Terms of service |

---

## 7. Components

| Component | Description |
|---|---|
| `ui.tsx` | Design system primitives: Card, Badge, Button, Input, Select, Modal, EmptyState, Toast, stageBadge, dueStatusBadge |
| `data-provider.tsx` | Global DataProvider context: invoices, customers, projects, contacts, communications, tasks, orgSettings, toastState |
| `auth-provider.tsx` | NextAuth SessionProvider wrapper |
| `sidebar.tsx` | Navigation sidebar (menu links, user avatar, sign out). Admin Portal NOT listed here — accessed directly at /admin |
| `org-switcher.tsx` | Organisation dropdown switcher (visible in header on all pages) |
| `sync-button.tsx` | Dynamic QBO/Xero sync button; detects which integration is connected on mount; appears in header before org switcher on all pages |
| `send-invoices-modal.tsx` | Email compose & send dialog (bulk invoice email); has "Attach invoice PDF" and "Include customer portal link" toggles; PDFs fetched in parallel |
| `board-list.tsx` | Kanban board (stage columns, drag-drop invoices) |
| `ar-aging-report.tsx` | AR aging analysis (Current / 1-30 / 31-60 / 61-90 / 90+ buckets) |
| `responses-inbox.tsx` | Customer responses (promises + disputes timeline) |
| `responses-dashboard-widget.tsx` | Dashboard summary widget |
| `promise-dispute-panel.tsx` | Side panel for managing promises/disputes on an invoice |
| `transactions-tab.tsx` | Payment transactions history |
| `chat-widget.tsx` | AI-powered email composer (Groq/OpenAI) |
| `data-table.tsx` | Generic sortable/filterable/selectable table |
| `forms.tsx` | InvoiceModal, CustomerModal, ContactModal, ProjectModal, StageModal, etc. |
| `mfa-card.tsx` | TOTP MFA setup/management (QR code, recovery codes) |
| `subscription-gate.tsx` | Subscription access control (shows upsell if past-due/inactive) |
| `currency-pills.tsx` | Multi-currency display helper |
| `interest-form.tsx` | Interest accrual calculator |
| `marketing.tsx` | Marketing page blocks (hero, features, testimonials) |
| `solution-page.tsx` | Template for solution landing pages |
| `alternative-page.tsx` | Template for competitor comparison pages |
| `feature.tsx` | Reusable feature block |

---

## 8. Key Library Files

### `lib/api.ts` — Request helpers

```typescript
requireOrg()          // Multi-step: validate user status → resolve org → check membership → resolve role
isSuperAdmin(session) // role === "super_admin" ONLY
ownsInOrg(table, id, orgId)  // FK ownership check (IDOR prevention)
ok(data)              // NextResponse.json(data)  — 1 arg only
bad(message, status)  // NextResponse.json({ error: message }, { status })
```

### `lib/stages.ts` — Stage system

```typescript
LOCKED_STAGE_KEYS = ["New", "Promised", "Disputed", "Closed"]
// "Promised" is the DB key; display label is "Committed"

isLockedStage(key)        // Cannot rename/delete/hide
ensureLockedStages(stages) // Inject missing; migrates "Promised" label → "Committed" for existing orgs
resolveStageLabel(dbValue, stages)  // Legacy-safe label resolution
DEFAULT_STAGES             // Full preset (New, Scheduled, Reminder Sent, ... Committed, Disputed, ... Closed)
STAGE_COLOR_CLASSES        // Tailwind per color name
```

### `lib/format.ts` — Formatting

```typescript
fmt.money(1234.56, "EUR")  // "€1,235"
fmt.date(d)                // Org date format
fmt.relative(d)            // "2d ago"
daysOverdue(dueDate)       // number
getDueStatus(inv)          // "Paid" | "Overdue" | "Due Today" | "Due Soon" | "Not Due" | "Written Off"
getAgingBucket(inv)        // "Current" | "1-30" | "31-60" | "61-90" | "90+"
today()                    // "YYYY-MM-DD"
```

### `lib/ar-email.ts` — Email template

```typescript
renderInvoiceEmail({ subject, dateStr, total, currency, portalUrl, intro, rows })
// Single source of truth for all AR email HTML
// portalUrl = null → omits "View & Respond" button
// intro text uses \n → <br> conversion at render time
```

### `lib/email-ref.ts`

```typescript
genEmailRef()  // → "AR-260615-X9K2" — unique tracking ref
```

### `lib/audit.ts`

```typescript
logEvent({ orgId, eventType, invoiceId, actorId, actorName, meta })
// Always fire-and-forget (try/catch wrapped) — never breaks the primary action
```

### `lib/portal.ts`

```typescript
validatePortalToken(token)          // Check status, expiry
recomputeInvoiceState(orgId, invoiceId)  // Sync derived fields from event tables
```

### `lib/mailer.ts` — Unified email sender

Routes: Gmail OAuth → Microsoft OAuth → org SMTP  
**Each org uses its OWN SMTP/OAuth credentials — never falls back to global env vars**

### `lib/system-mailer.ts` — Transactional email

```typescript
sendSystemEmail({ to, subject, html, cc? })
// From: support@primeaccountax.com
// For: password resets, MFA codes, system notifications — never org-specific
```

### `lib/rep-scope.ts`

```typescript
getRepScope(orgId, role, repId)
// Returns null (unrestricted) for admin/accountant
// Returns { invoiceIds: Set, customerIds: Set } for reps
```

### `lib/qbo-sync.ts` & `lib/xero-sync.ts` — Sync engines

Full bidirectional sync: Customers, Invoices, Payments, CreditMemos, Deposits, JournalEntries  
Reconciles local DB using `qboId`/`xeroId` as dedup keys  
Computes AR balance, payment applications, aging snapshots

### `lib/crypto.ts` — Encryption

```typescript
encryptSecret(plaintext)   // AES-256 encryption
decryptSecret(ciphertext)  // Decrypt
// Used for: MFA secrets, SMTP passwords, OAuth refresh tokens at rest
```

### `lib/oauth-state.ts` — CSRF protection

PKCE-style state token for QBO, Xero, Gmail, Microsoft OAuth flows

### `lib/billing.ts`

```typescript
syncSubscriptionFromStripe(sub)   // Write Stripe data to local DB
logBillingEvent(...)              // Audit billing actions
```

---

## 9. Core Patterns & Conventions

### Request handler boilerplate

```typescript
export async function GET(req: Request) {
  const { error, orgId, role, repId } = await requireOrg();
  if (error) return error;
  // ... business logic ...
  return ok(data);
}
```

### Never use `await` inside setState callbacks

```typescript
// WRONG
setItems(prev => [...prev, await r.json()]);

// CORRECT
const data = await r.json();
setItems(prev => [...prev, data]);
```

### Fire-and-forget for non-critical async work

```typescript
// Comms logging, audit events — never block the success response
Promise.all(rows.map(r => fetch("/api/communications", { ... }).catch(() => {})));
```

### Parallel I/O

```typescript
// Parallel PDF fetches (not serial)
const results = await Promise.allSettled(invoiceIds.map(id => fetchPdf(id)));
// Parallel integration token fetches
const [qboToken, xeroToken] = await Promise.all([getQboToken(orgId), getXeroToken(orgId)]);
```

### Email body storage

Bodies stored as plain text with `\n`.  
Both the email route and sequence processor convert `\n → <br>` at send time.

### Stage key vs label

```
DB stores: collectionStage = "Promised"  (immutable key)
UI shows:  "Committed"                    (current label, resolved via resolveStageLabel)
```

Never compare against the label in API logic — always use the key.

### Idempotent seed endpoints

Check by `name` before inserting. Safe to call multiple times.

---

## 10. Integrations

### QuickBooks Online (QBO)

- OAuth 2.0 flow: `/api/qbo` → `/api/qbo/callback`
- Tokens stored encrypted in `qbo_tokens`
- Full sync via `lib/qbo-sync.ts` (can run up to 5 minutes)
- Webhook at `/api/webhooks/qbo`
- Manual sync button: `SyncButton` component in global header
- PDF fetch: `/api/invoices/[id]/pdf` proxies to QBO PDF endpoint

### Xero

- Same pattern as QBO
- Tenant ID required for all API calls (multi-org Xero support)
- Sync via `lib/xero-sync.ts`

### Gmail OAuth

- Org-level OAuth (not user-level)
- Token stored in `email_providers` table (encrypted)
- Used as primary email sender when connected

### Microsoft (Outlook/Graph API)

- Same pattern as Gmail
- Microsoft Graph API for sending

### Stripe

- **Stripe is ONLY for SaaS billing (super admin / platform level)**
- **App users do NOT interact with Stripe directly**
- Webhook at `/api/webhooks/stripe`
- Cancellation = admin-review workflow, not instant

---

## 11. Email System

### Send path priority

```
Gmail OAuth (org) → Microsoft OAuth (org) → Org SMTP → ERROR
```

**Never fall back to global env SMTP.** Each org must have its own credentials.

### Email reference tracking

Every manual send gets a `genEmailRef()` value (e.g. `AR-260615-X9K2`) logged in `communications`.

### Invoice email template

`renderInvoiceEmail()` in `lib/ar-email.ts` — single source of truth:
- Branded dark header
- Invoice table with due status colouring
- Total outstanding
- Optional "View & Respond" CTA (portal link)
- Intro text from compose modal

### Send invoices modal toggles

1. **Attach invoice PDF** — fetches from QBO/Xero in parallel (not serial)
2. **Include customer portal link** — gates the expensive token fetch; only for single-customer sends

### System email

`sendSystemEmail()` always sends from `support@primeaccountax.com` — for password resets, MFA setup, admin notifications.

### Leads drip sequences

- Sequences defined in `lead_sequences` + `lead_sequence_steps`
- Processed daily at 8 AM UTC by `/api/admin/sequences/process` (cron)
- Enrollment stopped by "Mark as Replied" (`/api/admin/leads/[id]/mark-replied`)

---

## 12. Stage System

### Locked stages (immutable keys)

| Key | Display Label | Colour | Notes |
|---|---|---|---|
| `New` | New | stone | Default landing stage |
| `Promised` | **Committed** | amber | Set when customer commits to payment |
| `Disputed` | Disputed | rose | Pauses automations |
| `Closed` | Closed | emerald | End-of-lifecycle |

> The key `"Promised"` is stored in the DB and used in all code logic.  
> The label `"Committed"` is what users see everywhere in the UI.  
> This matches the dashboard terminology: "COMMITTED TO PAY", "BROKEN COMMITMENTS", "Active Commitments".

### Custom stages

Orgs can add, rename, reorder, recolour non-locked stages.  
Cannot rename/delete/hide locked stages.  
`ensureLockedStages()` injects any missing locked stages and migrates old `"Promised"` labels to `"Committed"` on the fly.

### Stage resolution

```typescript
resolveStageLabel(dbValue, orgStages)
// 1. Exact label match
// 2. Key match → returns current label
// 3. Legacy map: "Promise to Pay" → "Promised" (key), then label lookup
```

---

## 13. Admin Portal (Super Admin)

Accessed at `admin.primeaccountax.com` (rewrites to `/admin`).  
Requires `platform_admin` or `super_admin` role.  
Uses clean layout (no app sidebar or org-switcher).

### Features built

- **Leads management** (`/admin/leads`)
  - Table with status, assigned rep, activity
  - Import CSV
  - "Seed defaults" button — creates 6 stage email templates + 1 drip sequence (idempotent)
  - Activity panel per lead (notes, tasks, email send, sequence enrollment)
  - "Mark as Replied" — cancels all active sequences, logs reply note, advances status to "contacted"
  - Email compose with template selector
  - Drip sequence enrollment + step tracking

- **Subscriptions** (`/admin/subscriptions`)  
  Manual and Stripe subscriptions; approve/reject cancellation requests

- **Cancellations** (`/admin/cancellations`)  
  Review-only workflow; admin decides → then Stripe is touched

- **Temp access** (`/admin/temp-access`)  
  Grant time-limited access override for past-due orgs

---

## 14. Billing & Subscriptions

### Subscription lifecycle

```
Trial → Active → Past Due → Cancelled
                         ↘ Temp Access Override (admin-granted)
```

### Cancellation workflow (NEVER auto-cancel)

1. Customer clicks Cancel → creates `cancellation_requests` row (status: pending)
2. Admin reviews at `/admin/cancellations`
3. Admin approves → Stripe cancellation triggered → `billing_audit_logs` entry
4. Admin rejects → request closed, subscription continues

### SubscriptionGate component

Wraps all app pages. Shows upsell/locked screen if org is past-due, cancelled, or inactive.  
Temp access override bypasses the gate for a set period.

### Stripe constraints

- Stripe is ONLY for SaaS-level billing (platform admin view)
- App users never see or interact with Stripe
- No Stripe links sent to customers from within the AR app

---

## 15. Security Constraints (Non-Negotiable)

### Compromised key — NEVER use

```
ENCRYPTION_KEY = 241974e629d85eae79d31b8cac669a38a91bb5d48b6af7251e082f60306aef75
```

This key is COMPROMISED. Never reference, use, or re-derive this value.

### Per-org SMTP — NEVER fall back to global

Every org must use its own SMTP/Gmail/Microsoft credentials.  
Global env SMTP is NOT a fallback. If no org email config exists → return error.

### Cancellation — NEVER auto-cancel

Customer clicking "Cancel" creates an admin-review request only.  
Stripe is only touched after an admin explicitly approves the cancellation.

### Stripe scope — NEVER use for customer payments

Stripe is only for SaaS billing at the platform admin level.  
App users do not send Stripe payment links to their customers.

### Auth hardening

- `requireOrg()` re-validates user on every request (status, membership, org)
- MFA secrets and OAuth tokens AES-encrypted at rest
- OAuth CSRF protection via state tokens
- Rate limiting on login: 10 attempts / 900s
- Rep scoping: reps can only see their own portfolio

---

## 16. Cron Jobs & Automation

### `vercel.json`

```json
{
  "crons": [
    {
      "path": "/api/admin/sequences/process",
      "schedule": "0 8 * * *"
    }
  ]
}
```

**Vercel Hobby plan constraint:** Max 1 cron job, max once per day. Schedule must be `"0 8 * * *"` (or similar daily). Hourly schedules (`"0 * * * *"`) are blocked.

### Sequence processor (`/api/admin/sequences/process`)

- Secured by `CRON_SECRET` header (Vercel sends automatically)
- Processes all pending `lead_sequence_sends` where `scheduledAt <= now`
- Sends via system mailer
- Updates enrollment status when all steps complete
- Skips cancelled enrollments

---

## 17. Environment Variables

| Variable | Description |
|---|---|
| `DATABASE_URL` | Neon PostgreSQL connection string |
| `NEXTAUTH_SECRET` | NextAuth JWT signing secret |
| `NEXTAUTH_URL` | App base URL |
| `ENCRYPTION_KEY` | AES key for secrets at rest (⚠ see Security section) |
| `CRON_SECRET` | Secures cron endpoint (Vercel sends automatically) |
| `STRIPE_SECRET_KEY` | Stripe API key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook verification |
| `QBO_CLIENT_ID` | QuickBooks OAuth client |
| `QBO_CLIENT_SECRET` | QuickBooks OAuth secret |
| `QBO_REDIRECT_URI` | QuickBooks callback URL |
| `XERO_CLIENT_ID` | Xero OAuth client |
| `XERO_CLIENT_SECRET` | Xero OAuth secret |
| `XERO_REDIRECT_URI` | Xero callback URL |
| `GOOGLE_CLIENT_ID` | Gmail OAuth client |
| `GOOGLE_CLIENT_SECRET` | Gmail OAuth secret |
| `MICROSOFT_CLIENT_ID` | Microsoft OAuth client |
| `MICROSOFT_CLIENT_SECRET` | Microsoft OAuth secret |
| `OPENAI_API_KEY` | OpenAI (AI composer fallback) |
| `GROQ_API_KEY` | Groq (AI composer, fast) |
| `SENTRY_DSN` | Error tracking |
| `SYSTEM_FROM_EMAIL` | System email sender (`support@primeaccountax.com`) |

---

## 18. Work Completed (Chronological)

This section records every feature, fix, and change built across all sessions.

### Collections Board & Invoices

- Kanban board with drag-drop stage columns
- Invoice list with search, filters (status, stage, customer, region, response type), bulk actions
- Invoice detail page: timeline, promise/dispute panel, "Commit to Pay" / Dispute / Record Payment buttons
- AR aging report (Current / 1-30 / 31-60 / 61-90 / 90+)
- Smart views (saved filters)
- Bulk import from CSV/Excel

### Customer Response Portal

- Token-authenticated public portal (`/portal/[token]`)
- Customers can set promise-to-pay dates and raise disputes without logging in
- Portal token issued from invoice detail or collections board
- `recomputeInvoiceState()` syncs derived invoice fields after portal submission
- "Include customer portal link" toggle added to send invoices modal

### QBO / Xero Integration

- Full OAuth flow (QBO + Xero)
- Full bidirectional sync (customers, invoices, payments, credit memos, deposits, journal entries)
- Parallel PDF fetch for invoice attachments (was serial → 20-25s; now parallel → ~8-10s ceiling)
- PDF fetch via `Promise.allSettled` (one failure doesn't abort others)
- Manual sync button added to global header (`SyncButton` component, visible on all pages)

### Email System

- Unified email sender (Gmail OAuth → Microsoft OAuth → org SMTP)
- Invoice email template (`renderInvoiceEmail`)
- Email reference tracking (`genEmailRef`)
- Send invoices modal: "Attach invoice PDF" + "Include customer portal link" toggles
- Grammar fix in default email body
- Fire-and-forget comms logging (no longer blocks send response)

### Authentication & Security

- TOTP MFA (setup, enable, disable, verify, recovery codes)
- AES encryption for MFA secrets + OAuth tokens + SMTP passwords at rest
- OAuth CSRF protection (state tokens) for QBO, Xero, Gmail, Microsoft
- Rate limiting on login (10 attempts / 900s)
- Rep scoping (`getRepScope`) — reps see only their portfolio
- `requireOrg()` re-validates user on every request

### Stage System

- Stage customization (rename, recolor, reorder, add custom stages)
- Locked stages: New, Promised, Disputed, Closed (cannot rename/delete/hide)
- **Terminology rename: "Promised" → "Committed"** (display label only; DB key stays `"Promised"`)
  - `lib/stages.ts`: default label changed, `ensureLockedStages` migrates existing orgs
  - Settings page info banner updated
  - Invoice detail "Promise" button → "Commit to Pay"
  - Rep portal badges: "📅 Promised" → "📅 Committed"
  - Rep portal detail: "Promised payment by" → "Committed to pay by"
  - Audit export: "Promise to Pay" → "Committed to Pay", "Promise date:" → "Commitment date:"
  - AI chat knowledge updated

### Admin Portal

- Admin portal at `admin.primeaccountax.com` (separate from main app, clean shell)
- Removed "Admin Portal" link from app sidebar (accessed directly, not via nav)
- Leads management:
  - Lead list with status, filters, activity
  - "Seed defaults" button (6 stage email templates + 1 drip sequence, idempotent)
  - Email compose with template selector
  - Drip sequence enrollment (multi-step with delay tracking)
  - "Mark as Replied" — stops all active sequences, logs note, advances status
  - Bulk import
- Subscriptions: manual + Stripe, approve/reject cancellations
- Cancellation workflow (admin-review only, never auto)
- Temp access overrides

### UI / UX

- `SyncButton` component in global header (before org switcher, all pages)
  - Detects QBO or Xero on mount via GET status endpoint
  - POST to trigger manual sync with feedback notice
- `SubscriptionGate` wraps all app pages
- Dark theme throughout (stone-950 base)
- Mobile-responsive sidebar (slide-in with backdrop)

### Bug Fixes

- `await` inside non-async setState callbacks → extracted before setState call
- Serial PDF fetch loop → parallel `Promise.allSettled`
- Vercel cron hourly schedule (`0 * * * *`) → daily (`0 8 * * *`) to comply with Hobby plan

---

---

## 19. Procurement & Payables Module

### Overview

- **Department navigation:** The app sidebar includes a Receivables / Payables switcher. Payables uses a **violet accent color (`#8b5cf6`)**. Receivables uses emerald.
- **URL structure:** All payables pages live under `/payables/*`.
- **System of record principle:** Ledger owns workflow, approvals, and audit trail. QBO/Xero own the accounting records. Ledger does not duplicate accounting state — it decorates it.
- **Core workflow:**

```
Purchase Request → Purchase Order (approved) → Push to QBO/Xero
  → Bill synced back → Bill approved in Ledger
  → Approval note pushed to QBO/Xero → Payment Run
```

---

### New Database Tables

All tables defined in `db/schema.ts`. Migration: `db/migrations/0005_payables_module.sql`.

| Table | Description |
|---|---|
| `ap_suppliers` | Vendor/supplier master record (synced from QBO Vendors or Xero Contacts) |
| `ap_supplier_contacts` | Individual contacts at a supplier |
| `ap_accounts` | Chart of accounts entries relevant to AP (synced from QBO COA or Xero Accounts) |
| `ap_items` | Products/services used on PO and bill lines (synced from QBO Items or Xero Items) |
| `ap_tax_rates` | Tax rate definitions (synced from QBO TaxRates or Xero TaxRates) |
| `ap_dimensions` | Cost dimensions for line-item allocation (QBO Class+Dept or Xero TrackingCategories) |
| `purchase_requests` | Internal purchase requests raised by staff before a PO is created |
| `purchase_orders` | Purchase orders sent to suppliers (has workflow lifecycle) |
| `purchase_order_lines` | Individual line items on a purchase order |
| `ap_bills` | Supplier bills synced from QBO/Xero; carry both `workflowStatus` (Ledger-owned) and `accountingPaymentStatus` (QBO/Xero-owned) |
| `ap_bill_lines` | Individual line items on a bill |
| `ap_approvals` | Approval decision records (approved/rejected) for POs and bills |
| `ap_workflow_rules` | Configurable approval threshold rules (e.g. POs over £X require sign-off) |
| `ap_supplier_queries` | Queries raised against a supplier/bill that pause payment readiness |
| `payment_runs` | Grouped payment run batches |
| `payment_run_items` | Individual bill-payment allocations within a payment run |

---

### AP Sync Libraries

**`lib/qbo-ap-sync.ts`** — `runQboApSync(orgId, userId)`

Syncs the following from QBO into the AP tables:
- Vendors → `ap_suppliers`
- Chart of Accounts → `ap_accounts`
- Items → `ap_items`
- TaxRates → `ap_tax_rates`
- Class + Dept → `ap_dimensions`
- Bills → `ap_bills` + `ap_bill_lines`

**`lib/xero-ap-sync.ts`** — `runXeroApSync(orgId, userId)`

Same sync for Xero:
- Contacts → `ap_suppliers`
- Accounts → `ap_accounts`
- Items → `ap_items`
- TaxRates → `ap_tax_rates`
- TrackingCategories → `ap_dimensions`
- ACCPAY invoices → `ap_bills` + `ap_bill_lines`

**Trigger:** `POST /api/payables/sync`

**State preservation rule:** Bills that already have a non-default `workflowStatus` are **NOT reset on re-sync**. Workflow state owned by Ledger is always preserved across sync runs.

---

### API Routes

All routes are under `/api/payables/`. All routes call `requireOrg()`. Write operations require `company_admin` or `super_admin`.

| Route | Methods | Description |
|---|---|---|
| `/api/payables/dashboard` | GET | AP stats, aging summary, pending approval tasks |
| `/api/payables/sync` | POST | Trigger AP sync (QBO or Xero, whichever is connected) |
| `/api/payables/import` | POST | CSV import for suppliers or POs |
| `/api/payables/suppliers` | GET, POST | List / Create suppliers |
| `/api/payables/suppliers/[id]` | GET, PATCH, DELETE | Supplier detail CRUD |
| `/api/payables/purchase-requests` | GET, POST | List / Create purchase requests |
| `/api/payables/purchase-requests/[id]` | GET, PATCH | PR detail; actions: submit, approve, reject, convert-to-po |
| `/api/payables/purchase-orders` | GET, POST | List / Create purchase orders |
| `/api/payables/purchase-orders/[id]` | GET, PATCH | PO detail with editable lines; actions: submit, approve, reject, push (to QBO/Xero) |
| `/api/payables/bills` | GET, POST | List / Create bills |
| `/api/payables/bills/[id]` | GET, PATCH | Bill detail; actions: approve, reject, hold, ready-for-payment, push-approval-note |
| `/api/payables/approval-inbox` | GET | Pending approvals for the current authenticated user |
| `/api/payables/supplier-queries` | GET, POST | List / Create supplier queries |
| `/api/payables/supplier-queries/[id]` | GET, PATCH | Query detail (resolve/close query) |
| `/api/payables/payment-runs` | GET, POST | List / Create payment runs |
| `/api/payables/payment-runs/[id]` | GET, PATCH | Payment run detail; actions: approve, schedule |
| `/api/payables/reports/ap-aging` | GET | AP aging report (by supplier, by bucket) |
| `/api/payables/reports/cash-requirements` | GET | Upcoming cash requirements forecast |
| `/api/payables/reports/supplier-performance` | GET | Supplier performance metrics (stub) |
| `/api/payables/workflow-rules` | GET, POST | List / Create approval threshold rules |
| `/api/payables/workflow-rules/[id]` | GET, PATCH, DELETE | Workflow rule CRUD |
| `/api/payables/sync-master-data` | POST | Sync only master data (suppliers, accounts, items, taxes, dimensions) without re-syncing bills |

---

### Pages

All pages are under `/payables/`.

| Page | Route | Description |
|---|---|---|
| `dashboard` | `/payables/dashboard` | AP health stats, aging buckets, pending approval tasks widget |
| `suppliers` | `/payables/suppliers` | Supplier list with search and filters |
| `suppliers/[id]` | `/payables/suppliers/[id]` | Supplier detail (contacts, bills, POs, queries) |
| `purchase-requests` | `/payables/purchase-requests` | Purchase request list with lifecycle status |
| `purchase-requests/[id]` | `/payables/purchase-requests/[id]` | PR detail with approval actions and convert-to-PO |
| `purchase-orders` | `/payables/purchase-orders` | Purchase order list |
| `purchase-orders/[id]` | `/payables/purchase-orders/[id]` | PO detail with editable line items and push-to-accounting action |
| `bills` | `/payables/bills` | Bill list with workflow status filters |
| `bills/[id]` | `/payables/bills/[id]` | Bill approval workflow (approve, reject, hold, ready-for-payment, push note) |
| `workspace` | `/payables/workspace` | Kanban board with 6 workflow status columns |
| `approval-inbox` | `/payables/approval-inbox` | All pending approvals assigned to the current user |
| `supplier-queries` | `/payables/supplier-queries` | Supplier query management (open queries pause payment readiness) |
| `payment-runs` | `/payables/payment-runs` | Payment run list |
| `payment-runs/[id]` | `/payables/payment-runs/[id]` | Payment run detail with bill allocations and approve/schedule actions |
| `reports` | `/payables/reports` | AP aging, cash requirements, supplier performance |
| `workflow-rules` | `/payables/workflow-rules` | Approval threshold rule configuration |
| `tasks` | `/payables/tasks` | AP-specific action items |
| `imports` | `/payables/imports` | CSV import for suppliers and POs |
| `settings` | `/payables/settings` | AP settings, sync status, workflow rule overview |

---

### Key Business Rules

- **Only APPROVED POs** can be pushed to QBO/Xero. Draft, rejected, and pending-approval POs cannot be pushed.
- **Bills with open supplier queries CANNOT be marked Ready for Payment.** The query must be resolved first.
- **Bills on hold CANNOT be added to payment runs.**
- **Ledger does NOT perform PO-to-bill matching.** The accountant performs matching inside QBO/Xero. Ledger only approves the bill after it syncs back.
- **Approval note pushed to QBO/Xero is a short reference only** (e.g. "Approved in Ledger by Jane Doe on 2026-06-15"). The full workflow history stays in Ledger.
- **`workflowStatus` is owned by Ledger** — set and protected by Ledger's approval workflow. Re-sync never resets it.
- **`accountingPaymentStatus` is owned by QBO/Xero** — reflects the payment state in the accounting system. Ledger reads but never writes this field.

---

### Audit Events Added

All new event types are registered in `lib/audit.ts`:

| Event Type | Description |
|---|---|
| `ap_supplier_created` | New supplier added |
| `ap_supplier_updated` | Supplier record updated |
| `ap_pr_created` | Purchase request created |
| `ap_pr_submitted` | PR submitted for approval |
| `ap_pr_approved` | PR approved |
| `ap_pr_rejected` | PR rejected |
| `ap_pr_converted` | PR converted to a purchase order |
| `ap_po_created` | Purchase order created |
| `ap_po_submitted` | PO submitted for approval |
| `ap_po_approved` | PO approved |
| `ap_po_rejected` | PO rejected |
| `ap_po_pushed` | PO pushed to QBO/Xero |
| `ap_bill_approved` | Bill approved in Ledger |
| `ap_bill_rejected` | Bill rejected in Ledger |
| `ap_bill_held` | Bill placed on hold |
| `ap_bill_ready` | Bill marked ready for payment |
| `ap_bill_note_pushed` | Approval note pushed to QBO/Xero |
| `ap_query_created` | Supplier query raised |
| `ap_query_resolved` | Supplier query resolved |
| `ap_payment_run_created` | Payment run created |
| `ap_payment_run_approved` | Payment run approved |
| `ap_payment_run_scheduled` | Payment run scheduled |
| `ap_sync_completed` | AP sync run completed |
| `ap_workflow_rule_changed` | Approval threshold rule created or updated |

---

### Security

- All AP tables include `orgId` as a required FK — all data is org-scoped.
- `requireOrg()` is called on every AP API route without exception.
- Write operations (POST, PATCH, DELETE) on AP routes require `company_admin` or `super_admin` role.
- AP routes are under `/api/payables/` (not `/api/admin/`) so that `company_admin` users can access them directly without needing super admin privileges.

---

*Last updated: 2026-06-15*
