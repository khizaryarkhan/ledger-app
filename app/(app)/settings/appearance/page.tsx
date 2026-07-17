"use client";

import Link from "next/link";
import { ArrowLeft, Moon, Sun, Monitor, Check } from "lucide-react";
import { useTheme, type ThemePref } from "@/components/theme-provider";

/** Mini preview of each theme — real colors, not screenshots. */
function ThemePreview({ variant }: { variant: "dark" | "light" | "system" }) {
  const Panel = ({ bg, band, line, accent }: { bg: string; band: string; line: string; accent: string }) => (
    <div className="h-full w-full p-2 flex flex-col gap-1.5" style={{ background: bg }}>
      <div className="h-2 rounded-sm w-2/5" style={{ background: band }} />
      <div className="h-1.5 rounded-sm w-4/5" style={{ background: line }} />
      <div className="h-1.5 rounded-sm w-3/5" style={{ background: line }} />
      <div className="mt-auto flex gap-1">
        <div className="h-2.5 rounded-full w-8" style={{ background: accent }} />
        <div className="h-2.5 rounded-full w-5" style={{ background: line }} />
      </div>
    </div>
  );
  const dark  = <Panel bg="#0c0a09" band="#e7e5e4" line="#292524" accent="#059669" />;
  const light = <Panel bg="#fafaf9" band="#1c1917" line="#e7e5e4" accent="#059669" />;
  return (
    <div className="h-20 rounded-lg overflow-hidden ring-1 ring-stone-700 flex">
      {variant === "dark" ? dark : variant === "light" ? light : <>
        <div className="w-1/2 h-full">{dark}</div>
        <div className="w-1/2 h-full">{light}</div>
      </>}
    </div>
  );
}

const OPTIONS: { key: ThemePref; label: string; icon: any; desc: string }[] = [
  { key: "dark",   label: "Dark",   icon: Moon,    desc: "The classic Prime Accountax look — easy on the eyes for long sessions." },
  { key: "light",  label: "Light",  icon: Sun,     desc: "Bright and familiar — matches QuickBooks, Xero and Excel." },
  { key: "system", label: "System", icon: Monitor, desc: "Follows your device — light by day if that's how your OS is set." },
];

export default function AppearanceSettingsPage() {
  const { pref, setPref } = useTheme();

  return (
    <div className="p-6 max-w-[680px] mx-auto">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 mb-6 transition-colors">
        <ArrowLeft size={13} /> Back to Settings
      </Link>

      <div className="mb-6">
        <h1 className="text-base font-semibold text-white">Appearance</h1>
        <p className="text-xs text-stone-500 mt-0.5">
          Choose how the app looks on this device. You can also flip themes any time with the sun/moon button in the top bar.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {OPTIONS.map(o => {
          const Icon = o.icon;
          const active = pref === o.key;
          return (
            <button
              key={o.key}
              onClick={() => setPref(o.key)}
              className={`text-left rounded-xl p-3 ring-1 transition-all ${
                active ? "ring-emerald-500 bg-emerald-500/5" : "ring-stone-800 hover:ring-stone-600 bg-stone-900/50"
              }`}
            >
              <ThemePreview variant={o.key} />
              <div className="flex items-center gap-2 mt-3">
                <Icon size={14} className={active ? "text-emerald-400" : "text-stone-500"} />
                <span className="text-sm font-semibold text-white flex-1">{o.label}</span>
                {active && <Check size={14} className="text-emerald-400" />}
              </div>
              <p className="text-[11px] text-stone-500 mt-1 leading-relaxed">{o.desc}</p>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] text-stone-600 mt-6">
        The preference is saved per browser. Customer-facing pages (payment portal, emails) are not affected by this setting.
      </p>
    </div>
  );
}
