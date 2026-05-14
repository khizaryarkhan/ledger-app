import { pgTable, text, varchar, integer, real, timestamp, boolean, jsonb, uuid, uniqueIndex } from "drizzle-orm/pg-core";
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
  txnType: varchar("txn_type", { length: 32 }).default("Invoice"),
  paidAt: varchar("paid_at", { length: 16 }), // Date payment was received (YYYY-MM-DD) — NULL if unpaid
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (t) => ({
  // qboId is unique per org — prevents duplicate QBO invoices on re-sync
  orgQboIdUnique: uniqueIndex("invoices_org_qbo_id_unique")
    .on(t.orgId, t.qboId)
    .where(sql`${t.qboId} IS NOT NULL`),
}));

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
  orgQboIdUnique: uniqueIndex("payments_org_qbo_id_unique")
    .on(t.orgId, t.qboId)
    .where(sql`${t.qboId} IS NOT NULL`),
  orgCustomerIdx: uniqueIndex("payments_org_customer_date_idx")
    .on(t.orgId, t.customerId, t.txnDate),
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
  orgJournalLineUnique: uniqueIndex("je_ar_lines_org_journal_line_unique")
    .on(t.orgId, t.qboJournalId, t.qboLineId),
  orgCustomerDateIdx: uniqueIndex("je_ar_lines_org_customer_date_idx")
    .on(t.orgId, t.customerId, t.txnDate),
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
// =========================================================================
export const emailTemplates = pgTable("email_templates", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  subject: varchar("subject", { length: 512 }).notNull(),
  body: text("body").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
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
  ccEmail: varchar("cc_email", { length: 255 }),      // default CC address on every outgoing email
  ccEnabled: boolean("cc_enabled").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
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
// GMAIL TOKENS
// =========================================================================
export const gmailTokens = pgTable("gmail_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
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

// Type exports
export type User = typeof users.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type Contact = typeof contacts.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
export type Communication = typeof communications.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type EmailTemplate = typeof emailTemplates.$inferSelect;
