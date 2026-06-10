import { MarketingNav, MarketingFooter } from "@/components/marketing";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative bg-stone-950 text-stone-100 min-h-screen font-sans antialiased overflow-x-hidden">
      {/* subtle static background */}
      <div className="fixed inset-0 -z-10 pointer-events-none" aria-hidden>
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(60% 50% at 20% 0%, rgba(16,185,129,0.08), transparent), radial-gradient(50% 50% at 85% 10%, rgba(45,212,191,0.06), transparent)",
          }}
        />
      </div>
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
