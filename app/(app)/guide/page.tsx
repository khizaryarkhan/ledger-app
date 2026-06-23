"use client";

import { GuideLayout, type GuideSection } from "@/components/guide";
import {
  Rocket, LayoutDashboard, FileText, Users, Kanban, Zap, MessageSquare,
  BarChart3, Package, RefreshCw, Settings, ShieldCheck,
} from "lucide-react";

const SECTIONS: GuideSection[] = [
  {
    id: "getting-started",
    title: "Getting started",
    icon: Rocket,
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
    id: "dashboard",
    title: "Dashboard",
    icon: LayoutDashboard,
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
    id: "invoices-customers",
    title: "Invoices, Customers & Projects",
    icon: FileText,
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
    id: "collections",
    title: "Collections Board",
    icon: Kanban,
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
    id: "automations",
    title: "Automations & reminders",
    icon: Zap,
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
    id: "responses",
    title: "Responses, Notes & Tasks",
    icon: MessageSquare,
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
    id: "insights",
    title: "Insights & Reports",
    icon: BarChart3,
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
    id: "payables",
    title: "Payables (Accounts Payable)",
    icon: Package,
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
    id: "sync",
    title: "Syncing & reconciliation",
    icon: RefreshCw,
    intro: "How Prime Accountax keeps in step with your accounting system.",
    blocks: [
      { type: "p", text: "The <b>Sync</b> button (top-right of any screen) pulls the latest changes. Incremental syncs are driven by each record's <b>last-modified date</b>, so edits to old invoices — a late payment, a void, a credit note — are always picked up, not just newly-dated transactions." },
      { type: "p", text: "A <b>Full Sync</b> re-imports your entire history. Use it after large changes in your accounting system or if you ever suspect a figure is stale. It takes longer but is safe to run any time — records are matched by ID, so nothing is duplicated." },
      { type: "callout", tone: "tip", text: "Day-to-day you never need Full Sync — the automatic incremental sync keeps everything current. Reach for it only to force a complete refresh." },
      { type: "figure", title: "Sync button and last-sync indicator", where: "Top bar → Sync", caption: "Incremental by default; Full Sync available for a complete refresh." },
    ],
  },
  {
    id: "settings",
    title: "Settings & Imports",
    icon: Settings,
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
    id: "roles",
    title: "Roles & access",
    icon: ShieldCheck,
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
];

export default function CustomerGuidePage() {
  return (
    <GuideLayout
      title="User Guide"
      subtitle="Everything you need to run receivables in Prime Accountax — from connecting your accounting system to automating collections and reading your reports."
      sections={SECTIONS}
    />
  );
}
