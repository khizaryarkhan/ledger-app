"use client";

import { GuideLayout, type GuideSection } from "@/components/guide";
import {
  LayoutDashboard, Flame, Building2, CreditCard, Percent, FileText,
  Receipt, RefreshCw, XCircle, ScrollText, Users,
} from "lucide-react";

const SECTIONS: GuideSection[] = [
  {
    id: "overview",
    title: "Overview",
    icon: LayoutDashboard,
    intro: "The Admin Portal (admin.primeaccountax.com) is your internal command centre — it runs sales and billing for Prime Accountax itself. This guide covers each area. Access is restricted to platform administrators.",
    blocks: [
      { type: "p", text: "The <b>Overview</b> page summarises the business: active customers, revenue, open leads and recent activity. Use it as your daily starting point, then jump into Leads to sell and Customers to bill." },
      { type: "callout", tone: "info", text: "Onboarding is sales-led: we create and share the first invoice ourselves, so the public site no longer offers self-signup. The whole funnel runs through this portal." },
      { type: "figure", title: "Admin Overview dashboard", where: "/admin", caption: "Top-line metrics for the platform business." },
    ],
  },
  {
    id: "leads",
    title: "Leads — the sales CRM",
    icon: Flame,
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
    id: "customers",
    title: "Customers (billing)",
    icon: Building2,
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
    id: "billing",
    title: "Creating & managing invoices",
    icon: Receipt,
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
    id: "subscriptions",
    title: "Subscriptions",
    icon: CreditCard,
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
    id: "discounts",
    title: "Discounts & coupons",
    icon: Percent,
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
    id: "tax",
    title: "Tax (how it works)",
    icon: FileText,
    intro: "A quick reference for charging tax correctly.",
    blocks: [
      { type: "p", text: "Capturing the customer's <b>country</b> on each invoice sets the Stripe customer address, which is what tax is based on. As an Irish-registered seller: a US customer is not charged tax (export of services, no US registration); EU customers fall under reverse-charge / Irish VAT rules." },
      { type: "callout", tone: "info", text: "To start charging tax in future, enable Stripe Tax and add your registrations — the country captured at invoice time is already wired in, so no rework is needed." },
    ],
  },
  {
    id: "cancellations-audit-team",
    title: "Cancellations, Audit Log & Team",
    icon: ScrollText,
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
    id: "integrations-note",
    title: "Sage & integrations status",
    icon: RefreshCw,
    intro: "Where the accounting integrations stand.",
    blocks: [
      { type: "bullets", items: [
        "<b>QuickBooks Online</b> and <b>Xero</b> are live for customers, with incremental sync driven by each record's last-modified date.",
        "<b>Sage Intacct</b> is gated as <b>Coming Soon</b> — it requires a globally-registered Sender ID (Developer Licence) before it can go live.",
      ] },
      { type: "callout", tone: "warn", text: "Don't promise Sage on a call yet — keep it as Coming Soon until the Sender ID is registered and tested end-to-end." },
    ],
  },
];

export default function AdminGuidePage() {
  return (
    <GuideLayout
      title="Admin & Sales Guide"
      subtitle="How to run sales and billing in the Prime Accountax admin portal — leads and sequences, creating Stripe invoices, subscriptions, discounts and tax."
      sections={SECTIONS}
    />
  );
}
