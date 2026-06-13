import { pgTable, text, varchar, integer, real, timestamp, boolean, jsonb, uuid, uniqueIndex, index } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

// =========================================================================
// ORGANISATIONS
// =========================================================================
export const organisations = pgTable("organisations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  classificationLevel: varchar("classification_level", { length: 32 }).notNull().default("customer"), // 'customer' | 'project'
  colRefSeq: integer("col_ref_seq").notNull().default(0),
  dateFormat: varchar("date_format", { length: 32 }).notNull().default("DD MMM YYYY"), // date format preference
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"), // home/reporting currency
  logoUrl: text("logo_url"), // org logo URL
  displayName: varchar("display_name", { length: 255 }), // optional display name override
  stages: jsonb("stages"), // customisable collection stages array
  disabledRules: jsonb("disabled_rules").notNull().default([]), // automation rule IDs that are paused
  // Cron run tracking — updated at the end of every cron execution
  lastCronRun:   timestamp("last_cron_run"),
  lastCronStats: jsonb("last_cron_stats"), // { escalated, emailsSent, skipped, errors[] }
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type Organisation = typeof organisations.$inferSelect;

// =========================================================================
// REPS — defined before users so users can FK to reps
// =========================================================================
export const reps = pgTable("reps", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  email: varchar("email", { length: 255 }),
  tier: varchar("tier", { length: 16 }).notNull().default("rep"), // 'rep' | 'rd' | 'ed'
  managerId: uuid("manager_id").references((): any => reps.id, { onDelete: "set null" }), // ED/RD this rep reports to
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Rep = typeof reps.$inferSelect;

// =========================================================================
// REGIONS — defined before customers/projects
// =========================================================================
export const regions = pgTable("regions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
export type Region = typeof regions.$inferSelect;

// =========================================================================
// USER → ORGANISATION membership (many-to-many)
// =========================================================================
export const userOrganisations = pgTable("user_organisations", {
  id:     uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId:  uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  role:   varchar("role", { length: 32 }).notNull().default("company_user"),
});
export type UserOrganisation = typeof userOrganisations.$inferSelect;

// =========================================================================
// USERS
// =========================================================================
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 32 }).notNull().default("company_user"),
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  repId: uuid("rep_id").references(() => reps.id, { onDelete: "set null" }),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
  // TOTP multi-factor auth (currently enforced for super_admins who enrol).
  // mfaSecret is encrypted at rest (lib/crypto); recovery codes are bcrypt-hashed.
  mfaEnabled: boolean("mfa_enabled").notNull().default(false),
  mfaSecret: text("mfa_secret"),
  mfaRecoveryCodes: jsonb("mfa_recovery_codes").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// PENDING REGISTRATIONS — self-service signup before payment
// =========================================================================
export const pendingRegistrations = pgTable("pending_registrations", {
  id:               uuid("id").defaultRandom().primaryKey(),
  companyName:      varchar("company_name",  { length: 255 }).notNull(),
  adminName:        varchar("admin_name",    { length: 255 }).notNull(),
  adminEmail:       varchar("admin_email",   { length: 255 }).notNull(),
  otp:              varchar("otp",           { length: 6 }).notNull(),
  otpExpiry:        timestamp("otp_expiry").notNull(),
  emailVerified:    boolean("email_verified").notNull().default(false),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSessionId:  text("stripe_session_id"),
  // 'pending' | 'email_verified' | 'paid' | 'completed'
  status:           varchar("status", { length: 32 }).notNull().default("pending"),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
});
export type PendingRegistration = typeof pendingRegistrations.$inferSelect;

// =========================================================================
// SUBSCRIPTIONS — Stripe billing per org
// =========================================================================
export const subscriptions = pgTable("subscriptions", {
  id:                     uuid("id").defaultRandom().primaryKey(),
  orgId:                  uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  stripeCustomerId:       text("stripe_customer_id").notNull(),
  stripeSubscriptionId:   text("stripe_subscription_id"),
  stripePriceId:          text("stripe_price_id"),
  status:                 varchar("status", { length: 32 }).notNull().default("active"),
  // 'active' | 'trialing' | 'past_due' | 'cancelled' | 'unpaid' | 'incomplete' | 'incomplete_expired'
  currentPeriodStart:     timestamp("current_period_start"),
  currentPeriodEnd:       timestamp("current_period_end"),
  cancelAt:               timestamp("cancel_at"),
  cancelAtPeriodEnd:      boolean("cancel_at_period_end").notNull().default(false),
  trialEnd:               timestamp("trial_end"),
  billingEmail:           varchar("billing_email", { length: 255 }),
  planName:               varchar("plan_name", { length: 128 }),
  planAmount:             integer("plan_amount"),         // amount in pence/cents
  planInterval:           varchar("plan_interval", { length: 16 }), // 'month' | 'year'
  planCurrency:           varchar("plan_currency", { length: 8 }),
  lastPaymentStatus:      varchar("last_payment_status", { length: 32 }), // 'paid' | 'failed' | null
  lastPaymentAmount:      integer("last_payment_amount"),
  lastPaymentDate:        timestamp("last_payment_date"),
  paymentMethodBrand:     varchar("payment_method_brand", { length: 32 }), // 'visa' | 'mastercard' etc
  paymentMethodLast4:     varchar("payment_method_last4", { length: 4 }),
  stripeUpdatedAt:        timestamp("stripe_updated_at"), // last time Stripe data was synced
  createdAt:              timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_subscriptions_org_id").on(t.orgId),
]);
export type Subscription = typeof subscriptions.$inferSelect;

// =========================================================================
// CANCELLATION REQUESTS
// =========================================================================
export const cancellationRequests = pgTable("cancellation_requests", {
  id:                       uuid("id").defaultRandom().primaryKey(),
  organizationId:           uuid("organization_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  stripeCustomerId:         text("stripe_customer_id"),
  stripeSubscriptionId:     text("stripe_subscription_id"),
  requestedByUserId:        uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  requestedByEmail:         varchar("requested_by_email", { length: 255 }),
  reason:                   text("reason"),
  // 'pending' | 'approved' | 'rejected' | 'cancelled'
  status:                   varchar("status", { length: 32 }).notNull().default("pending"),
  requestedAt:              timestamp("requested_at").notNull().defaultNow(),
  reviewedAt:               timestamp("reviewed_at"),
  reviewedByAdminId:        uuid("reviewed_by_admin_id").references(() => users.id, { onDelete: "set null" }),
  // 'immediate' | '30_days' | '60_days' | '90_days' | 'period_end' | 'rejected'
  adminDecision:            varchar("admin_decision", { length: 32 }),
  cancellationEffectiveDate: timestamp("cancellation_effective_date"),
  internalNotes:            text("internal_notes"),
  stripeActionStatus:       varchar("stripe_action_status", { length: 32 }), // 'pending' | 'applied' | 'failed'
  createdAt:                timestamp("created_at").notNull().defaultNow(),
  updatedAt:                timestamp("updated_at").notNull().defaultNow(),
});
export type CancellationRequest = typeof cancellationRequests.$inferSelect;

// =========================================================================
// LANDING PAGE REQUESTS / LEADS
// =========================================================================
export const landingPageRequests = pgTable("landing_page_requests", {
  id:               uuid("id").defaultRandom().primaryKey(),
  fullName:         varchar("full_name", { length: 255 }).notNull(),
  companyName:      varchar("company_name", { length: 255 }),
  email:            varchar("email", { length: 255 }).notNull(),
  phone:            varchar("phone", { length: 64 }),
  country:          varchar("country", { length: 100 }),
  companySize:      varchar("company_size", { length: 64 }),
  interestedService: varchar("interested_service", { length: 128 }),
  message:          text("message"),
  source:           varchar("source", { length: 64 }).notNull().default("landing_page"),
  // 'new' | 'contacted' | 'qualified' | 'converted' | 'rejected' | 'archived'
  status:           varchar("status", { length: 32 }).notNull().default("new"),
  assignedToAdminId: uuid("assigned_to_admin_id").references(() => users.id, { onDelete: "set null" }),
  adminNotes:       text("admin_notes"),
  utmSource:        varchar("utm_source", { length: 128 }),
  utmMedium:        varchar("utm_medium", { length: 128 }),
  utmCampaign:      varchar("utm_campaign", { length: 128 }),
  createdAt:        timestamp("created_at").notNull().defaultNow(),
  updatedAt:        timestamp("updated_at").notNull().defaultNow(),
});
export type LandingPageRequest = typeof landingPageRequests.$inferSelect;

// =========================================================================
// BILLING AUDIT LOG
// =========================================================================
export const billingAuditLogs = pgTable("billing_audit_logs", {
  id:                     uuid("id").defaultRandom().primaryKey(),
  organizationId:         uuid("organization_id").references(() => organisations.id, { onDelete: "set null" }),
  cancellationRequestId:  uuid("cancellation_request_id").references(() => cancellationRequests.id, { onDelete: "set null" }),
  actorUserId:            uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
  actorRole:              varchar("actor_role", { length: 32 }),
  action:                 varchar("action", { length: 64 }).notNull(), // e.g. 'cancellation_requested' | 'cancellation_approved' | 'subscription_reactivated'
  previousStatus:         varchar("previous_status", { length: 32 }),
  newStatus:              varchar("new_status", { length: 32 }),
  stripeEventId:          varchar("stripe_event_id", { length: 128 }),
  stripeActionStatus:     varchar("stripe_action_status", { length: 32 }),
  metadata:               jsonb("metadata"),
  createdAt:              timestamp("created_at").notNull().defaultNow(),
});
export type BillingAuditLog = typeof billingAuditLogs.$inferSelect;

// =========================================================================
// TEMPORARY ACCESS REQUESTS
// =========================================================================
export const tempAccessRequests = pgTable("temp_access_requests", {
  id:                  uuid("id").defaultRandom().primaryKey(),
  orgId:               uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  requestedByUserId:   uuid("requested_by_user_id").references(() => users.id, { onDelete: "set null" }),
  requestedByEmail:    varchar("requested_by_email", { length: 255 }),
  reason:              text("reason"),
  // 'pending' | 'approved' | 'rejected'
  status:              varchar("status", { length: 32 }).notNull().default("pending"),
  reviewedByAdminId:   uuid("reviewed_by_admin_id").references(() => users.id, { onDelete: "set null" }),
  reviewedAt:          timestamp("reviewed_at"),
  expiresAt:           timestamp("expires_at"),   // set by admin on approval
  adminNotes:          text("admin_notes"),
  createdAt:           timestamp("created_at").notNull().defaultNow(),
  updatedAt:           timestamp("updated_at").notNull().defaultNow(),
}, (t) => [
  index("idx_temp_access_org_id").on(t.orgId),
]);
export type TempAccessRequest = typeof tempAccessRequests.$inferSelect;

// =========================================================================
// CUSTOMERS
// =========================================================================
export const customers = pgTable("customers", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  country: varchar("country", { length: 64 }),
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  paymentTerms: integer("payment_terms").notNull().default(30),
  taxNumber: varchar("tax_number", { length: 64 }),
  riskRating: varchar("risk_rating", { length: 16 }).notNull().default("Low"),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  creditLimit: real("credit_limit"),
  accountOwnerId: uuid("account_owner_id").references(() => users.id),
  collectionOwnerId: uuid("collection_owner_id").references(() => users.id),
  repId: uuid("rep_id").references(() => reps.id, { onDelete: "set null" }),
  regionId: uuid("region_id").references(() => regions.id, { onDelete: "set null" }),
  notes: text("notes"),
  phone: varchar("phone", { length: 64 }),
  email: varchar("email", { length: 255 }),
  companyName: varchar("company_name", { length: 255 }),
  addressStreet: varchar("address_street", { length: 255 }),
  addressCity: varchar("address_city", { length: 128 }),
  addressPostcode: varchar("address_postcode", { length: 32 }),
  qboId: varchar("qbo_id", { length: 64 }),
  xeroId: varchar("xero_id", { length: 64 }),   // Xero ContactID
  chaseByProject: boolean("chase_by_project").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // code is unique within an org — two orgs can share the same QBO customer code
  orgCodeUnique: uniqueIndex("customers_org_code_unique").on(t.orgId, t.code),
}));

