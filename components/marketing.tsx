import Link from "next/link";
import { SOLUTION_LINKS } from "@/lib/marketing-data";

export function MarketingNav() {
  return (
    <nav className="sticky top-0 inset-x-0 z-50 border-b border-stone-800/60 bg-stone-950/85 backdrop-blur-xl">
      <div className="max-w-6xl mx-auto px-5 h-16 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-emerald-500 flex items-center justify-center shadow-lg shadow-emerald-500/40">
            <span className="text-white font-bold text-lg leading-none">P</span>
          </div>
          <span className="font-semibold text-white tracking-tight">Prime Accountax</span>
        </Link>
        <div className="hidden md:flex items-center gap-6 text-sm text-stone-400">
          <Link href="/#features" className="hover:text-white transition-colors">Features</Link>
          <Link href="/accounts-receivable-software-for-quickbooks" className="hover:text-white transition-colors">QuickBooks</Link>
          <Link href="/accounts-receivable-software-for-xero" className="hover:text-white transition-colors">Xero</Link>
          <Link href="/blog" className="hover:text-white transition-colors">Blog</Link>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/login" className="hidden sm:inline text-sm text-stone-400 hover:text-white px-3 py-2 rounded-lg transition-colors">Sign in</Link>
          <Link href="/register" className="text-sm font-medium bg-emerald-500 hover:bg-emerald-400 text-white px-4 py-2 rounded-lg transition-all hover:shadow-lg hover:shadow-emerald-500/30">Get started →</Link>
        </div>
      </div>
    </nav>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-stone-800 mt-20">
      <div className="max-w-6xl mx-auto px-5 py-12 grid gap-10 md:grid-cols-4">
        <div className="md:col-span-1">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-6 h-6 rounded bg-emerald-500 flex items-center justify-center">
              <span className="text-white font-bold text-xs leading-none">P</span>
            </div>
            <span className="font-semibold text-white">Prime Accountax</span>
          </div>
          <p className="text-[13px] text-stone-500 leading-relaxed">
            AR management &amp; automated collections for QuickBooks Online and Xero.
          </p>
        </div>
        <div>
          <div className="text-[12px] uppercase tracking-wider text-stone-500 font-semibold mb-3">Solutions</div>
          <ul className="space-y-2 text-[13px] text-stone-400">
            {SOLUTION_LINKS.map((l) => (
              <li key={l.href}>
                <Link href={l.href} className="hover:text-emerald-400 transition-colors">{l.label}</Link>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="text-[12px] uppercase tracking-wider text-stone-500 font-semibold mb-3">Resources</div>
          <ul className="space-y-2 text-[13px] text-stone-400">
            <li><Link href="/blog" className="hover:text-emerald-400 transition-colors">Blog</Link></li>
            <li><Link href="/alternatives" className="hover:text-emerald-400 transition-colors">Comparisons</Link></li>
            <li><Link href="/#how-it-works" className="hover:text-emerald-400 transition-colors">How it works</Link></li>
            <li><Link href="/#faq" className="hover:text-emerald-400 transition-colors">FAQ</Link></li>
          </ul>
        </div>
        <div>
          <div className="text-[12px] uppercase tracking-wider text-stone-500 font-semibold mb-3">Get started</div>
          <ul className="space-y-2 text-[13px] text-stone-400">
            <li><Link href="/register" className="hover:text-emerald-400 transition-colors">Create account</Link></li>
            <li><Link href="/login" className="hover:text-emerald-400 transition-colors">Sign in</Link></li>
            <li><Link href="/privacy" className="hover:text-emerald-400 transition-colors">Privacy</Link></li>
            <li><Link href="/terms" className="hover:text-emerald-400 transition-colors">Terms</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-stone-800/60">
        <div className="max-w-6xl mx-auto px-5 py-5 text-[12px] text-stone-600">
          © {new Date().getFullYear()} Prime Accountax (Pvt) Ltd · AR collections for QuickBooks Online &amp; Xero
        </div>
      </div>
    </footer>
  );
}

// Shared CTA band used at the bottom of marketing pages.
export function MarketingCTA({ heading = "Ready to get paid faster?" }: { heading?: string }) {
  return (
    <section className="px-5 py-20">
      <div className="max-w-3xl mx-auto rounded-3xl border border-emerald-500/25 bg-gradient-to-b from-emerald-500/10 via-stone-900/60 to-transparent p-10 md:p-14 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white mb-4">{heading}</h2>
        <p className="text-stone-400 mb-8 text-lg max-w-xl mx-auto">
          Connect QuickBooks Online or Xero and start automating collections in minutes.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link href="/register" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-white font-semibold px-8 py-4 rounded-xl transition-all hover:shadow-xl hover:shadow-emerald-500/30 text-sm">
            Get started →
          </Link>
          <Link href="/" className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-stone-300 hover:text-white border border-stone-700 hover:border-emerald-500/50 px-8 py-4 rounded-xl transition-all text-sm">
            See all features
          </Link>
        </div>
      </div>
    </section>
  );
}
