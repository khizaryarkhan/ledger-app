"use client";

import { useState, useEffect } from "react";
import { useData } from "@/components/data-provider";
import { Card } from "@/components/ui";
import { BarChart3, CheckCircle, AlertCircle, Loader, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function ReportingSettingsPage() {
  const { orgSettings, updateOrgSettings, toast } = useData();
  const [saving, setSaving]       = useState(false);
  const [qboStatus, setQboStatus] = useState<any>(null);
  const [xeroStatus, setXeroStatus] = useState<any>(null);

  useEffect(() => {
    fetch("/api/qbo/sync").then(r => r.json()).then(setQboStatus).catch(() => setQboStatus({ connected: false }));
    fetch("/api/xero/sync").then(r => r.json()).then(setXeroStatus).catch(() => setXeroStatus({ connected: false }));
  }, []);

  const isConnected = qboStatus?.connected || xeroStatus?.connected;
  const connectedLabel = qboStatus?.connected
    ? `QuickBooks · ${qboStatus.companyName || "QBO"}`
    : xeroStatus?.connected
    ? `Xero · ${xeroStatus.tenantName || "Xero"}`
    : null;

  const handleToggle = async () => {
    if (!isConnected && !orgSettings.reportingEnabled) return;
    setSaving(true);
    try {
      await updateOrgSettings({ reportingEnabled: !orgSettings.reportingEnabled });
      toast(orgSettings.reportingEnabled ? "Reporting module disabled" : "Reporting module enabled");
    } catch {
      toast("Failed to update setting", "error");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-6 max-w-[680px] mx-auto">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-xs text-stone-500 hover:text-stone-300 mb-6 transition-colors">
        <ArrowLeft size={13} /> Back to Settings
      </Link>

      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
          <BarChart3 size={20} className="text-blue-400" />
        </div>
        <div>
          <h1 className="text-base font-semibold text-white">Reporting</h1>
          <p className="text-xs text-stone-500 mt-0.5">Native financial reports pulled live from QuickBooks or Xero</p>
        </div>
      </div>

      {/* Integration status */}
      <Card padding="md" className="mb-4">
        <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Integration</h2>
        {qboStatus === null && xeroStatus === null ? (
          <div className="flex items-center gap-2 text-xs text-stone-400">
            <Loader size={12} className="animate-spin" /> Checking connection…
          </div>
        ) : isConnected ? (
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-400" />
            <span className="text-sm text-stone-200">{connectedLabel}</span>
            <span className="ml-auto text-[11px] text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">Connected</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <AlertCircle size={14} className="text-amber-400" />
            <span className="text-sm text-stone-400">No integration connected.</span>
            <Link href="/settings/integrations" className="ml-auto text-xs text-blue-400 hover:underline">
              Connect QuickBooks or Xero →
            </Link>
          </div>
        )}
      </Card>

      {/* Enable toggle */}
      <Card padding="md" className="mb-4">
        <div className="flex items-start gap-4">
          <div className="flex-1">
            <h2 className="text-sm font-semibold text-white mb-1">Enable Reporting module</h2>
            <p className="text-xs text-stone-500 leading-relaxed">
              Adds a <span className="text-blue-400 font-medium">Reporting</span> tab to the sidebar with live P&amp;L,
              Balance Sheet, Cash Flow, Ageing reports, and more — fetched directly from your connected accounting system.
              Reports always reflect real-time data; no additional sync is needed.
            </p>
            {!isConnected && !orgSettings.reportingEnabled && (
              <p className="text-xs text-amber-400 mt-2">Connect an integration above before enabling Reporting.</p>
            )}
          </div>
          <button
            onClick={handleToggle}
            disabled={saving || (!isConnected && !orgSettings.reportingEnabled)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors shrink-0 mt-0.5 ${
              orgSettings.reportingEnabled ? "bg-blue-500" : "bg-stone-700"
            } ${saving || (!isConnected && !orgSettings.reportingEnabled) ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
              orgSettings.reportingEnabled ? "translate-x-6" : "translate-x-1"
            }`} />
          </button>
        </div>
      </Card>

      {/* Available reports */}
      <Card padding="md">
        <h2 className="text-xs font-semibold text-stone-400 uppercase tracking-wider mb-3">Available Reports</h2>
        <div className="space-y-2">
          {[
            { name: "Profit & Loss",    desc: "Income, expenses, and net profit for a period",      qbo: true, xero: true },
            { name: "Balance Sheet",    desc: "Assets, liabilities, and equity at a point in time", qbo: true, xero: true },
            { name: "Cash Flow",        desc: "Cash inflows and outflows for a period",             qbo: true, xero: true },
            { name: "Trial Balance",    desc: "All account balances for reconciliation",            qbo: true, xero: true },
            { name: "AR Ageing",        desc: "Outstanding receivables by age bucket",              qbo: true, xero: true },
            { name: "AP Ageing",        desc: "Outstanding payables by age bucket",                 qbo: true, xero: true },
            { name: "Executive Summary", desc: "High-level financial KPIs",                         qbo: false, xero: true },
            { name: "Bank Summary",     desc: "Bank account balances and movements",                qbo: false, xero: true },
          ].map(r => (
            <div key={r.name} className="flex items-center gap-3 py-1.5">
              <span className="text-sm text-stone-300 flex-1">{r.name}</span>
              <span className="text-[11px] text-stone-500 flex-1">{r.desc}</span>
              <div className="flex gap-1.5">
                {r.qbo  && <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400">QBO</span>}
                {r.xero && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400">Xero</span>}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
