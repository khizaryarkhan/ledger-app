import type { Metadata } from "next";
import { SITE_URL } from "./marketing-data";

export { SITE_URL };

/**
 * Competitor "alternative" pages.
 *
 * IMPORTANT — accuracy policy: we do NOT assert specific features or pricing
 * about competitors (those change and we can't verify them here). Each page
 * ranks for the "{name} alternative" query, describes the category neutrally,
 * and sells Prime Accountax's own verified strengths. A neutral line directs
 * readers to the competitor's site for their latest details.
 */
export type Competitor = {
  slug: string; // e.g. "chaser-alternative" -> /chaser-alternative
  name: string;
  // A neutral, accurate one-line category descriptor (true of all these tools).
  descriptor: string;
};

export const COMPETITORS: Competitor[] = [
  { slug: "chaser-alternative", name: "Chaser", descriptor: "an accounts receivable automation and credit control platform" },
  { slug: "upflow-alternative", name: "Upflow", descriptor: "an accounts receivable and cash collection platform" },
  { slug: "invoiced-alternative", name: "Invoiced", descriptor: "an accounts receivable automation platform" },
  { slug: "invoicesherpa-alternative", name: "InvoiceSherpa", descriptor: "an automated invoice reminder and collections tool" },
  { slug: "gaviti-alternative", name: "Gaviti", descriptor: "an accounts receivable management and collections platform" },
  { slug: "kolleno-alternative", name: "Kolleno", descriptor: "an accounts receivable and collections platform" },
  { slug: "satago-alternative", name: "Satago", descriptor: "a credit control and cash flow platform" },
  { slug: "yaypay-alternative", name: "YayPay", descriptor: "an accounts receivable automation platform" },
];

// Prime Accountax's real, verified strengths — reused across all pages.
export const WHY_PRIME = [
  {
    title: "Built for QuickBooks Online and Xero",
    body: "One-click OAuth sync pulls invoices, customers, projects, and payments from QuickBooks Online and Xero automatically, and keeps them current in near real time.",
  },
  {
    title: "Automated, branded reminder sequences",
    body: "Define your follow-up cadence once and let Prime Accountax chase every overdue invoice on schedule — sent from your own Gmail, Microsoft 365, or SMTP.",
  },
  {
    title: "Customer self-service portal",
    body: "Customers get a secure, no-login link to pay, promise a payment date, or raise a dispute — speeding up payment and surfacing issues early.",
  },
  {
    title: "One shared workspace for the whole team",
    body: "A live collections board lets accountants, project managers, and reps filter, assign, escalate, and bulk-chase — with promises and disputes tracked on every invoice.",
  },
  {
    title: "Simple, transparent pricing",
    body: "$99 per month per organization, with QuickBooks Online and Xero sync included.",
  },
  {
    title: "Your data stays isolated",
    body: "Every organization's receivables data is fully isolated and private to that organization.",
  },
];

export const PRIME_FEATURES = [
  "QuickBooks Online & Xero sync",
  "Automated multi-step reminder sequences",
  "Live collections board & smart views",
  "Customer self-service payment portal",
  "Promise-to-pay & dispute tracking",
  "AR aging, DSO & collections reporting",
  "AI collections assistant",
  "Team & rep assignment",
];

export function getCompetitor(slug: string): Competitor | undefined {
  return COMPETITORS.find((c) => c.slug === slug);
}

export function buildAlternativeMetadata(slug: string): Metadata {
  const c = getCompetitor(slug);
  if (!c) return {};
  const url = `${SITE_URL}/${c.slug}`;
  const title = `${c.name} Alternative for QuickBooks & Xero`;
  const description = `Looking for a ${c.name} alternative? Prime Accountax is an accounts receivable and collections platform for QuickBooks Online and Xero — automated reminders, a customer payment portal, promise and dispute tracking, and simple $99/month pricing.`;
  return {
    title,
    description,
    keywords: [
      `${c.name} alternative`,
      `${c.name} vs Prime Accountax`,
      `alternative to ${c.name}`,
      `${c.name} alternative for QuickBooks`,
      "accounts receivable software",
      "collections software",
    ],
    alternates: { canonical: url },
    openGraph: { type: "website", url, siteName: "Prime Accountax", title: `${title} · Prime Accountax`, description },
    twitter: { card: "summary_large_image", title: `${title} · Prime Accountax`, description },
  };
}
