import type { GuideContent } from "@/components/guide";

// Built-in guide content. Used to seed the editable guide_pages rows and as a
// fallback when the DB row (or table) is missing. Icons are stored as NAMES
// resolved by GUIDE_ICONS in components/guide.tsx.

export const DEFAULT_CUSTOMER_GUIDE: GuideContent = {
  title: "User Guide",
  subtitle: "Everything you need to run receivables in Prime Accountax — from connecting your accounting system to automating collections and reading your reports.",
  sections: [
    {
      id: "getting-started", title: "Getting started", icon: "Rocket",
      intro: "Prime Accountax is an accounts-receivable platform that connects to your accounting system, pulls in every customer and invoice, and automates the work of getting paid. This guide walks through each area of the app.",
      blocks: [
        { type: "subhead", text: "Connect your accounting system" },
        { type: "steps", items: [
          "Open <b>Settings</b> from the bottom of the left sidebar.",
          "Under <b>Integrations</b>, choose your provider — <b>QuickBooks Online</b> or <b>Xero</b> (Sage is marked <i>Coming Soon</i>).",
          "Sign in to your provider and authorise Prime Accountax. You are redirected back when it's done.",
          "The first sync runs automatically and imports your full history — customers, invoices, payments and credit notes.",
        ] },
        { type: "callout", tone: "info", text: "The first connection does a full historical import, so it can take a few minutes on large files. Every sync after that is incremental and fast." },
        { type: "figure", title: "Integrations panel in Settings", where: "/settings → Integrations", caption: "Connect / disconnect QuickBooks or Xero and see last-sync status." },
        { type: "subhead", text: "Receivables vs Payables" },
        { type: "p", text: "The switcher at the top of the sidebar toggles between the Receivables (money owed to you) and Payables (money you owe) departments. Most of this guide covers Receivables; Payables is summarised near the end." },
      ],
    },
    {
      id: "dashboard", title: "Dashboard", icon: "LayoutDashboard",
      intro: "Your at-a-glance view of receivables health, refreshed from your accounting system on every sync.",
      blocks: [
        { type: "bullets", items: [
          "<b>Total AR / Open</b> — the authoritative outstanding balance, summed from each invoice's live provider balance.",
          "<b>Overdue</b> — balance past its due date, with the number of overdue invoices.",
          "<b>Open Invoices</b> — count of unpaid invoices across your active customers.",
          "<b>Avg Days Outstanding</b> — how long invoices take to get paid, with the quarter-on-quarter trend.",
        ] },
        { type: "p", text: "Below the KPIs, the <b>Collections trend</b> chart shows money collected over time, and the <b>Aging summary</b> breaks your balance into Current, 1–30, 31–90 and 90+ day buckets." },
        { type: "figure", title: "Dashboard — KPIs, collections trend, aging summary", where: "/dashboard", caption: "All figures reconcile to your accounting system's aged-receivables report." },
        { type: "callout", tone: "tip", text: "Numbers look off? Run a sync (top-right). The dashboard reflects the last successful sync, not live edits made in QuickBooks/Xero a moment ago." },
      ],
    },
    {
      id: "invoices-customers", title: "Invoices, Customers & Projects", icon: "FileText",
      intro: "The Sales section holds the records pulled from your accounting system.",
      blocks: [
        { type: "subhead", text: "Invoices" },
        { type: "p", text: "Every invoice with its status (Paid, Open, Overdue), amount, outstanding balance and due date. The balance shown is the authoritative balance from your provider, so it always matches your books. Open an invoice to see line items, linked payments and the full activity history." },
        { type: "figure", title: "Invoices list", where: "/invoices", caption: "Filter by status; the badge count in the sidebar tracks unpaid invoices." },
        { type: "subhead", text: "Customers" },
        { type: "p", text: "Each customer with their total outstanding balance, contact details and invoice history. Open a customer to see their aging, their invoices and the contacts you reach when chasing payment." },
        { type: "subhead", text: "Projects" },
        { type: "p", text: "If you bill by project, this groups invoices and balances by project so you can see what each engagement still owes." },
      ],
    },
    {
      id: "collections", title: "Collections Board", icon: "Kanban",
      intro: "A Kanban view of who owes what and what to do next — drag invoices through your collection stages.",
      blocks: [
        { type: "bullets", items: [
          "Columns represent collection stages (e.g. due soon, overdue, promised to pay, escalated).",
          "Drag a card to move an invoice between stages as the situation changes.",
          "Open a card to log a call, record a promise-to-pay date, or send a reminder.",
        ] },
        { type: "figure", title: "Collections Board (Kanban)", where: "/board", caption: "Work the board top-to-bottom each day to keep cash moving." },
      ],
    },
    {
      id: "automations", title: "Automations & reminders", icon: "Zap",
      intro: "Set up reminder sequences once and let Prime Accountax chase invoices for you — politely, on your schedule.",
      blocks: [
        { type: "steps", items: [
          "Go to <b>Automations</b> and create a reminder sequence (e.g. a friendly nudge before due date, a firmer note at 7 and 30 days overdue).",
          "Write each step's email, using merge fields for the customer name, invoice number and amount.",
          "Choose which invoices the sequence applies to and activate it.",
          "Reminders then send automatically; replies land in Customer Responses.",
        ] },
        { type: "callout", tone: "warn", text: "Sequences pause automatically once an invoice is paid, so customers never get chased for money they've already sent." },
        { type: "figure", title: "Automations — reminder sequence editor", where: "/automations", caption: "Multi-step email sequences with delays and merge fields." },
      ],
    },
    {
      id: "responses", title: "Responses, Notes & Tasks", icon: "MessageSquare",
      intro: "Everything customers say back, and everything you need to follow up on, in one place.",
      blocks: [
        { type: "bullets", items: [
          "<b>Customer Responses</b> — replies to your reminders that need attention (e.g. a query, a dispute, a promise to pay). The red badge shows how many are waiting.",
          "<b>Communication Notes (Inbox)</b> — the log of inbound and outbound messages tied to each customer and invoice.",
          "<b>Tasks</b> — follow-ups assigned to you or your team, with due dates.",
        ] },
        { type: "figure", title: "Customer Responses queue", where: "/responses", caption: "Triage replies here so nothing slips through the cracks." },
      ],
    },
    {
      id: "insights", title: "Insights & Reports", icon: "BarChart3",
      intro: "Understand performance and export the numbers your accountant needs.",
      blocks: [
        { type: "bullets", items: [
          "<b>Smart Views</b> — saved, filtered slices of your receivables (e.g. \"90+ days, over €5k\").",
          "<b>Performance</b> — collection KPIs and trends over time.",
          "<b>Reports</b> — Sales and Aged-Receivables reports for any period, exportable to CSV.",
        ] },
        { type: "figure", title: "Reports with period filter and CSV export", where: "/reports", caption: "Aged receivables and sales reports reconcile to your accounting system." },
      ],
    },
    {
      id: "payables", title: "Payables (Accounts Payable)", icon: "Package",
      intro: "Switch the sidebar to Payables to manage money you owe suppliers.",
      blocks: [
        { type: "bullets", items: [
          "<b>Purchase Orders, Bills, Suppliers</b> — your payables records.",
          "<b>Workspace & Approval Inbox</b> — route bills for approval before payment.",
          "<b>Supplier Queries, Payment Runs, Workflow Rules</b> — manage supplier questions, batch payments, and automate approval routing.",
        ] },
        { type: "figure", title: "Payables dashboard", where: "/payables/dashboard", caption: "Use the Receivables/Payables switcher at the top of the sidebar." },
      ],
    },
    {
      id: "sync", title: "Syncing & reconciliation", icon: "RefreshCw",
      intro: "How Prime Accountax keeps in step with your accounting system.",
      blocks: [
        { type: "p", text: "The <b>Sync</b> button (top-right of any screen) pulls the latest changes. Incremental syncs are driven by each record's <b>last-modified date</b>, so edits to old invoices — a late payment, a void, a credit note — are always picked up, not just newly-dated transactions." },
        { type: "p", text: "A <b>Full Sync</b> re-imports your entire history. Use it after large changes in your accounting system or if you ever suspect a figure is stale. It takes longer but is safe to run any time — records are matched by ID, so nothing is duplicated." },
        { type: "callout", tone: "tip", text: "Day-to-day you never need Full Sync — the automatic incremental sync keeps everything current. Reach for it only to force a complete refresh." },
        { type: "figure", title: "Sync button and last-sync indicator", where: "Top bar → Sync", caption: "Incremental by default; Full Sync available for a complete refresh." },
      ],
    },
    {
      id: "settings", title: "Settings & Imports", icon: "Settings",
      intro: "Configure your workspace.",
      blocks: [
        { type: "bullets", items: [
          "<b>Integrations</b> — connect or disconnect QuickBooks / Xero.",
          "<b>Branding</b> — upload your logo and display name; they appear in the app and on customer-facing emails.",
          "<b>Team & roles</b> — invite colleagues and set their access.",
          "<b>Imports</b> — bring in data from spreadsheets where needed.",
        ] },
        { type: "figure", title: "Settings — branding and integrations", where: "/settings", caption: "Your logo here also brands reminder emails to customers." },
      ],
    },
    {
      id: "roles", title: "Roles & access", icon: "ShieldCheck",
      intro: "Prime Accountax keeps everyone aligned around the same real-time view, with access scoped to each role.",
      blocks: [
        { type: "bullets", items: [
          "<b>Customer</b> — views and pays their own invoices via the payment portal.",
          "<b>Accountant / Admin</b> — full access to receivables, automations and reports.",
          "<b>Project Manager</b> — visibility into the invoices and balances for their projects.",
          "<b>Rep</b> — sees the accounts they own and the collection activity on them.",
        ] },
        { type: "callout", tone: "info", text: "Don't see a section described here? It may be hidden for your role, or your workspace may not have that module enabled. Contact your administrator." },
      ],
    },
  ],
};

