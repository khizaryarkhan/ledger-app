// What PAX Console knows about Prime Accountax before the user says a word.
//
// A model given only a list of endpoint paths cannot know what the app calls
// things, where a fact lives, or that one endpoint returns every invoice. An
// earlier test with a general model showed exactly that: asked for receivables
// "by stage" it concluded stage was not a field (it is, on every invoice), asked
// for payments it checked three sample customers, and asked whether it could see
// QuickBooks it explained the limits instead of looking. This file is the
// vocabulary, the recipes for the questions people actually ask, and the habits
// that stop a model asking when it could look.
//
// Pure: no db, no network. Kept short on purpose — it is read on every message.

/** The app's own words. Each line is one fact a model would otherwise guess. */
export const GLOSSARY: readonly string[] = [
  "Stage: every invoice has one collection stage (the invoice field collectionStage; each organisation names its own stages). Richer states sit on top of it: Escalated (escalatedToName, with an escalationType such as Handed Over, Final Account, Retention or Legal), Disputed (disputeReason), Committed (promiseDate), and Broken commitment when a promise date has passed.",
  "Escalation means an invoice has been handed to a named person. \"Receivables by escalation\" means open balance grouped by stage, escalated person or escalation type, not a list of people.",
  "Receivables are open invoices (plus credit memos and journals, shown as negative). Open balance is what is still unpaid. A deleted invoice is never receivable, and an invoice dated after the as-at date is not receivable yet.",
  "Ageing buckets are by days past the due date: Current, 1-30, 31-60, 61-90, 90+.",
  "Customer, then Project: a project belongs to exactly one customer, and an invoice may carry a project.",
  "Data in the app is mirrored from QuickBooks Online or Xero (or held natively). It is current to the last sync, and payments reach the app within minutes through webhooks and fully overnight. For live QuickBooks, admins have the qbo_api tool.",
];

/** Common questions and the shortest correct way to answer each. */
export const RECIPES: readonly string[] = [
  "Receivables by stage, by escalation, by customer, by bucket or by currency: analyze with dataset receivables and groupBy stage | escalated_to | escalation_type | customer | project | bucket | currency | disputed.",
  "Overdue invoices of one customer, or all escalated invoices, or disputed ones: analyze receivables with filters (customer, stage, escalatedTo, disputed, minDaysPastDue); it returns the largest items with their invoice numbers.",
  "Payments received today, this week or in a range: analyze with dataset payments and from / to (YYYY-MM-DD), optionally groupBy day | customer | method. For QuickBooks live, use qbo_api query on Payment.",
  "Ageing summary: analyze receivables groupBy bucket (or api_get /api/reports/ar-aging with asOf for the full report).",
  "One customer's activity: find the customer, then api_get /api/customers/{id}/transactions. Their balance: /api/customers/{id}/balance.",
  "Bills and suppliers: api_get /api/payables/bills (dueBefore, dueAfter, supplierId, workflowStatus) and /api/payables/suppliers; supplier history at /api/payables/suppliers/{id}/transactions.",
  "Profit and loss, balance sheet, trial balance: api_get /api/financials with statement (profit-loss, balance-sheet, trial-balance, general-ledger) plus from and to, or asOf.",
  "Tasks, emails and notes on a customer or invoice: /api/tasks and /api/communications with customerId or invoiceId; an invoice's history is /api/invoices/{id}/timeline.",
  "People who can receive escalations: /api/org/escalate-targets.",
  "Anything else: list_api_routes with one word from the topic (for example payables, resources, inventory), then api_get.",
];

/** Habits. The first two exist because a model asked the user instead of looking. */
export const EXPLORE_RULES: readonly string[] = [
  "Look before you ask. Try the most likely recipe or endpoint first, and ask the user only after two lookups have failed to answer. Never ask a question you could settle by reading.",
  "/api/invoices and /api/customers return every record with no filter. Never read them to count or total; use analyze, which sums on the server.",
  "When you are unsure what fields a route returns, read one row with api_get and limit 1, and use the field names you see.",
  "Say which source you used and how current it is. If a figure may be missing because the data has not synced, say so and offer the live QuickBooks check for admins.",
];
