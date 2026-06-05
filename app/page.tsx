import Link from "next/link";
import type { Metadata } from "next";

// IMPORTANT: this name must EXACTLY match the "App name" on your Google OAuth
// consent screen (currently "Ledger App"). Change both to the same value.
const APP_NAME = "Ledger";

export const metadata: Metadata = {
  title: `${APP_NAME} — Accounts Receivable & Collections`,
  description:
    `${APP_NAME} is an accounts-receivable platform that syncs your QuickBooks invoices, automates collection reminders, and lets customers confirm payment dates or raise queries through a secure portal.`,
};

const FEATURES = [
  { title: "QuickBooks sync", body: "Automatically pulls your invoices, customers, payments and credit memos from QuickBooks Online so your receivables are always up to date." },
  { title: "Automated reminders", body: "Sends scheduled, on-brand collection emails with invoice PDFs attached — through your own Gmail, Microsoft 365, or SMTP mailbox." },
  { title: "Customer response portal", body: "Each email includes a secure link where customers can set a payment date or raise a query, captured straight into your workflow." },
  { title: "Collections board", body: "Track every account by stage, prioritise who to chase, log promises and disputes, and send statements — all from one screen." },
];

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white text-stone-900 flex flex-col">
      {/* Nav */}
      <header className="border-b border-stone-200">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-stone-900 text-white flex items-center justify-center font-bold text-sm">{APP_NAME.charAt(0)}</div>
            <span className="font-semibold text-lg">{APP_NAME}</span>
          </div>
          <Link href="/login" className="text-sm font-medium bg-stone-900 text-white px-4 py-2 rounded-lg hover:bg-stone-700 transition-colors">
            Sign in
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="max-w-3xl mx-auto px-6 pt-20 pb-12 text-center">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          Get paid faster, with less chasing.
        </h1>
        <p className="text-lg text-stone-600 mt-5 leading-relaxed">
          {APP_NAME} is an accounts-receivable platform for businesses and accountants. It syncs your
          QuickBooks invoices, automates collection reminders through your own mailbox, and gives customers a
          secure portal to confirm payment dates or raise queries — so you spend less time on follow-ups and
          get paid sooner.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link href="/login" className="text-sm font-semibold bg-stone-900 text-white px-5 py-3 rounded-lg hover:bg-stone-700 transition-colors">
            Sign in to your account
          </Link>
        </div>
        <p className="text-xs text-stone-400 mt-3">Access is provided by invitation. Contact your administrator to get started.</p>
      </section>

      {/* Features */}
      <section className="max-w-5xl mx-auto px-6 pb-20 w-full">
        <div className="grid sm:grid-cols-2 gap-4">
          {FEATURES.map(f => (
            <div key={f.title} className="rounded-xl ring-1 ring-stone-200 p-6">
              <h3 className="font-semibold text-stone-900">{f.title}</h3>
              <p className="text-sm text-stone-600 mt-2 leading-relaxed">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="mt-auto border-t border-stone-200">
        <div className="max-w-5xl mx-auto px-6 py-8 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-stone-500">
          <span>© {new Date().getFullYear()} {APP_NAME}. All rights reserved.</span>
          <div className="flex items-center gap-5">
            <Link href="/privacy" className="hover:text-stone-900">Privacy Policy</Link>
            <Link href="/terms" className="hover:text-stone-900">Terms of Service</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