export const DEFAULT_ADMIN_GUIDE: GuideContent = {
  title: "Admin & Sales Guide",
  subtitle: "How to run sales and billing in the Prime Accountax admin portal — leads and sequences, creating Stripe invoices, subscriptions, discounts and tax.",
  sections: [
    {
      id: "overview", title: "Overview", icon: "LayoutDashboard",
      intro: "The Admin Portal (admin.primeaccountax.com) is your internal command centre — it runs sales and billing for Prime Accountax itself. This guide covers each area. Access is restricted to platform administrators.",
      blocks: [
        { type: "p", text: "The <b>Overview</b> page summarises the business: active customers, revenue, open leads and recent activity. Use it as your daily starting point, then jump into Leads to sell and Customers to bill." },
        { type: "callout", tone: "info", text: "Onboarding is sales-led: we create and share the first invoice ourselves, so the public site no longer offers self-signup. The whole funnel runs through this portal." },
        { type: "figure", title: "Admin Overview dashboard", where: "/admin", caption: "Top-line metrics for the platform business." },
      ],
    },
    {
      id: "leads", title: "Leads — the sales CRM", icon: "Flame",
      intro: "A full sales workspace for capturing, qualifying and closing leads, built to be worked every day.",
      blocks: [
        { type: "subhead", text: "Sales command centre" },
        { type: "p", text: "The panel at the top of the Leads page shows this-week metrics (new leads, emails sent, won), your <b>action queue</b> (tasks due today and overdue), <b>hot leads</b> to work first, the pipeline funnel, and a team leaderboard. Click any item to jump straight to that lead." },
        { type: "figure", title: "Leads — Sales command centre", where: "/admin/leads (top panel)", caption: "Metrics, today's action queue, hot leads, pipeline and leaderboard." },
        { type: "subhead", text: "List & Board views" },
        { type: "bullets", items: [
          "Toggle <b>List</b> / <b>Board</b> at the top-right of the table.",
          "<b>List</b> has per-column filters (name, email, service, status, source) so you can slice the pipeline fast.",
          "<b>Board</b> is a Kanban (New → Contacted → Qualified → Won → Lost). Drag a card to change its status; use <b>Log</b> on a card to record a call outcome, which sets the status and schedules the next follow-up in one step.",
        ] },
        { type: "figure", title: "Leads — Board (Kanban) with disposition logging", where: "/admin/leads → Board", caption: "Drag to move stages; log a call to auto-set status and next step." },
        { type: "subhead", text: "Email sequences" },
        { type: "steps", items: [
          "On any lead row, use the <b>Sequence</b> column to apply an active sequence, or <b>Stop</b> a running one.",
          "Manage sequences from the <b>Sequences</b> dialog: create one, then add or <b>edit</b> steps (subject, body and the delay before each step).",
          "Use the seed button to load the default Prime Accountax nurture sequence and stage templates if you're starting fresh.",
        ] },
        { type: "callout", tone: "tip", text: "Stopping a sequence keeps the lead's history. You can re-apply the same sequence later — it picks up cleanly without duplicating anything." },
        { type: "figure", title: "Sequences dialog with editable steps", where: "/admin/leads → Sequences", caption: "Per-step subject, body and delay; edit in place." },
      ],
    },
    {
      id: "customers", title: "Customers (billing)", icon: "Building2",
      intro: "Every paying organisation, with its billing relationship to Stripe.",
      blocks: [
        { type: "bullets", items: [
          "A sortable, filterable data grid of all customers with status, plan/MRR and key dates; exportable to CSV.",
          "Open a customer for the detail view: <b>Invoices</b>, <b>Payments</b> and <b>Credit Notes</b> tabs, plus their MRR and lifetime stats.",
          "From the detail view you can change a subscription's price/plan and see the full billing record.",
        ] },
        { type: "figure", title: "Customers data grid", where: "/admin/customers", caption: "Sort, filter per column, export to CSV." },
        { type: "figure", title: "Customer billing detail", where: "/admin/customers/[org]", caption: "Invoices, payments, credit notes and plan management for one customer." },
      ],
    },
    {
      id: "billing", title: "Creating & managing invoices", icon: "Receipt",
      intro: "The billing cockpit issues real Stripe invoices and keeps Stripe as the single source of truth — billing state is never edited by hand.",
      blocks: [
        { type: "subhead", text: "Create an invoice" },
        { type: "steps", items: [
          "Choose the customer and enter the line item(s) and amount.",
          "Select the customer's <b>country</b> (any country) — this sets the Stripe address used for tax.",
          "Optionally apply a <b>coupon / discount code</b>.",
          "Pick <b>one-off</b> or <b>recurring (subscription)</b>. For recurring, the first invoice is created and shared with the customer; once they pay, the same amount is charged automatically each period from their saved card.",
          "Finalise and share the hosted invoice link with the customer.",
        ] },
        { type: "callout", tone: "warn", text: "Stripe is the source of truth. Create, void, refund and collect through this cockpit — never change billing state directly, so the portal and Stripe never disagree." },
        { type: "figure", title: "Create invoice — country, discount, recurring", where: "/admin (billing cockpit)", caption: "One-off or auto-charging subscription, with country for tax." },
        { type: "subhead", text: "The invoice ledger" },
        { type: "bullets", items: [
          "A history of every invoice with status, amount, received date, payment date and billing cadence (one-off / monthly / annual).",
          "<b>Void</b> an unsent/uncollected invoice, <b>refund</b> a paid one, or <b>mark received</b> for payments taken out-of-band (recording how it was received).",
          "Refunding a subscription invoice also cancels the underlying subscription, so a refunded customer doesn't stay active.",
        ] },
        { type: "figure", title: "Invoice ledger with actions", where: "/admin (invoices)", caption: "Void / refund / mark-received, with received and payment dates." },
      ],
    },
    {
      id: "subscriptions", title: "Subscriptions", icon: "CreditCard",
      intro: "All recurring billing relationships in one place.",
      blocks: [
        { type: "bullets", items: [
          "See each subscription's plan, amount, status and customer.",
          "<b>Change price/plan</b> (swaps the subscription item with proration) or <b>cancel</b> a subscription.",
          "Subscriptions and the invoice ledger are linked, so you can trace a recurring charge back to its subscription and vice-versa.",
        ] },
        { type: "figure", title: "Subscriptions list", where: "/admin/subscriptions", caption: "Plan, amount, status; change price or cancel." },
      ],
    },
    {
      id: "discounts", title: "Discounts & coupons", icon: "Percent",
      intro: "Manage the coupons and promotion codes you apply when quoting customers.",
      blocks: [
        { type: "bullets", items: [
          "Create coupons (percentage or fixed amount) and generate shareable promotion codes.",
          "Toggle codes on/off and delete coupons you no longer offer.",
          "Apply a coupon when creating an invoice (see Billing).",
        ] },
        { type: "figure", title: "Discounts — coupons & promotion codes", where: "/admin/discounts", caption: "Create, toggle and manage discount codes." },
      ],
    },
    {
      id: "tax", title: "Tax (how it works)", icon: "FileText",
      intro: "A quick reference for charging tax correctly.",
      blocks: [
        { type: "p", text: "Capturing the customer's <b>country</b> on each invoice sets the Stripe customer address, which is what tax is based on. As an Irish-registered seller: a US customer is not charged tax (export of services, no US registration); EU customers fall under reverse-charge / Irish VAT rules." },
        { type: "callout", tone: "info", text: "To start charging tax in future, enable Stripe Tax and add your registrations — the country captured at invoice time is already wired in, so no rework is needed." },
      ],
    },
    {
      id: "cancellations-audit-team", title: "Cancellations, Audit Log & Team", icon: "ScrollText",
      intro: "Operational and governance tools.",
      blocks: [
        { type: "bullets", items: [
          "<b>Cancellations</b> — review churned/cancelled accounts and the reasons.",
          "<b>Audit Log</b> — a record of administrative actions for accountability.",
          "<b>Admin Team</b> — manage who has access to the portal and their role (platform_admin / super_admin).",
        ] },
        { type: "figure", title: "Audit Log", where: "/admin/audit", caption: "Traceable record of admin actions." },
      ],
    },
    {
      id: "integrations-note", title: "Sage & integrations status", icon: "RefreshCw",
      intro: "Where the accounting integrations stand.",
      blocks: [
        { type: "bullets", items: [
          "<b>QuickBooks Online</b> and <b>Xero</b> are live for customers, with incremental sync driven by each record's last-modified date.",
          "<b>Sage Intacct</b> is gated as <b>Coming Soon</b> — it requires a globally-registered Sender ID (Developer Licence) before it can go live.",
        ] },
        { type: "callout", tone: "warn", text: "Don't promise Sage on a call yet — keep it as Coming Soon until the Sender ID is registered and tested end-to-end." },
      ],
    },
  ],
};

export const DEFAULT_GUIDES: Record<string, GuideContent> = {
  customer: DEFAULT_CUSTOMER_GUIDE,
  admin: DEFAULT_ADMIN_GUIDE,
};
