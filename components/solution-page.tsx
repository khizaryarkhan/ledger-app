import Link from "next/link";
import { getSolution, SITE_URL } from "@/lib/marketing-data";
import { MarketingCTA } from "@/components/marketing";

export function SolutionPage({ slug }: { slug: string }) {
  const s = getSolution(slug);
  if (!s) return null;

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${SITE_URL}/${s.slug}#webpage`,
        url: `${SITE_URL}/${s.slug}`,
        name: s.metaTitle,
        description: s.description,
        isPartOf: { "@id": `${SITE_URL}/#website` },
      },
      {
        "@type": "SoftwareApplication",
        name: "Prime Accountax",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: SITE_URL,
        description: s.description,
        offers: { "@type": "Offer", price: "99", priceCurrency: "USD" },
        featureList: s.features,
      },
      {
        "@type": "FAQPage",
        mainEntity: s.faqs.map((f) => ({
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
      <section className="relative px-5 pt-20 pb-16 overflow-hidden">
        <div className="absolute inset-0 -z-0 pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[760px] h-[420px] bg-emerald-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-3xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 text-xs font-medium text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-3.5 py-1.5 mb-6">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            {s.eyebrow}
          </div>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-[1.1] text-white mb-6">{s.h1}</h1>
          <p className="text-lg text-stone-400 max-w-2xl mx-auto leading-relaxed mb-8">{s.description}</p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link href="/?demo=1" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold text-sm px-7 py-3.5 rounded-xl transition-all hover:shadow-xl hover:shadow-emerald-500/30">Request a demo →</Link>
            <Link href="/login" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-stone-300 hover:text-white border border-stone-700 hover:border-emerald-500/50 text-sm px-7 py-3.5 rounded-xl transition-colors">Sign in</Link>
          </div>
        </div>
      </section>

      {/* Intro */}
      <section className="px-5 pb-4">
        <div className="max-w-3xl mx-auto">
          <p className="text-xl text-stone-300 leading-relaxed text-center">{s.intro}</p>
        </div>
      </section>

      {/* Benefits */}
      <section className="px-5 py-16">
        <div className="max-w-5xl mx-auto grid md:grid-cols-2 gap-5">
          {s.benefits.map((b) => (
            <div key={b.title} className="rounded-2xl border border-stone-800 bg-stone-900/40 p-6 hover:border-emerald-500/30 transition-colors">
              <h2 className="text-lg font-semibold text-white mb-2">{b.title}</h2>
              <p className="text-sm text-stone-400 leading-relaxed">{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature list */}
      <section className="px-5 pb-16">
        <div className="max-w-3xl mx-auto rounded-2xl border border-stone-800 bg-stone-900/30 p-8">
          <div className="text-[12px] uppercase tracking-wider text-stone-500 font-semibold mb-5">What's included</div>
          <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-3">
            {s.features.map((f) => (
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
            {s.faqs.map((f, i) => (
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

      <MarketingCTA />
    </>
  );
}
