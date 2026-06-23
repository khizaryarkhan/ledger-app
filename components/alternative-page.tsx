import Link from "next/link";
import { getCompetitor, WHY_PRIME, PRIME_FEATURES, SITE_URL } from "@/lib/competitors-data";
import { MarketingCTA } from "@/components/marketing";

export function AlternativePage({ slug }: { slug: string }) {
  const c = getCompetitor(slug);
  if (!c) return null;

  const faqs = [
    {
      q: `Is Prime Accountax a good alternative to ${c.name}?`,
      a: `Prime Accountax is an accounts receivable and collections platform built specifically for QuickBooks Online and Xero. If you need automated reminders, a customer self-service portal, promise and dispute tracking, and a shared collections workspace at a simple $99/month, it's a strong alternative to consider alongside ${c.name}.`,
    },
    {
      q: "Does Prime Accountax integrate with QuickBooks Online and Xero?",
      a: "Yes. Prime Accountax connects to both QuickBooks Online and Xero via secure OAuth and syncs invoices, customers, and payments automatically.",
    },
    {
      q: "How much does Prime Accountax cost?",
      a: "Prime Accountax is $99 per month per organization, with QuickBooks Online and Xero sync included.",
    },
  ];

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/${c.slug}#webpage`,
        url: `${SITE_URL}/${c.slug}`,
        name: `${c.name} Alternative — Prime Accountax`,
        isPartOf: { "@id": `${SITE_URL}/#website` },
      },
      {
        "@type": "FAQPage",
        mainEntity: faqs.map((f) => ({
          "@type": "Question",
          name: f.q,
          acceptedAnswer: { "@type": "Answer", text: f.a },
        })),
      },
    ],
  };

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      {/* Hero */}
      <section className="relative px-5 pt-20 pb-14 overflow-hidden">
        <div className="absolute inset-0 -z-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[760px] h-[420px] bg-emerald-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3.5 py-1.5 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            Prime Accountax vs {c.name}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.1] text-white mb-6">
            Looking for a {c.name} alternative?
          </h1>
          <p className="text-lg text-stone-400 max-w-2xl mx-auto leading-relaxed mb-8">
            Prime Accountax is an accounts receivable and collections platform for QuickBooks Online and Xero — automated reminders, a customer payment portal, promise &amp; dispute tracking, and simple $99/month pricing.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/?demo=1" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm px-7 py-3.5 rounded-xl transition-all hover:shadow-xl hover:shadow-emerald-500/30">Request a demo →</Link>
            <Link href="/login" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-stone-300 hover:text-white border border-stone-700 hover:border-emerald-500/50 text-sm px-7 py-3.5 rounded-xl transition-colors">Sign in</Link>
          </div>
        </div>
      </section>

      {/* Neutral, honest framing */}
      <section className="px-5 pb-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="text-[15px] text-stone-400 leading-relaxed">
            {c.name} is {c.descriptor}. It's a capable option, and features and pricing
            evolve over time — so check {c.name}&apos;s own website for their latest details.
            If you run your books in <span className="text-stone-200">QuickBooks Online</span> or{" "}
            <span className="text-stone-200">Xero</span>, here&apos;s what Prime Accountax brings to the table.
          </p>
        </div>
      </section>

      {/* Why Prime Accountax */}
      <section className="px-5 py-12">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white text-center mb-8">Why teams choose Prime Accountax</h2>
          <div className="grid md:grid-cols-2 gap-5">
            {WHY_PRIME.map((b) => (
              <div key={b.title} className="rounded-2xl border border-stone-800 bg-stone-900/40 p-6 hover:border-emerald-500/30 transition-colors">
                <h3 className="text-lg font-semibold text-white mb-2">{b.title}</h3>
                <p className="text-sm text-stone-400 leading-relaxed">{b.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Feature list */}
      <section className="px-5 pb-14">
        <div className="max-w-3xl mx-auto rounded-2xl border border-stone-800 bg-stone-900/30 p-8">
          <div className="text-[12px] uppercase tracking-wider text-stone-500 font-semibold mb-5">Prime Accountax includes</div>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            {PRIME_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2.5 text-[14px] text-stone-300">
                <span className="text-emerald-400 mt-0.5 shrink-0">✓</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ */}
      <section className="px-5 pb-8">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-2xl md:text-3xl font-bold text-white mb-8 text-center">Frequently asked questions</h2>
          <div className="space-y-3">
            {faqs.map((f, i) => (
              <details key={i} className="group rounded-xl border border-stone-800 bg-stone-900/40 px-5 py-4 open:bg-stone-900/70 open:border-emerald-500/30 transition-colors">
                <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-[15px] font-medium text-white">
                  <span>{f.q}</span>
                  <span className="text-stone-500 group-open:rotate-45 transition-transform text-2xl leading-none shrink-0">+</span>
                </summary>
                <p className="mt-3 text-sm text-stone-400 leading-relaxed">{f.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <MarketingCTA heading={`Try the ${c.name} alternative built for QuickBooks & Xero`} />
    </>
  );
}
