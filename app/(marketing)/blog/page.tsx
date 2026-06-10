import Link from "next/link";
import type { Metadata } from "next";
import { POSTS, SITE_URL } from "@/lib/blog-data";
import { MarketingCTA } from "@/components/marketing";

export const metadata: Metadata = {
  title: "Blog — Accounts Receivable & Collections Insights",
  description:
    "Practical guides on accounts receivable, collections, DSO, and getting invoices paid faster with QuickBooks Online and Xero.",
  alternates: { canonical: `${SITE_URL}/blog` },
};

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function BlogIndex() {
  return (
    <>
      <section className="px-5 pt-20 pb-10">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">The Prime Accountax blog</h1>
          <p className="text-lg text-stone-400">
            Practical guides on accounts receivable, collections, and getting paid faster with QuickBooks Online and Xero.
          </p>
        </div>
      </section>

      <section className="px-5 pb-8">
        <div className="max-w-3xl mx-auto space-y-4">
          {POSTS.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              className="block rounded-2xl border border-stone-800 bg-stone-900/40 p-6 hover:border-emerald-500/30 hover:bg-stone-900/70 transition-colors group"
            >
              <div className="flex items-center gap-3 text-[12px] text-stone-500 mb-2">
                <span>{fmtDate(p.date)}</span>
                <span>·</span>
                <span>{p.readMins} min read</span>
              </div>
              <h2 className="text-xl font-semibold text-white group-hover:text-emerald-300 transition-colors mb-2">{p.title}</h2>
              <p className="text-sm text-stone-400 leading-relaxed">{p.excerpt}</p>
              <span className="inline-block mt-3 text-[13px] text-emerald-400">Read article →</span>
            </Link>
          ))}
        </div>
      </section>

      <MarketingCTA />
    </>
  );
}