// =========================================================================
// CONTACTS
// =========================================================================
export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  title: varchar("title", { length: 255 }),
  email: varchar("email", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 64 }),
  type: varchar("type", { length: 32 }).notNull().default("Billing"),
  isPrimary: boolean("is_primary").notNull().default(false),
  isEscalation: boolean("is_escalation").notNull().default(false),
  receivesAuto: boolean("receives_auto").notNull().default(true),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  // When to next send an automated email to this contact. NULL = send on next cron run.
  nextSendAt: timestamp("next_send_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// PROJECTS
// =========================================================================
export const projects = pgTable("projects", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  repId: uuid("rep_id").references(() => reps.id, { onDelete: "set null" }),
  regionId: uuid("region_id").references(() => regions.id, { onDelete: "set null" }),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  qboId: varchar("qbo_id", { length: 64 }), // QBO sub-customer Id
  xeroId: varchar("xero_id", { length: 64 }), // Xero tracking category / job Id (future)
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// INVOICES
// =========================================================================
export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  invoiceNumber: varchar("invoice_number", { length: 64 }).notNull(), // display only — not unique
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  invoiceDate: varchar("invoice_date", { length: 16 }).notNull(),
  dueDate: varchar("due_date", { length: 16 }).notNull(),
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  amount: real("amount").notNull(),
  taxAmount: real("tax_amount").notNull().default(0),
  total: real("total").notNull(),
  paid: real("paid").notNull().default(0),
  paymentTerms: integer("payment_terms").notNull().default(30),
  paymentStatus: varchar("payment_status", { length: 32 }).notNull().default("Unpaid"),
  collectionStage: varchar("collection_stage", { length: 64 }).notNull().default("New"),
  collectionOwnerId: uuid("collection_owner_id").references(() => users.id),
  poNumber: varchar("po_number", { length: 64 }),
  notes: text("notes"),
  disputeReason: text("dispute_reason"),
  disputeDate: varchar("dispute_date", { length: 16 }),
  promiseDate: varchar("promise_date", { length: 16 }),
  lastFollowupDate: varchar("last_followup_date", { length: 16 }),
  billingEmail: text("billing_email"), // QBO BillEmail — may contain multiple comma-separated addresses
  qboId: varchar("qbo_id", { length: 64 }), // QBO internal transaction ID — unique source of truth
  qboBalance: real("qbo_balance"),
  qboCustomerId: varchar("qbo_customer_id", { length: 64 }),
  qboSyncedAt: timestamp("qbo_synced_at"),
  xeroId: varchar("xero_id", { length: 64 }), // Xero InvoiceID / CreditNoteID
  xeroBalance: real("xero_balance"),            // AmountDue from Xero
  xeroCustomerId: varchar("xero_customer_id", { length: 64 }), // Xero ContactID
  xeroSyncedAt: timestamp("xero_synced_at"),
  xeroTenantId: varchar("xero_tenant_id", { length: 64 }), // which Xero org this came from
  txnType: varchar("txn_type", { length: 32 }).default("Invoice"),
  paidAt: varchar("paid_at", { length: 16 }), // Date payment was received (YYYY-MM-DD) — NULL if unpaid
  // ── Customer Response Portal derived/cached state ──────────────────────
  promiseAmount:     real("promise_amount"),                              // current promise amount (null = full)
  promiseSource:     varchar("promise_source", { length: 24 }),           // Customer Portal | Rep | Accountant
  hasOpenDispute:    boolean("has_open_dispute").notNull().default(false),
  automationsPaused: boolean("automations_paused").notNull().default(false), // true while a dispute is open
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // qboId is unique per org — prevents duplicate QBO invoices on re-sync
  orgQboIdUnique: uniqueIndex("invoices_org_qbo_id_unique")
    .on(t.orgId, t.qboId)
    .where(sql`${t.qboId} IS NOT NULL`),
}));

