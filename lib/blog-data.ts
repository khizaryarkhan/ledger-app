import type { Metadata } from "next";
import { SITE_URL } from "./marketing-data";

export { SITE_URL };

export type Block = { h2?: string; p?: string; ul?: string[] };

export type Post = {
  slug: string;
  title: string;
  metaTitle: string;
  description: string;
  date: string; // ISO yyyy-mm-dd
  readMins: number;
  keywords: string[];
  excerpt: string;
  blocks: Block[];
  faqs: { q: string; a: string }[];
};

export const POSTS: Post[] = [
  {
    slug: "how-to-automate-accounts-receivable-in-quickbooks",
    title: "How to automate accounts receivable in QuickBooks Online",
    metaTitle: "How to Automate Accounts Receivable in QuickBooks Online",
    description:
      "A practical guide to automating accounts receivable and collections in QuickBooks Online — from syncing invoices to automated reminders, promises, and reporting.",
    date: "2026-06-10",
    readMins: 6,
    keywords: [
      "automate accounts receivable QuickBooks",
      "QuickBooks AR automation",
      "automate collections QuickBooks Online",
    ],
    excerpt:
      "QuickBooks is built to invoice, not to collect. Here's how to turn it into a hands-off accounts receivable engine.",
    blocks: [
      {
        p: "QuickBooks Online is excellent at creating and tracking invoices — but collecting the money is still largely manual. Most finance teams export an ageing report, then chase by hand from a spreadsheet. Here's how to automate the entire accounts receivable (AR) workflow instead.",
      },
      {
        h2: "1. Sync your invoices automatically",
        p: "The foundation of AR automation is a live connection to QuickBooks. With Prime Accountax, a one-click OAuth connection syncs your invoices, customers, projects, and payments automatically. When a customer pays in QuickBooks, the invoice closes in your collections workflow within seconds — no double entry, no stale data.",
      },
      {
        h2: "2. Replace manual chasing with reminder sequences",
        p: "Instead of remembering to email each late payer, define a follow-up sequence once: a courtesy reminder a few days before the due date, then escalating nudges after. Reminders send automatically for every overdue invoice, branded and sent from your own Gmail, Microsoft 365, or SMTP address.",
      },
      {
        h2: "3. Let customers self-serve",
        p: "Every reminder links to a secure portal where the customer can pay, promise a payment date, or raise a dispute — no login required. This removes friction (faster payment) and surfaces disputes early (fewer silent non-payments).",
      },
      {
        h2: "4. Give your team one shared view",
        p: "A real-time collections board shows every outstanding invoice, filterable by customer, rep, region, project, or stage. Assign debtors to owners, escalate by ageing bucket, and bulk-send reminders — so collections are consistent and accountable.",
      },
      {
        h2: "5. Measure DSO and tighten the cycle",
        p: "Automated reporting tracks Days Sales Outstanding (DSO), ageing, and collection activity, so you can see the cycle shortening and spot risky accounts early.",
      },
      {
        h2: "The result",
        p: "By syncing QuickBooks, automating reminders, enabling self-service, and centralising the workflow, you turn a manual chore into a hands-off system that gets invoices paid faster — without leaving QuickBooks behind.",
      },
    ],
    faqs: [
      {
        q: "Can QuickBooks Online send automatic payment reminders on its own?",
        a: "QuickBooks has basic reminders, but it lacks multi-step escalating sequences, a shared collections board, promise/dispute tracking, and a self-service customer portal. A dedicated AR tool like Prime Accountax adds these on top of QuickBooks.",
      },
      {
        q: "Is AR automation safe for my QuickBooks data?",
        a: "Yes. Prime Accountax connects via secure OAuth and reads your data to drive collections; payments recorded in QuickBooks automatically close the matching invoice in the workflow.",
      },
    ],
  },
  {
    slug: "how-to-reduce-dso",
    title: "How to reduce DSO (Days Sales Outstanding): 7 practical tactics",
    metaTitle: "How to Reduce DSO: 7 Practical Tactics",
    description:
      "Seven proven tactics to reduce Days Sales Outstanding (DSO) and get invoices paid faster — with automation tips for QuickBooks Online and Xero teams.",
    date: "2026-06-10",
    readMins: 7,
    keywords: ["how to reduce DSO", "lower days sales outstanding", "get invoices paid faster"],
    excerpt:
      "DSO is the clearest measure of how fast you collect. Here are seven tactics that actually move it.",
    blocks: [
      {
        p: "Days Sales Outstanding (DSO) measures the average number of days it takes to collect payment after a sale. A lower DSO means healthier cash flow. Here are seven tactics that reliably bring it down.",
      },
      { h2: "1. Chase consistently — and automatically", p: "Inconsistent follow-up is the single biggest driver of high DSO. Automated reminder sequences ensure every overdue invoice is chased on schedule, every time." },
      { h2: "2. Start before the due date", p: "A friendly pre-due reminder sets the expectation and catches problems early. Don't wait until an invoice is already late to make first contact." },
      { h2: "3. Make paying effortless", p: "Every extra step costs you days. A self-service portal where customers pay or promise a date in one click removes friction and accelerates payment." },
      { h2: "4. Track promises to pay", p: "When a customer commits to a date, log it and follow up the moment it passes. Tracked promises convert far better than forgotten ones." },
      { h2: "5. Surface disputes early", p: "Disputes hide as silent non-payment and quietly inflate DSO. Give customers an easy way to flag issues so you can resolve them fast." },
      { h2: "6. Prioritise by risk and value", p: "Focus effort on the largest and oldest balances first. A collections board that sorts by ageing and value keeps your team on the invoices that matter." },
      { h2: "7. Measure and review", p: "Track DSO, ageing, and collection activity weekly. What gets measured gets managed — and the trend tells you whether your process is working." },
      { h2: "Automating the whole thing", p: "Prime Accountax brings these tactics together for QuickBooks Online and Xero: automatic sync, reminder sequences, a self-service portal, promise and dispute tracking, and DSO reporting — so your DSO falls without adding manual work." },
    ],
    faqs: [
      { q: "What is a good DSO?", a: "It varies by industry and payment terms, but generally a DSO within roughly 1.5x your standard terms is healthy. The key signal is the trend — consistent, automated collections should push it down over time." },
      { q: "How does automation lower DSO?", a: "Automation removes the gaps in manual chasing: every invoice is followed up on time, customers can pay instantly, and promises and disputes are tracked — all of which shorten the collection cycle." },
    ],
  },
  {
    slug: "best-quickbooks-collections-software",
    title: "What to look for in QuickBooks collections software",
    metaTitle: "QuickBooks Collections Software: What to Look For",
    description:
      "A buyer's guide to choosing accounts receivable and collections software for QuickBooks Online — the features that matter and the questions to ask.",
    date: "2026-06-10",
    readMins: 6,
    keywords: ["QuickBooks collections software", "best AR software for QuickBooks", "QuickBooks AR tool"],
    excerpt:
      "Not all AR tools are equal. Here's what actually matters when choosing collections software for QuickBooks.",
    blocks: [
      { p: "If you've outgrown manual chasing, the right collections software pays for itself in recovered cash and saved hours. Here's what to evaluate when choosing an accounts receivable tool for QuickBooks Online." },
      { h2: "Deep, automatic QuickBooks sync", p: "The tool should connect via secure OAuth and keep invoices, customers, and payments in sync automatically — ideally in near real time via webhooks, so paid invoices close themselves. Avoid anything that needs manual imports." },
      { h2: "Flexible reminder automation", p: "Look for multi-step sequences with pre-due and post-due reminders, branded templates, and the ability to send from your own Gmail, Microsoft 365, or SMTP for deliverability." },
      { h2: "A real collections workspace", p: "A shared, filterable board beats a spreadsheet. You want to assign owners, escalate by ageing, and bulk-send — with promises and disputes tracked against each invoice." },
      { h2: "A customer self-service portal", p: "Letting customers pay, promise, or dispute from a no-login link is one of the biggest levers on speed of payment." },
      { h2: "Reporting that proves ROI", p: "DSO, ageing, and collection-activity reporting let you see the cycle improving and justify the spend." },
      { h2: "Security and data isolation", p: "For firms managing multiple clients, each organisation's data must be fully isolated. Confirm the vendor's multi-tenant model keeps your data private." },
      { h2: "Where Prime Accountax fits", p: "Prime Accountax was built for exactly this: one-click QuickBooks Online (and Xero) sync, automated reminder sequences, a live collections board, a customer self-service portal, promise/dispute tracking, and DSO reporting — at $99/month per organisation." },
    ],
    faqs: [
      { q: "Does Prime Accountax work with QuickBooks Online?", a: "Yes — it connects to QuickBooks Online via secure OAuth and syncs invoices, customers, projects, and payments automatically. It also supports Xero." },
      { q: "How much does QuickBooks collections software cost?", a: "Prime Accountax is $99 per month per organisation with QuickBooks and Xero sync included; other tools vary widely based on volume and features." },
    ],
  },
];

export function getPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function buildPostMetadata(slug: string): Metadata {
  const p = getPost(slug);
  if (!p) return {};
  const url = `${SITE_URL}/blog/${p.slug}`;
  return {
    title: p.metaTitle,
    description: p.description,
    keywords: p.keywords,
    alternates: { canonical: url },
    openGraph: {
      type: "article",
      url,
      siteName: "Prime Accountax",
      title: p.metaTitle,
      description: p.description,
      publishedTime: p.date,
    },
    twitter: { card: "summary_large_image", title: p.metaTitle, description: p.description },
  };
}
