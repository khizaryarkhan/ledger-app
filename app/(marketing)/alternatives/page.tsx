import Link from "next/link";
import type { Metadata } from "next";
import { COMPETITORS, SITE_URL } from "@/lib/competitors-data";
import { MarketingCTA } from "@/components/marketing";

export const metadata: Metadata = {
  title: "Accounts Receivable Software Alternatives & Comparisons",
  description:
    "Comparing accounts receivable and collections tools? See how Prime Accountax — built for QuickBooks Online and Xero — stacks up as an alternative to the popular AR automation platforms.",
  alternates: { canonical: `${SITE_URL}/alternatives` },
};

export default function AlternativesIndex() {
  return (
    <>
      <section className="px-5 pt-20 pb-10">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight text-white mb-4">
            Prime Accountax vs the alternatives
          </h1>
          <p className="text-lg text-stone-400">
            Evaluating accounts receivable and collections software? Here&apos;s how Prime Accountax — built specifically for QuickBooks Online and Xero — compares to the popular AR automation tools.
          </p>
        </div>
      </section>

      <section className="px-5 pb-8">
        <div className="max-w-3xl mx-auto grid sm:grid-cols-2 gap-4">
          {COMPETITORS.map((c) => (
            <Link
              key={c.slug}
              href={`/${c.slug}`}
              className="rounded-2xl border border-stone-800 bg-stone-900/40 p-6 hover:border-emerald-500/30 hover:bg-stone-900/70 transition-colors group"
            >
              <h2 className="text-lg font-semibold text-white group-hover:text-emerald-300 transition-colors">
                {c.name} alternative
              </h2>
              <p className="text-sm text-stone-500 mt-1.5">How Prime Accountax compares to {c.name} for QuickBooks &amp; Xero teams.</p>
              <span className="inline-block mt-3 text-[13px] text-emerald-400">Compare →</span>
            </Link>
          ))}
        </div>
      </section>

      <MarketingCTA />
    </>
  );
}