// =========================================================================
// CUSTOMER RESPONSE PORTAL
// A tokenised, no-login portal sent to customers by email. Lets them set
// promise-to-pay dates and/or raise disputes on their open invoices.
//
// Promises and disputes are modelled as first-class EVENTS (one row each)
// rather than single fields on the invoice, so we keep a full audit timeline
// and can capture multiple sources (Customer Portal / Rep / Accountant).
// The invoices table caches the current derived state for fast filtering.
// =========================================================================

// One token = one "request" covering a snapshot of the customer's open
// invoices. The customer responds once; submitting marks it Completed and the
// link dies. A new request issues a fresh token.
export const customerPortalTokens = pgTable("customer_portal_tokens", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId:  uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  token:       varchar("token", { length: 80 }).notNull().unique(), // url-safe random string
  // Snapshot of which invoice IDs this request covers (jsonb array of uuids)
  invoiceIds:  jsonb("invoice_ids").notNull().default([]),
  status:      varchar("status", { length: 16 }).notNull().default("Active"), // Active | Completed | Expired
  createdBy:   uuid("created_by").references(() => users.id, { onDelete: "set null" }), // staff who issued it (null = automation)
  expiresAt:   timestamp("expires_at").notNull(),
  lastViewedAt:timestamp("last_viewed_at"),
  completedAt: timestamp("completed_at"),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
export type CustomerPortalToken = typeof customerPortalTokens.$inferSelect;

// A promise-to-pay event. `amount` supports partial promises.
export const invoicePromises = pgTable("invoice_promises", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  invoiceId:   uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  customerId:  uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  promiseDate: varchar("promise_date", { length: 16 }).notNull(),       // YYYY-MM-DD
  amount:      real("amount"),                                          // null = full balance
  source:      varchar("source", { length: 24 }).notNull(),            // Customer Portal | Rep | Accountant
  enteredBy:   uuid("entered_by").references(() => users.id, { onDelete: "set null" }), // null when from portal
  note:        text("note"),
  status:      varchar("status", { length: 16 }).notNull().default("Active"), // Active | Met | Broken | Superseded
  tokenId:     uuid("token_id").references(() => customerPortalTokens.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
export type InvoicePromise = typeof invoicePromises.$inferSelect;

// A dispute event.
export const invoiceDisputes = pgTable("invoice_disputes", {
  id:          uuid("id").defaultRandom().primaryKey(),
  orgId:       uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  invoiceId:   uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  customerId:  uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  category:    varchar("category", { length: 32 }).notNull(), // Wrong Amount | Already Paid | Goods/Service | Duplicate | Other
  reason:      text("reason"),
  source:      varchar("source", { length: 24 }).notNull(),  // Customer Portal | Rep | Accountant
  raisedBy:    uuid("raised_by").references(() => users.id, { onDelete: "set null" }), // null when from portal
  assignedTo:  uuid("assigned_to").references(() => users.id, { onDelete: "set null" }), // owner accountable for actioning
  status:      varchar("status", { length: 16 }).notNull().default("Open"), // Open | Under Review | Resolved | Rejected
  outcome:     varchar("outcome", { length: 32 }), // Invoice corrected | Credit issued | Customer agreed to pay | Written off | Rejected
  resolution:  text("resolution"),
  resolvedBy:  uuid("resolved_by").references(() => users.id, { onDelete: "set null" }),
  resolvedAt:  timestamp("resolved_at"),
  tokenId:     uuid("token_id").references(() => customerPortalTokens.id, { onDelete: "set null" }),
  createdAt:   timestamp("created_at").notNull().defaultNow(),
});
export type InvoiceDispute = typeof invoiceDisputes.$inferSelect;

// =========================================================================
// PAYMENTS (QBO Receive Payment)
// One row per QBO Payment. The payment may apply to one or more invoices
// or credit memos via payment_applications. Used to:
//   - reconcile AR at any historical point in time
//   - compute true DSO (days from invoice to payment receipt)
//   - drive the Cash Collections report
// =========================================================================
export const payments = pgTable("payments", {
  id:                uuid("id").defaultRandom().primaryKey(),
  orgId:             uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  qboId:             varchar("qbo_id", { length: 64 }),
  customerId:        uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  qboCustomerId:     varchar("qbo_customer_id", { length: 64 }),

  // Payment header
  txnDate:           varchar("txn_date", { length: 16 }).notNull(), // YYYY-MM-DD — QBO Payment.TxnDate
  totalAmount:       real("total_amount").notNull(),
  unappliedAmount:   real("unapplied_amount").notNull().default(0),
  currency:          varchar("currency", { length: 8 }).notNull().default("EUR"),
  exchangeRate:      real("exchange_rate"), // for non-base currency; null = 1.0

  // QBO descriptive fields
  paymentMethod:     varchar("payment_method", { length: 64 }),  // e.g. "Cash", "Cheque", "EFT"
  paymentRef:        varchar("payment_ref", { length: 128 }),    // QBO PaymentRefNum (cheque number etc)
  depositAccountId:  varchar("deposit_account_id", { length: 64 }), // QBO bank account it landed in
  depositAccountName:varchar("deposit_account_name", { length: 255 }),
  privateNote:       text("private_note"),

  // Sync metadata
  qboSyncedAt:       timestamp("qbo_synced_at"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // qboId is unique per org — prevents duplicate QBO payments on re-sync.
  // NOTE: orgCustomerIdx (unique on orgId+customerId+txnDate) was removed
  // because it caused silent data loss when the same customer makes two
  // separate payments on the same day (a legitimate, common scenario).
  orgQboIdUnique: uniqueIndex("payments_org_qbo_id_unique")
    .on(t.orgId, t.qboId)
    .where(sql`${t.qboId} IS NOT NULL`),
}));
export type Payment = typeof payments.$inferSelect;

// =========================================================================
// PAYMENT_APPLICATIONS — how each payment was applied
// One row per (payment, target) where target is an invoice or credit memo.
// targetType discriminates which table the targetQboId points to.
// =========================================================================
export const paymentApplications = pgTable("payment_applications", {
  id:            uuid("id").defaultRandom().primaryKey(),
  orgId:         uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  paymentId:     uuid("payment_id").notNull().references(() => payments.id, { onDelete: "cascade" }),
  // Linked transaction — Invoice, CreditMemo, or JournalEntry. CMs live in
  // the invoices table with txn_type='CreditMemo'; JEs live in journal_entry_ar_lines.
  invoiceId:     uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  targetQboId:   varchar("target_qbo_id", { length: 64 }).notNull(), // raw QBO id of the linked txn
  targetType:    varchar("target_type", { length: 32 }).notNull(),   // "Invoice" | "CreditMemo" | "JournalEntry"
  // Sub-line identifier on the target transaction. Critical for Journal
  // Entries: a single JE can have multiple AR lines (potentially to different
  // customers). The application targets a specific line, identified by
  // Payment.Line.LinkedTxn.TxnLineId. May be null if the QBO payload omits it
  // (in which case the aging engine falls back to customer+account matching).
  targetLineId:  varchar("target_line_id", { length: 64 }),
  amountApplied: real("amount_applied").notNull(),
  createdAt:     timestamp("created_at").notNull().defaultNow(),
}, (t) => ({
  // Include targetLineId so multi-line JEs can have one application per line.
  paymentTargetUnique: uniqueIndex("payment_applications_payment_target_line_unique")
    .on(t.paymentId, t.targetQboId, t.targetType, t.targetLineId),
}));
export type PaymentApplication = typeof paymentApplications.$inferSelect;

// =========================================================================
// REFUND RECEIPTS (QBO RefundReceipt — money paid out to a customer)
// Reduces a customer's AR or unapplied credits. Less common than Payments
// but needed for accurate historical AR.
// =========================================================================
export const refundReceipts = pgTable("refund_receipts", {
  id:                uuid("id").defaultRandom().primaryKey(),
  orgId:             uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  qboId:             varchar("qbo_id", { length: 64 }),
  customerId:        uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  qboCustomerId:     varchar("qbo_customer_id", { length: 64 }),

  txnDate:           varchar("txn_date", { length: 16 }).notNull(),
  totalAmount:       real("total_amount").notNull(),
  currency:          varchar("currency", { length: 8 }).notNull().default("EUR"),

  paymentMethod:     varchar("payment_method", { length: 64 }),
  refundFromAccountId:  varchar("refund_from_account_id", { length: 64 }),
  refundFromAccountName:varchar("refund_from_account_name", { length: 255 }),
  privateNote:       text("private_note"),

  qboSyncedAt:       timestamp("qbo_synced_at"),
  createdAt:         timestamp("created_at").notNull().defaultNow(),
  updatedAt:         timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  orgQboIdUnique: uniqueIndex("refund_receipts_org_qbo_id_unique")
    .on(t.orgId, t.qboId)
    .where(sql`${t.qboId} IS NOT NULL`),
}));
export type RefundReceipt = typeof refundReceipts.$inferSelect;

// =========================================================================
// DEPOSITS — AR-affecting deposit lines.
// In QBO a Deposit transaction can include lines that post to the AR account
// for a specific customer (typical for recording funds received outside of a
// regular Payment, or recording an overpayment as a customer credit). One row
// per AR-affecting line. The `amount` is signed: negative reduces customer
// AR (customer credit on account), positive increases it.
// =========================================================================
export const deposits = pgTable("deposits", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  qboId:           varchar("qbo_id", { length: 64 }).notNull(),       // QBO Deposit.Id
  qboLineId:       varchar("qbo_line_id", { length: 64 }),            // QBO Line.Id within the Deposit

  customerId:      uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  qboCustomerId:   varchar("qbo_customer_id", { length: 64 }),

  accountId:       varchar("account_id", { length: 64 }),             // QBO AR Account.Id
  accountName:     varchar("account_name", { length: 255 }),

  txnDate:         varchar("txn_date", { length: 16 }).notNull(),     // YYYY-MM-DD
  amount:          real("amount").notNull(),                          // SIGNED — negative = AR credit
  currency:        varchar("currency", { length: 8 }).notNull().default("EUR"),

  // 'Deposit' (QBO Deposit entity) | 'Purchase' (QBO Purchase / Cheque Expense with AR line)
  txnSource:       varchar("txn_source", { length: 32 }).notNull().default("Deposit"),

  description:     text("description"),
  privateNote:     text("private_note"),

  qboSyncedAt:     timestamp("qbo_synced_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  orgQboLineUnique: uniqueIndex("deposits_org_qbo_line_unique")
    .on(t.orgId, t.qboId, t.qboLineId)
    .where(sql`${t.qboLineId} IS NOT NULL`),
}));
export type Deposit = typeof deposits.$inferSelect;

// =========================================================================
// JOURNAL ENTRY AR LINES
// One row per Journal Entry LINE that posts to the Accounts Receivable account.
// JEs are the QBO mechanism for AR write-offs, audit adjustments, inter-company
// transfers, etc. Without capturing these, customer AR balances can be wildly
// overstated (e.g. a customer with €1.5M of invoices and a -€1.5M JE
// adjustment should show ~€0 AR, not €1.5M).
//
// We store only the AR-affecting lines — full JE structure isn't needed for
// AR Aging. `amount` is signed:
//   positive = debit to AR (increases what the customer owes)
//   negative = credit to AR (decreases / writes off)
// =========================================================================
export const journalEntryArLines = pgTable("journal_entry_ar_lines", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  qboJournalId:    varchar("qbo_journal_id", { length: 64 }).notNull(),  // QBO JournalEntry.Id
  qboLineId:       varchar("qbo_line_id", { length: 64 }),               // QBO Line.Id (unique per line)
  docNumber:       varchar("doc_number", { length: 64 }),                // user-facing JE number

  customerId:      uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  qboCustomerId:   varchar("qbo_customer_id", { length: 64 }),

  accountId:       varchar("account_id", { length: 64 }),      // QBO Account.Id (AR account)
  accountName:     varchar("account_name", { length: 255 }),

  txnDate:         varchar("txn_date", { length: 16 }).notNull(), // YYYY-MM-DD
  amount:          real("amount").notNull(),                     // SIGNED: + = debit AR, - = credit AR
  currency:        varchar("currency", { length: 8 }).notNull().default("EUR"),
  exchangeRate:    real("exchange_rate"),

  description:     text("description"),
  voided:          boolean("voided").notNull().default(false),

  qboSyncedAt:     timestamp("qbo_synced_at"),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // Uniqueness is (orgId, qboJournalId, qboLineId) — the JE line is the
  // idempotency key for re-sync. orgCustomerDateIdx (unique on orgId+customerId
  // +txnDate) was removed because a single JE date can have multiple AR lines
  // for the same customer (e.g. reversal pairs), and the constraint caused
  // silent data loss on conflict.
  orgJournalLineUnique: uniqueIndex("je_ar_lines_org_journal_line_unique")
    .on(t.orgId, t.qboJournalId, t.qboLineId),
}));
export type JournalEntryArLine = typeof journalEntryArLines.$inferSelect;

