import Link from "next/link";
import { notFound } from "next/navigation";
import { POSTS, getPost, buildPostMetadata, SITE_URL } from "@/lib/blog-data";
import { MarketingCTA } from "@/components/marketing";

export function generateStaticParams() {
  return POSTS.map((p) => ({ slug: p.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }) {
  return buildPostMetadata(params.slug);
}

function fmtDate(iso: string) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function BlogPost({ params }: { params: { slug: string } }) {
  const post = getPost(params.slug);
  if (!post) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "BlogPosting",
        "@id": `${SITE_URL}/blog/${post.slug}#article`,
        headline: post.title,
        description: post.description,
        datePublished: post.date,
        dateModified: post.date,
        author: { "@type": "Organization", name: "Prime Accountax" },
        publisher: { "@type": "Organization", name: "Prime Accountax", "@id": `${SITE_URL}/#organization` },
        mainEntityOfPage: `${SITE_URL}/blog/${post.slug}`,
      },
      {
        "@type": "FAQPage",
        mainEntity: post.faqs.map((f) => ({
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

      <article className="px-5 pt-16 pb-10">
        <div className="max-w-2xl mx-auto">
          <Link href="/blog" className="text-[13px] text-stone-500 hover:text-emerald-400 transition-colors">← All articles</Link>
          <div className="flex items-center gap-3 text-[12px] text-stone-500 mt-6 mb-3">
            <span>{fmtDate(post.date)}</span>
            <span>·</span>
            <span>{post.readMins} min read</span>
          </div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white leading-tight mb-8">{post.title}</h1>

          <div className="space-y-5">
            {post.blocks.map((b, i) => (
              <div key={i}>
                {b.h2 && <h2 className="text-xl font-semibold text-white mt-8 mb-2">{b.h2}</h2>}
                {b.p && <p className="text-[15px] text-stone-300 leading-relaxed">{b.p}</p>}
                {b.ul && (
                  <ul className="mt-2 space-y-1.5">
                    {b.ul.map((li, j) => (
                      <li key={j} className="flex items-start gap-2.5 text-[15px] text-stone-300">
                        <span className="text-emerald-400 mt-0.5 shrink-0">•</span>
                        {li}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {/* FAQ */}
          <div className="mt-12">
            <h2 className="text-xl font-semibold text-white mb-4">FAQ</h2>
            <div className="space-y-3">
              {post.faqs.map((f, i) => (
                <details key={i} className="group rounded-xl border border-stone-800 bg-stone-900/40 px-5 py-4 open:bg-stone-900/70 transition-colors">
                  <summary className="cursor-pointer list-none flex items-center justify-between gap-4 text-[15px] font-medium text-white">
                    <span>{f.q}</span>
                    <span className="text-stone-500 group-open:rotate-45 transition-transform text-2xl leading-none shrink-0">+</span>
                  </summary>
                  <p className="mt-3 text-sm text-stone-400 leading-relaxed">{f.a}</p>
                </details>
              ))}
            </div>
          </div>
        </div>
      </article>

      <MarketingCTA />
    </>
  );
}
