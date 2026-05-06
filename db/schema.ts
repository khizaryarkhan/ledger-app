import { pgTable, text, varchar, integer, real, timestamp, boolean, jsonb, primaryKey, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// =========================================================================
// ORGANISATIONS — top-level tenant isolation
// =========================================================================
export const organisations = pgTable("organisations", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 255 }).notNull(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type Organisation = typeof organisations.$inferSelect;

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  role: varchar("role", { length: 32 }).notNull().default("company_user"),
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
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
  code: varchar("code", { length: 64 }).notNull().unique(),
  country: varchar("country", { length: 64 }),
  currency: varchar("currency", { length: 8 }).notNull().default("EUR"),
  paymentTerms: integer("payment_terms").notNull().default(30),
  taxNumber: varchar("tax_number", { length: 64 }),
  riskRating: varchar("risk_rating", { length: 16 }).notNull().default("Low"),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  creditLimit: real("credit_limit"),
  accountOwnerId: uuid("account_owner_id").references(() => users.id),
  collectionOwnerId: uuid("collection_owner_id").references(() => users.id),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// CONTACTS
// =========================================================================
export const contacts = pgTable("contacts", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
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
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 255 }).notNull(),
  code: varchar("code", { length: 64 }).notNull(),
  ownerId: uuid("owner_id").references(() => users.id),
  status: varchar("status", { length: 32 }).notNull().default("Active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// =========================================================================
// INVOICES
// =========================================================================
export const invoices = pgTable("invoices", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  invoiceNumber: varchar("invoice_number", { length: 64 }).notNull().unique(),
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
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  // QBO reconciliation fields
  qboId: varchar("qbo_id", { length: 64 }),           // QBO internal ID
  qboBalance: real("qbo_balance"),                      // Balance as reported by QBO
  qboCustomerId: varchar("qbo_customer_id", { length: 64 }), // QBO customer ID (sub-customer)
  qboSyncedAt: timestamp("qbo_synced_at"),              // Last time this was synced from QBO
  txnType: varchar("txn_type", { length: 32 }).default("Invoice"), // Invoice | CreditMemo | JournalEntry
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// =========================================================================
// COMMUNICATIONS (emails + notes)
// =========================================================================
export const communications = pgTable("communications", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
  customerId: uuid("customer_id").notNull().references(() => customers.id, { onDelete: "cascade" }),
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
});

// =========================================================================
// TASKS
// =========================================================================
export const tasks = pgTable("tasks", {
  id: uuid("id").defaultRandom().primaryKey(),
  orgId: uuid("org_id").notNull().references(() => organisations.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").references(() => organisations.id, { onDelete: "cascade" }),
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
// REMINDER SCHEDULES — set by automations, processed by cron
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
// QBO SYNC LOG — audit trail for every sync
// =========================================================================
export const qboSyncLog = pgTable("qbo_sync_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  syncedAt: timestamp("synced_at").notNull().defaultNow(),
  status: varchar("status", { length: 16 }).notNull().default("success"), // success | error
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
// RELATIONS — for joins
// =========================================================================
export const customersRelations = relations(customers, ({ many, one }) => ({
  contacts: many(contacts),
  projects: many(projects),
  invoices: many(invoices),
  communications: many(communications),
  accountOwner: one(users, { fields: [customers.accountOwnerId], references: [users.id], relationName: "accountOwner" }),
  collectionOwner: one(users, { fields: [customers.collectionOwnerId], references: [users.id], relationName: "collectionOwner" }),
}));

export const contactsRelations = relations(contacts, ({ one }) => ({
  customer: one(customers, { fields: [contacts.customerId], references: [customers.id] }),
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  customer: one(customers, { fields: [projects.customerId], references: [customers.id] }),
  owner: one(users, { fields: [projects.ownerId], references: [users.id] }),
  invoices: many(invoices),
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

// =========================================================================
// QBO INTEGRATION — stores OAuth tokens per user
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
// GMAIL INTEGRATION
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