// =========================================================================
// COMMUNICATIONS (emails + notes)
// =========================================================================
export const communications = pgTable("communications", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  contactId: uuid("contact_id").references(() => contacts.id, { onDelete: "set null" }),
  direction: varchar("direction", { length: 16 }).notNull(),
  channel: varchar("channel", { length: 16 }).notNull(),
  subject: varchar("subject", { length: 512 }),
  sender: varchar("sender", { length: 255 }),
  recipients: text("recipients"),
  body: text("body"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  matchedBy: varchar("matched_by", { length: 64 }),
  isDraft: boolean("is_draft").notNull().default(false),
  authorId: uuid("author_id").references(() => users.id),
  refNumber: varchar("ref_number", { length: 32 }),
  stageAtSend: varchar("stage_at_send", { length: 64 }),
});

// =========================================================================
// TASKS
// =========================================================================
export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  invoiceId: uuid("invoice_id").references(() => invoices.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 512 }).notNull(),
  description: text("description"),
  assigneeId: uuid("assignee_id").references(() => users.id),
  dueDate: varchar("due_date", { length: 16 }),
  priority: varchar("priority", { length: 16 }).notNull().default("Medium"),
  completed: boolean("completed").notNull().default(false),
  labels: jsonb("labels").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// EMAIL TEMPLATES
