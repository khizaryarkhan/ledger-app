import type { Metadata } from "next";

export const SITE_URL = "https://primeaccountax.com";

export type Solution = {
  slug: string;
  metaTitle: string;
  h1: string;
  eyebrow: string;
  description: string; // used for meta description + hero subhead
  intro: string;
  benefits: { title: string; body: string }[];
  features: string[];
  faqs: { q: string; a: string }[];
  keywords: string[];
};

export const SOLUTIONS: Record<string, Solution> = {
  "accounts-receivable-software-for-quickbooks": {
    slug: "accounts-receivable-software-for-quickbooks",
    eyebrow: "For QuickBooks Online",
    metaTitle: "Accounts Receivable Software for QuickBooks Online",
    h1: "Accounts receivable software for QuickBooks Online",
    description:
      "Prime Accountax is the AR management and collections platform for QuickBooks Online. Sync invoices and customers automatically, send branded payment reminders, track promises and disputes, and get paid faster — without leaving QuickBooks behind.",
    intro:
      "QuickBooks Online is great for invoicing — but it was never built to chase the money. Prime Accountax connects to QuickBooks in one click and turns your open invoices into an automated, accountable collections workflow your whole team can see.",
    benefits: [
      {
        title: "One-click QuickBooks sync",
        body: "Invoices, customers, projects, and payments sync automatically from QuickBooks Online. When a customer pays in QuickBooks, the invoice closes here within seconds — no manual updates, no double entry.",
      },
      {
        title: "Automated, branded reminders",
        body: "Schedule smart follow-up sequences that send before and after the due date through Gmail, Microsoft 365, or your own SMTP. Every reminder is branded and tracked with a unique reference.",
      },
      {
        title: "A real-time collections board",
        body: "See every outstanding invoice in one view. Filter by customer, region, rep, project, due date, or collection stage — and bulk-send reminders in seconds instead of digging through QuickBooks.",
      },
      {
        title: "Promises, disputes, and a customer portal",
        body: "Customers get a secure link to pay, promise a payment date, or raise a dispute — no login required. Promises and disputes are tracked automatically so nothing slips.",
      },
    ],
    features: [
      "Automatic QuickBooks Online invoice & payment sync",
      "Smart multi-step email reminder sequences",
      "Live collections board with powerful filters",
      "Customer self-service payment portal",
      "Payment-promise & dispute tracking",
      "AR aging, DSO and collections reporting",
      "AI collections assistant",
      "Team & rep assignment and ownership",
    ],
    faqs: [
      {
        q: "Does Prime Accountax sync with QuickBooks Online?",
        a: "Yes. Prime Accountax connects to QuickBooks Online via secure OAuth in one click and syncs invoices, customers, projects, and payments automatically. Webhooks keep everything current in near real time.",
      },
      {
        q: "Can I automate invoice reminders from QuickBooks?",
        a: "Yes. You build reminder sequences once, and Prime Accountax sends branded follow-up emails on schedule for every overdue invoice — via Gmail, Microsoft 365, or SMTP.",
      },
      {
        q: "Will my QuickBooks data stay accurate?",
        a: "Yes. Because sync is automatic and two-way aware, when a payment lands in QuickBooks the invoice is marked paid in Prime Accountax automatically, so your AR view never drifts.",
      },
      {
        q: "How much does it cost?",
        a: "Prime Accountax is $99 per month per organization, with QuickBooks Online sync included.",
      },
    ],
    keywords: [
      "accounts receivable software for QuickBooks",
      "AR management tool for QuickBooks Online",
      "QuickBooks collections software",
      "QuickBooks accounts receivable automation",
      "automate invoice reminders QuickBooks",
      "QuickBooks dunning software",
      "QuickBooks AR app",
    ],
  },

  "accounts-receivable-software-for-xero": {
    slug: "accounts-receivable-software-for-xero",
    eyebrow: "For Xero",
    metaTitle: "Accounts Receivable & Collections Software for Xero",
    h1: "Accounts receivable software for Xero",
    description:
      "Prime Accountax is the AR collections platform for Xero. Sync invoices and contacts automatically, automate payment reminders, track promises and disputes, and reduce DSO — built for Xero-powered finance teams and accounting firms.",
    intro:
      "Xero keeps your books tidy. Prime Accountax makes sure the cash actually arrives. Connect Xero in one click and run automated, accountable collections across your whole team.",
    benefits: [
      {
        title: "Automatic Xero sync",
        body: "Invoices, contacts, and payments sync from Xero automatically. Paid invoices close themselves here, so your receivables picture is always current.",
      },
      {
        title: "Hands-off reminder sequences",
        body: "Define your follow-up cadence once. Prime Accountax sends branded reminders before and after due dates through Gmail, Microsoft 365, or SMTP.",
      },
      {
        title: "Shared collections workspace",
        body: "Accountants, project managers, and reps work from one real-time board — filter, assign, and bulk-chase without exporting spreadsheets.",
      },
      {
        title: "Self-service for your customers",
        body: "A secure portal lets customers pay, set a promise-to-pay date, or raise a dispute, keeping conversations off your inbox and on the record.",
      },
    ],
    features: [
      "Automatic Xero invoice, contact & payment sync",
      "Multi-step automated reminder sequences",
      "Real-time collections board & smart views",
      "Customer self-service portal",
      "Promise-to-pay & dispute tracking",
      "AR aging & DSO reporting",
      "AI collections assistant",
      "Rep & team ownership",
    ],
    faqs: [
      {
        q: "Does Prime Accountax integrate with Xero?",
        a: "Yes. Prime Accountax connects to Xero via secure OAuth and syncs invoices, contacts, and payments automatically.",
      },
      {
        q: "Can I use Prime Accountax with both Xero and QuickBooks?",
        a: "Yes. Prime Accountax supports both Xero and QuickBooks Online, so firms running a mix of clients can manage all receivables in one place.",
      },
      {
        q: "How does it help reduce DSO?",
        a: "Automated reminders, promise tracking, and a shared collections board shorten the time invoices stay open, reducing Days Sales Outstanding.",
      },
      {
        q: "How much does it cost?",
        a: "Prime Accountax is $99 per month per organization, with Xero sync included.",
      },
    ],
    keywords: [
      "accounts receivable software for Xero",
      "Xero collections software",
      "Xero invoice reminders",
      "Xero credit control",
      "Xero AR automation",
      "AR management tool for Xero",
    ],
  },

  "credit-control-software": {
    slug: "credit-control-software",
    eyebrow: "Credit control, automated",
    metaTitle: "Credit Control Software for QuickBooks & Xero",
    h1: "Credit control software that gets you paid faster",
    description:
      "Automated credit control software for businesses on QuickBooks Online and Xero. Chase overdue invoices automatically, track promises and disputes, and reduce DSO — with a real-time view of every debtor.",
    intro:
      "Manual credit control means spreadsheets, sticky notes, and inconsistent chasing. Prime Accountax automates the entire credit control cycle — synced to your accounting system, run by your whole team, and never forgetting a follow-up.",
    benefits: [
      {
        title: "Never miss a follow-up",
        body: "Automated reminder sequences chase every overdue invoice on schedule, so collections happen consistently — even when your team is busy.",
      },
      {
        title: "See every debtor at a glance",
        body: "A live ageing view and collections board show exactly who owes what, how overdue they are, and what the next action is.",
      },
      {
        title: "Track promises and disputes",
        body: "Log promises-to-pay, flag disputes, and keep a clean audit trail of every interaction against each invoice.",
      },
      {
        title: "Built for teams",
        body: "Assign debtors to reps or regions, escalate by stage, and keep everyone accountable from one shared workspace.",
      },
    ],
    features: [
      "Automated overdue-invoice chasing",
      "Live debtor & ageing dashboard",
      "Promise-to-pay and dispute tracking",
      "Customer self-service payment portal",
      "QuickBooks Online & Xero sync",
      "Escalation rules and rep assignment",
      "DSO and collections reporting",
    ],
    faqs: [
      {
        q: "What is credit control software?",
        a: "Credit control software automates the process of chasing customers for overdue payments — sending reminders, tracking promises and disputes, and giving finance teams a real-time view of outstanding debt. Prime Accountax does this on top of QuickBooks Online and Xero.",
      },
      {
        q: "Does it work for UK and Irish businesses?",
        a: "Yes. Prime Accountax supports multi-currency receivables and is well suited to UK and Irish credit control teams using QuickBooks Online or Xero.",
      },
      {
        q: "Can I automate the whole chasing process?",
        a: "Yes. You define the reminder cadence and escalation rules once, and Prime Accountax handles the chasing automatically while keeping your team in the loop on replies, promises, and disputes.",
      },
    ],
    keywords: [
      "credit control software",
      "credit control software UK",
      "credit control software Ireland",
      "debtor management software",
      "automated credit control",
      "chase overdue invoices software",
    ],
  },

  "automated-invoice-reminders": {
    slug: "automated-invoice-reminders",
    eyebrow: "Set it once, get paid on time",
    metaTitle: "Automated Invoice Payment Reminders",
    h1: "Automated invoice payment reminders",
    description:
      "Send automatic, branded invoice payment reminders for QuickBooks Online and Xero. Build smart follow-up sequences, track every email, and let customers pay or promise a date — so you stop chasing manually.",
    intro:
      "Chasing invoices by hand is the worst job in finance. Prime Accountax sends branded reminders automatically — before and after the due date — and tracks exactly what was sent, opened, and answered.",
    benefits: [
      {
        title: "Smart follow-up sequences",
        body: "Reminders go out on the cadence you choose: a friendly nudge before due date, then escalating follow-ups after — automatically, per invoice.",
      },
      {
        title: "Branded and trackable",
        body: "Every email carries your branding and a unique reference, so replies and payments are matched to the right invoice automatically.",
      },
      {
        title: "Send from your own inbox",
        body: "Connect Gmail, Microsoft 365, or SMTP so reminders come from your real address — improving deliverability and trust.",
      },
      {
        title: "Customers can act instantly",
        body: "Each reminder links to a secure portal where customers pay, promise a payment date, or raise a dispute in one click.",
      },
    ],
    features: [
      "Pre-due and post-due reminder sequences",
      "Branded email templates",
      "Gmail, Microsoft 365 & SMTP sending",
      "Per-invoice tracking and references",
      "Customer pay / promise / dispute portal",
      "QuickBooks Online & Xero sync",
    ],
    faqs: [
      {
        q: "Can I send automatic payment reminders for QuickBooks invoices?",
        a: "Yes. Prime Accountax syncs your QuickBooks Online (and Xero) invoices and sends automated, branded reminders on a schedule you define, with no manual effort per invoice.",
      },
      {
        q: "Will reminders come from my own email address?",
        a: "Yes. Connect Gmail, Microsoft 365, or SMTP and reminders are sent from your address, which improves deliverability and looks professional.",
      },
      {
        q: "What happens when a customer replies or pays?",
        a: "Replies and payments are matched to the invoice automatically. When the invoice is paid in your accounting system, reminders stop and the invoice closes in Prime Accountax.",
      },
    ],
    keywords: [
      "automated invoice reminders",
      "automatic payment reminders",
      "invoice reminder software",
      "send payment reminders QuickBooks",
      "automated dunning emails",
      "overdue invoice reminder emails",
    ],
  },

  "customer-payment-portal": {
    slug: "customer-payment-portal",
    eyebrow: "Self-service for your customers",
    metaTitle: "Customer Payment Portal for Invoices",
    h1: "A self-service payment portal for your customers",
    description:
      "Give customers a secure link to view invoices, pay, promise a payment date, or raise a dispute — no login required. The Prime Accountax customer portal speeds up collections for QuickBooks Online and Xero.",
    intro:
      "The faster a customer can act, the faster you get paid. Prime Accountax gives every customer a secure, no-login link to handle their invoice in seconds — and keeps every action on the record.",
    benefits: [
      {
        title: "No login, no friction",
        body: "Customers open a secure tokenized link straight from a reminder email — no accounts, no passwords, no barriers to paying.",
      },
      {
        title: "Pay or promise a date",
        body: "Customers can pay immediately or set a promise-to-pay date, which your team sees and can follow up on automatically.",
      },
      {
        title: "Raise disputes early",
        body: "If something's wrong, customers flag it in the portal — so disputes surface early instead of becoming silent non-payment.",
      },
      {
        title: "Everything on the record",
        body: "Every portal action is logged against the invoice, giving your team a clean, auditable history of the conversation.",
      },
    ],
    features: [
      "Secure, no-login tokenized access",
      "View invoice details and balance",
      "Promise-to-pay date capture",
      "Dispute submission",
      "Linked from every reminder email",
      "Full audit trail per invoice",
    ],
    faqs: [
      {
        q: "Do customers need an account to use the portal?",
        a: "No. The Prime Accountax customer portal uses a secure tokenized link, so customers can view and act on their invoice without creating an account or logging in.",
      },
      {
        q: "What can customers do in the portal?",
        a: "They can view the invoice, pay, set a promise-to-pay date, or raise a dispute — and every action is recorded against the invoice for your team.",
      },
      {
        q: "Does it work with QuickBooks and Xero?",
        a: "Yes. The portal works on top of invoices synced from QuickBooks Online and Xero.",
      },
    ],
    keywords: [
      "customer payment portal",
      "invoice payment portal",
      "self-service invoice portal",
      "online invoice payment portal QuickBooks",
      "promise to pay portal",
    ],
  },
};

export const SOLUTION_LINKS = Object.values(SOLUTIONS).map((s) => ({
  href: `/${s.slug}`,
  label: s.h1,
  short: s.eyebrow,
}));

export function getSolution(slug: string): Solution | undefined {
  return SOLUTIONS[slug];
}

export function buildSolutionMetadata(slug: string): Metadata {
  const s = SOLUTIONS[slug];
  if (!s) return {};
  const url = `${SITE_URL}/${s.slug}`;
  return {
    title: s.metaTitle,
    description: s.description,
    keywords: s.keywords,
    alternates: { canonical: url },
    openGraph: {
      type: "website",
      url,
      siteName: "Prime Accountax",
      title: `${s.metaTitle} · Prime Accountax`,
      description: s.description,
    },
    twitter: {
      card: "summary_large_image",
      title: `${s.metaTitle} · Prime Accountax`,
      description: s.description,
    },
  };
}
