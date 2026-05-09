"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import { ChevronLeft, User, Palette, Calendar } from "lucide-react";

export default function CompanySettingsPage() {
  const { data: session } = useSession();
  const { orgSettings, updateOrgSettings } = useData();

  const role = (session?.user as any)?.role;
  const isAdmin = role === "company_admin" || role === "super_admin";

  const userName = session?.user?.name || "";
  const userEmail = session?.user?.email || "";
  const initials = userName.split(" ").slice(0, 2).map((w: string) => w[0]).join("").toUpperCase();

  // Branding
  const [brandingForm, setBrandingForm] = useState({ logoUrl: "", displayName: "" });
  const [savingBranding, setSavingBranding] = useState(false);

  // Date format
  const [dateFormat, setDateFormat] = useState("DD MMM YYYY");
  const [savingDateFormat, setSavingDateFormat] = useState(false);

  useEffect(() => {
    if (orgSettings) {
      setBrandingForm({ logoUrl: orgSettings.logoUrl || "", displayName: orgSettings.displayName || "" });
      setDateFormat(orgSettings.dateFormat || "DD MMM YYYY");
    }
  }, [orgSettings]);

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-900 mb-3 transition-colors"
        >
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Company</h1>
        <p className="text-sm text-stone-500 mt-1">Profile, branding and date preferences.</p>
      </div>

      {/* Profile — read-only */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <User size={16} className="text-stone-600" />
          <h3 className="text-sm font-semibold text-stone-900">Your profile</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-stone-700 to-stone-900 flex items-center justify-center text-white text-lg font-semibold">
            {initials}
          </div>
          <div className="flex-1">
            <div className="text-base font-medium text-stone-900">{userName}</div>
            <div className="text-sm text-stone-500">{userEmail}</div>
            <div className="mt-1">
              <Badge variant={isAdmin ? "purple" : "neutral"} size="sm">
                {(session?.user as any)?.role || "User"}
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* Organisation branding */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Palette size={16} className="text-stone-600" />
            <h3 className="text-sm font-semibold text-stone-900">Organisation branding</h3>
          </div>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  Display name
                </label>
                <input
                  value={brandingForm.displayName}
                  onChange={e => setBrandingForm(p => ({ ...p, displayName: e.target.value }))}
                  placeholder={orgSettings?.name || "Company name shown in sidebar"}
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
                <p className="text-[11px] text-stone-400 mt-1">Override the sidebar company name.</p>
              </div>
              <div>
                <label className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider block mb-1">
                  Logo URL
                </label>
                <input
                  value={brandingForm.logoUrl}
                  onChange={e => setBrandingForm(p => ({ ...p, logoUrl: e.target.value }))}
                  placeholder="https://example.com/logo.png"
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-200 focus:ring-2 focus:ring-stone-900 focus:outline-none"
                />
                <p className="text-[11px] text-stone-400 mt-1">Paste a URL to your company logo (PNG/SVG).</p>
              </div>
            </div>

            {brandingForm.logoUrl && (
              <div className="flex items-center gap-3 p-3 bg-stone-50 rounded-md ring-1 ring-stone-100">
                <img
                  src={brandingForm.logoUrl}
                  alt="Logo preview"
                  className="w-10 h-10 object-contain rounded"
                  onError={e => (e.currentTarget.style.display = "none")}
                />
                <div>
                  <div className="text-sm font-semibold text-stone-900">
                    {brandingForm.displayName || orgSettings?.name || "Company name"}
                  </div>
                  <div className="text-[10px] text-stone-500 tracking-wide">COLLECTIONS CRM</div>
                </div>
                <span className="ml-auto text-[11px] text-stone-400">Sidebar preview</span>
              </div>
            )}

            <Button
              size="sm"
              disabled={savingBranding}
              onClick={async () => {
                setSavingBranding(true);
                try {
                  await updateOrgSettings({
                    logoUrl: brandingForm.logoUrl || null,
                    displayName: brandingForm.displayName || null,
                  });
                } finally {
                  setSavingBranding(false);
                }
              }}
            >
              {savingBranding ? "Saving…" : "Save branding"}
            </Button>
          </div>
        </Card>
      )}

      {/* Date format */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Calendar size={16} className="text-stone-600" />
            <h3 className="text-sm font-semibold text-stone-900">Date format</h3>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-2">
              {[
                { value: "DD MMM YYYY",  label: "07 May 2026",  desc: "DD MMM YYYY" },
                { value: "DD/MM/YYYY",   label: "07/05/2026",   desc: "DD/MM/YYYY" },
                { value: "MM/DD/YYYY",   label: "05/07/2026",   desc: "MM/DD/YYYY" },
                { value: "YYYY-MM-DD",   label: "2026-05-07",   desc: "YYYY-MM-DD" },
                { value: "MMM DD, YYYY", label: "May 07, 2026", desc: "MMM DD, YYYY" },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => setDateFormat(opt.value)}
                  className={`px-3 py-2 rounded-md text-left text-sm border transition-colors ${
                    dateFormat === opt.value
                      ? "bg-stone-900 text-white border-stone-900"
                      : "bg-white text-stone-700 border-stone-200 hover:border-stone-400"
                  }`}
                >
                  <div className="font-medium font-mono">{opt.label}</div>
                  <div className={`text-[10px] ${dateFormat === opt.value ? "text-stone-300" : "text-stone-400"}`}>
                    {opt.desc}
                  </div>
                </button>
              ))}
            </div>
            <Button
              size="sm"
              disabled={savingDateFormat}
              onClick={async () => {
                setSavingDateFormat(true);
                try {
                  await updateOrgSettings({ dateFormat });
                } finally {
                  setSavingDateFormat(false);
                }
              }}
            >
              {savingDateFormat ? "Saving…" : "Save date format"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