// One template per collection stage per org.
// subject / body support placeholders: {name} {invoiceLines} {ref}
// =========================================================================
export const emailTemplates = pgTable("email_templates", {
  id:              uuid("id").defaultRandom().primaryKey(),
  orgId:           uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  name:            varchar("name", { length: 255 }).notNull(),
  subject:         varchar("subject", { length: 512 }).notNull(),
  body:            text("body").notNull(),
  collectionStage: varchar("collection_stage", { length: 64 }),  // null = unassigned draft
  isActive:        boolean("is_active").notNull().default(true),
  // How often (in days) the cron should send this template to each contact.
  // e.g. 7 = weekly, 14 = fortnightly, 30 = monthly.
  // The cron checks the communications table to see when this contact was last auto-emailed.
  sendIntervalDays: integer("send_interval_days").notNull().default(7),
  createdAt:       timestamp("created_at").notNull().defaultNow(),
  updatedAt:       timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// REMINDER SCHEDULES
// =========================================================================
export const reminderSchedules = pgTable("reminder_schedules", {
  id: uuid("id").defaultRandom().primaryKey(),
  invoiceId: uuid("invoice_id").notNull().references(() => invoices.id, { onDelete: "cascade" }),
  scheduledFor: varchar("scheduled_for", { length: 16 }).notNull(),
  templateId: uuid("template_id").references(() => emailTemplates.id),
  status: varchar("status", { length: 32 }).notNull().default("Pending"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// AUDIT EVENTS — append-only track & trace log
// =========================================================================
export const auditEvents = pgTable("audit_events", {
  id:         uuid("id").defaultRandom().primaryKey(),
  orgId:      uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "cascade" }),
  projectId:  uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  invoiceId:  uuid("invoice_id").references(() => invoices.id, { onDelete: "set null" }),
  eventType:  varchar("event_type", { length: 32 }).notNull(),
  actorId:    uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  actorName:  varchar("actor_name", { length: 255 }),
  meta:       jsonb("meta").notNull().default({}),
  occurredAt: timestamp("occurred_at").notNull().defaultNow(),
});
export type AuditEvent = typeof auditEvents.$inferSelect;

// =========================================================================
// QBO SYNC LOG
// =========================================================================
export const qboSyncLog = pgTable("qbo_sync_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Org-scoped so every user in the org sees the same sync history. userId
  // remains for audit (which user triggered the sync) but is not the
  // visibility key.
  orgId:  uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  status: varchar("status", { length: 16 }).notNull().default("success"),
  qboTotalAR: real("qbo_total_ar"),
  ledgerTotalAR: real("ledger_total_ar"),
  difference: real("difference"),
  customersCreated: integer("customers_created").default(0),
  invoicesCreated: integer("invoices_created").default(0),
  invoicesUpdated: integer("invoices_updated").default(0),
  invoicesClosed: integer("invoices_closed").default(0),
  creditsCreated: integer("credits_created").default(0),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
});
export type QboSyncLog = typeof qboSyncLog.$inferSelect;

// =========================================================================
// QBO WEBHOOK EVENTS — every webhook delivery is logged here
// Used to detect missed events and visualise webhook health per org
// =========================================================================
export const qboWebhookEvents = pgTable("qbo_webhook_events", {
  id:               uuid("id").defaultRandom().primaryKey(),
  receivedAt:       timestamp("received_at").notNull().defaultNow(),
  realmId:          varchar("realm_id", { length: 64 }).notNull(),
  orgId:            uuid("org_id").references(() => organisations.id, { onDelete: "set null" }),
  // 'received' = signature valid, processed
  // 'invalid_signature' = HMAC mismatch, rejected
  // 'unknown_realm' = no org with that realmId
  // 'error' = sync threw an exception
  status:           varchar("status", { length: 32 }).notNull().default("received"),
  entityCount:      integer("entity_count").notNull().default(0),
  entities:         jsonb("entities"), // [{ name, id, operation }]
  errorMessage:     text("error_message"),
  processingMs:     integer("processing_ms"),
});
export type QboWebhookEvent = typeof qboWebhookEvents.$inferSelect;

// =========================================================================
// ORG SMTP SETTINGS
// =========================================================================
export const orgSmtpSettings = pgTable("org_smtp_settings", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().unique().references(() => organisations.id, { onDelete: "cascade" }),
  host: varchar("host", { length: 255 }).notNull(),
  port: integer("port").notNull().default(2525),
  user: varchar("user", { length: 255 }).notNull(),
  pass: text("pass").notNull(),
  fromEmail: varchar("from_email", { length: 255 }).notNull(),
  fromName: varchar("from_name", { length: 255 }),
  // ccEmail / ccEnabled kept for migration compat; new code reads from orgEmailSettings
  ccEmail: varchar("cc_email", { length: 255 }),
  ccEnabled: boolean("cc_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// ORG EMAIL DEFAULTS (transport-agnostic — applies to Gmail, MS, and SMTP)
// =========================================================================
export const orgEmailSettings = pgTable("org_email_settings", {
  id:        uuid("id").defaultRandom().primaryKey(),
  orgId:     uuid("org_id").notNull().unique().references(() => organisations.id, { onDelete: "cascade" }),
  ccEmail:   varchar("cc_email", { length: 500 }),
  ccEnabled: boolean("cc_enabled").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// QBO TOKENS
// =========================================================================
export const qboTokens = pgTable("qbo_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  realmId: varchar("realm_id", { length: 64 }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(),
  companyName: varchar("company_name", { length: 255 }),
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type QboToken = typeof qboTokens.$inferSelect;

// =========================================================================
// XERO SYNC LOG
// =========================================================================
export const xeroSyncLog = pgTable("xero_sync_log", {
  id:               uuid("id").defaultRandom().primaryKey(),
  orgId:            uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId:           uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  syncedAt:         timestamp("synced_at").notNull().defaultNow(),
  status:           varchar("status", { length: 16 }).notNull().default("success"),
  customersCreated: integer("customers_created").default(0),
  invoicesCreated:  integer("invoices_created").default(0),
  invoicesUpdated:  integer("invoices_updated").default(0),
  invoicesClosed:   integer("invoices_closed").default(0),
  creditsCreated:   integer("credits_created").default(0),
  errorMessage:     text("error_message"),
  durationMs:       integer("duration_ms"),
});
export type XeroSyncLog = typeof xeroSyncLog.$inferSelect;

// =========================================================================
// XERO WEBHOOK EVENTS
// =========================================================================
export const xeroWebhookEvents = pgTable("xero_webhook_events", {
  id:           uuid("id").defaultRandom().primaryKey(),
  receivedAt:   timestamp("received_at").notNull().defaultNow(),
  tenantId:     varchar("tenant_id", { length: 64 }).notNull(),
  orgId:        uuid("org_id").references(() => organisations.id, { onDelete: "set null" }),
  status:       varchar("status", { length: 32 }).notNull().default("received"),
  entityCount:  integer("entity_count").notNull().default(0),
  entities:     jsonb("entities"),
  errorMessage: text("error_message"),
  processingMs: integer("processing_ms"),
});
export type XeroWebhookEvent = typeof xeroWebhookEvents.$inferSelect;

// =========================================================================
// XERO TOKENS
// =========================================================================
export const xeroTokens = pgTable("xero_tokens", {
  id:                    uuid("id").defaultRandom().primaryKey(),
  userId:                uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId:                 uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  tenantId:              varchar("tenant_id", { length: 64 }).notNull(), // Xero organisation tenant ID
  tenantName:            varchar("tenant_name", { length: 255 }),
  accessToken:           text("access_token").notNull(),
  refreshToken:          text("refresh_token").notNull(),
  accessTokenExpiresAt:  timestamp("access_token_expires_at").notNull(),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at").notNull(), // 60-day rolling window
  createdAt:             timestamp("created_at").notNull().defaultNow(),
  updatedAt:             timestamp("updated_at").notNull().defaultNow(),
});
export type XeroToken = typeof xeroTokens.$inferSelect;

// =========================================================================
// GMAIL TOKENS
// =========================================================================
export const gmailTokens = pgTable("gmail_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Org-scoped: one Gmail connection per org. Every user in the org can
  // see whether Gmail is connected (and use it for outbound mail).
  // userId records the human who authorised it (needed for OAuth refresh).
  orgId:  uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type GmailToken = typeof gmailTokens.$inferSelect;

// =========================================================================
// MICROSOFT TOKENS
// =========================================================================
export const microsoftTokens = pgTable("microsoft_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Org-scoped: one Microsoft connection per org. Every user in the org can
  // see whether Microsoft is connected (and use it for outbound mail).
  // userId records the human who authorised it (needed for OAuth refresh).
  orgId:  uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  email: varchar("email", { length: 255 }).notNull(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  accessTokenExpiresAt: timestamp("access_token_expires_at").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type MicrosoftToken = typeof microsoftTokens.$inferSelect;

// =========================================================================
// RELATIONS
// =========================================================================
export const customersRelations = relations(customers, ({ many, one }) => ({
  contacts: many(contacts),
  projects: many(projects),
  invoices: many(invoices),
  communications: many(communications),
  accountOwner: one(users, { fields: [customers.accountOwnerId], references: [users.id], relationName: "accountOwner" }),
  collectionOwner: one(users, { fields: [customers.collectionOwnerId], references: [users.id], relationName: "collectionOwner" }),
  rep: one(reps, { fields: [customers.repId], references: [reps.id] }),
  region: one(regions, { fields: [customers.regionId], references: [regions.id] }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  customer: one(customers, { fields: [contacts.customerId], references: [customers.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  customer: one(customers, { fields: [projects.customerId], references: [customers.id] }),
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  invoices: many(invoices),
  rep: one(reps, { fields: [projects.repId], references: [reps.id] }),
  region: one(regions, { fields: [projects.regionId], references: [regions.id] }),
}));

export const invoicesRelations = relations(invoices, ({ one, many }) => ({
  customer: one(customers, { fields: [invoices.customerId], references: [customers.id] }),
  project: one(projects, { fields: [invoices.projectId], references: [projects.id] }),
  collectionOwner: one(users, { fields: [invoices.collectionOwnerId], references: [users.id] }),
  communications: many(communications),
  tasks: many(tasks),
}));

export const communicationsRelations = relations(communications, ({ one }) => ({
  customer: one(customers, { fields: [communications.customerId], references: [customers.id] }),
  invoice: one(invoices, { fields: [communications.invoiceId], references: [invoices.id] }),
  contact: one(contacts, { fields: [communications.contactId], references: [contacts.id] }),
  author: one(users, { fields: [communications.authorId], references: [users.id] }),
}));

export const tasksRelations = relations(tasks, ({ one }) => ({
  customer: one(customers, { fields: [tasks.customerId], references: [customers.id] }),
  invoice: one(invoices, { fields: [tasks.invoiceId], references: [invoices.id] }),
  assignee: one(users, { fields: [tasks.assigneeId], references: [users.id] }),
}));

// =========================================================================
// RATE LIMITS — fixed-window limiter backed by Postgres (see lib/rate-limit.ts)
// =========================================================================
export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});


// Type exports
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Communication = typeof communications.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
