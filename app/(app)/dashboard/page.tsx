"use client";

import { useMemo, useState, useEffect } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { useSession } from "next-auth/react";
import { Card, Badge } from "@/components/ui";
import { fmt, daysOverdue, getAgingBucket, daysFromNow, today } from "@/lib/format";
import { ArrowUpRight, ChevronRight, Circle, AlertTriangle, Mail } from "lucide-react";
import { ResponsesDashboardWidget } from "@/components/responses-dashboard-widget";

// ── Shared open-balance helper ───────────────────────────────────────────────
// Uses qboBalance as the authoritative figure (set directly by the AR snapshot
// engine) and falls back to total-paid for any rows that pre-date the snapshot.
// Both the Dashboard KPI cards and the AR Health widget call this so they can
// never diverge.
function openBal(inv: any): number {
  if (inv.qboBalance != null) return Number(inv.qboBalance);
  return Math.max(0, Number(inv.total || 0) - Number(inv.paid || 0));
}

// ── AR Health widget ────────────────────────────────────────────────────────
function ArHealthWidget({ invoices, customers, projects, reps, communications, ccy }: any) {
  const filteredInvoices = invoices;

  const metrics = useMemo(() => {
    // All invoices the snapshot considers open (i.e. have a QBO open balance).
    // Do NOT filter on collectionStage here — "Closed" is a user-assigned
    // collection-tracking stage, not a payment status. If the snapshot included
    // the invoice it has a real outstanding balance and must be counted.
    const open = filteredInvoices.filter((i: any) =>
      i.paymentStatus !== "Paid" &&
      i.paymentStatus !== "Written Off" &&
      i.txnType !== "CreditMemo"
    );
    const activeCMs = filteredInvoices.filter((i: any) => i.txnType === "CreditMemo" && openBal(i) < 0);
    // Net AR = gross invoice balances minus unapplied credits (matches AR Reports)
    const grossAR   = open.reduce((s: number, i: any) => s + openBal(i), 0);
    const creditBal = activeCMs.reduce((s: number, i: any) => s + openBal(i), 0);
    const totalAR   = grossAR + creditBal;

    // Aging buckets — Current includes CM credits as negative offsets
    const current = open.filter((i: any) => daysOverdue(i.dueDate) <= 0).reduce((s: number, i: any) => s + openBal(i), 0)
      + activeCMs.reduce((s: number, i: any) => s + openBal(i), 0);
    const b1_30   = open.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > 0 && d <= 30; }).reduce((s: number, i: any) => s + openBal(i), 0);
    const b31_60  = open.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > 30 && d <= 60; }).reduce((s: number, i: any) => s + openBal(i), 0);
    const b61_90  = open.filter((i: any) => { const d = daysOverdue(i.dueDate); return d > 60 && d <= 90; }).reduce((s: number, i: any) => s + openBal(i), 0);
    const b90plus = open.filter((i: any) => daysOverdue(i.dueDate) > 90).reduce((s: number, i: any) => s + openBal(i), 0);

    const currentPct  = totalAR > 0 ? (current  / totalAR) * 100 : 0;
    const over90Pct   = totalAR > 0 ? (b90plus  / totalAR) * 100 : 0;
    const overdueRate = totalAR > 0 ? ((totalAR - current) / totalAR) * 100 : 0;

    const disputedAR  = open.filter((i: any) => i.collectionStage === "Disputed").reduce((s: number, i: any) => s + openBal(i), 0);
    const disputeRate = totalAR > 0 ? (disputedAR / totalAR) * 100 : 0;
    const highRiskAR  = open.filter((i: any) => {
      const c = customers.find((c: any) => c.id === i.customerId);
      return c?.riskRating === "High";
    }).reduce((s: number, i: any) => s + openBal(i), 0);
    const highRiskPct = totalAR > 0 ? (highRiskAR / totalAR) * 100 : 0;

    const brokenPromises = open.filter((i: any) =>
      (i.collectionStage === "Promised" || i.collectionStage === "Promise to Pay") &&
      i.promiseDate && daysOverdue(i.promiseDate) > 0
    ).length;
    const neverContacted = open.filter((i: any) => daysOverdue(i.dueDate) > 0 && !i.lastFollowupDate).length;

    const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const emails30d  = communications.filter((c: any) => c.direction === "Outbound" && c.channel === "Email" && new Date(c.sentAt).getTime() > thirtyDaysAgo).length;
    const replies30d = communications.filter((c: any) => c.direction === "Inbound"  && new Date(c.sentAt).getTime() > thirtyDaysAgo).length;

    const byCust: Record<string, number> = {};
    open.forEach((i: any) => { byCust[i.customerId] = (byCust[i.customerId] || 0) + openBal(i); });
    const concentrationRows = Object.entries(byCust)
      .map(([cid, amt]) => ({ customer: customers.find((c: any) => c.id === cid), amount: amt as number, pct: totalAR > 0 ? ((amt as number) / totalAR) * 100 : 0 }))
      .filter(x => x.customer)
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 10);

    const repPortfolio = (reps ?? []).map((rep: any) => {
      const repInvs = open.filter((i: any) => {
        const c = customers.find((c: any) => c.id === i.customerId);
        const p = projects.find((p: any) => p.id === i.projectId);
        return c?.repId === rep.id || p?.repId === rep.id;
      });
      const repOpen    = repInvs.reduce((s: number, i: any) => s + openBal(i), 0);
      const repOverdue = repInvs.filter((i: any) => daysOverdue(i.dueDate) > 0).reduce((s: number, i: any) => s + openBal(i), 0);
      const custIds    = new Set(repInvs.map((i: any) => i.customerId));
      return { rep, openAR: repOpen, overdueAR: repOverdue, custCount: custIds.size };
    }).filter((r: any) => r.openAR > 0 || r.overdueAR > 0);

    return {
      totalAR, current, b1_30, b31_60, b61_90, b90plus,
      currentPct, over90Pct, overdueRate,
      disputeRate, highRiskPct,
      brokenPromises, neverContacted,
      concentrationRows, repPortfolio,
      openCount: open.length,
    };
  }, [filteredInvoices, customers, projects, reps, communications]);

  const {
    totalAR, current, b1_30, b31_60, b61_90, b90plus,
    currentPct, over90Pct, overdueRate,
    disputeRate, highRiskPct,
    brokenPromises, neverContacted,
    concentrationRows, repPortfolio,
    openCount,
  } = metrics;

  const overdueCount = filteredInvoices.filter((i: any) =>
    i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" &&
    i.txnType !== "CreditMemo" &&
    daysOverdue(i.dueDate) > 0
  ).length;

  const agingScore = totalAR > 0
    ? Math.round((current * 100 + b1_30 * 70 + b31_60 * 40 + b61_90 * 20 + b90plus * 5) / totalAR)
    : 100;

  const riskScore = Math.round(Math.max(10,
    100 - Math.min(disputeRate * 3, 50) - Math.min(highRiskPct * 1, 40)
  ));

  const brokenPromiseRate  = openCount    > 0 ? (brokenPromises / openCount)    * 100 : 0;
  const neverContactedRate = overdueCount > 0 ? (neverContacted / overdueCount) * 100 : 0;
  const collectionScore = Math.round(Math.max(10,
    100
    - Math.min(neverContactedRate * 0.5, 45)
    - Math.min(brokenPromiseRate  * 1.5, 35)
    - Math.min(over90Pct          * 0.4, 20)
  ));

  const scores = { aging: agingScore, risk: riskScore, collection: collectionScore };
  const overallScore = Math.round((scores.aging + scores.risk + scores.collection) / 3);
  const maxBucket = Math.max(current, b1_30, b31_60, b61_90, b90plus, 1);

  return (
    <div className="space-y-4">
      {/* Score banner */}
      <div className="bg-gradient-to-r from-stone-900 to-stone-800 rounded-xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-stone-400 mb-1">AR Health Score</div>
            <div className="text-5xl font-bold tabular-nums">{overallScore}<span className="text-2xl text-stone-400">/100</span></div>
            <div className="text-sm text-stone-400 mt-2">
              {overallScore >= 80 ? "Excellent — AR management is best-in-class" :
               overallScore >= 60 ? "Good — room for improvement in a few areas" :
               overallScore >= 40 ? "Fair — significant collection issues present" :
               "Needs attention — multiple AR health risks identified"}
            </div>
          </div>
          <div className="flex gap-5">
            {([
              { label: "Aging",      score: scores.aging,      tip: "Weighted by bucket age" },
              { label: "Risk",       score: scores.risk,       tip: "Disputed AR + high-risk customers" },
              { label: "Collection", score: scores.collection, tip: "Broken promises + uncontacted overdue" },
            ] as { label: string; score: number; tip: string }[]).map(({ label, score, tip }) => (
              <div key={label} className="text-center group relative">
                <div className="relative w-16 h-16 mx-auto mb-1">
                  <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                    <circle cx="18" cy="18" r="15.9" fill="none" stroke="#44403c" strokeWidth="3" />
                    <circle cx="18" cy="18" r="15.9" fill="none" strokeWidth="3"
                      stroke={score >= 70 ? "#34d399" : score >= 40 ? "#fbbf24" : "#f87171"}
                      strokeDasharray={`${score} 100`} strokeLinecap="round" />
                  </svg>
                  <div className="absolute inset-0 flex items-center justify-center text-sm font-bold">{score}</div>
                </div>
                <div className="text-[11px] text-stone-400">{label}</div>
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 hidden group-hover:block z-10 bg-stone-700 text-white text-[10px] rounded px-2 py-1 whitespace-nowrap">{tip}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Aging overview + distribution + indicators */}
      <div className="grid grid-cols-3 gap-3">
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">AR Overdue Overview</div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <div className="bg-stone-50 rounded-lg p-3 text-center">
              <div className="text-xl font-bold text-stone-900 tabular-nums">{fmt.money(totalAR, ccy)}</div>
              <div className="text-[10px] text-stone-500 mt-0.5">Total Open AR</div>
            </div>
            <div className={`rounded-lg p-3 text-center ${overdueRate > 50 ? "bg-rose-50" : overdueRate > 25 ? "bg-amber-50" : "bg-emerald-50"}`}>
              <div className={`text-xl font-bold tabular-nums ${overdueRate > 50 ? "text-rose-700" : overdueRate > 25 ? "text-amber-700" : "text-emerald-700"}`}>
                {overdueRate.toFixed(0)}%
              </div>
              <div className="text-[10px] text-stone-500 mt-0.5">Overdue Rate</div>
            </div>
          </div>
          <div className="space-y-2">
            {[
              { label: "Current (not due)", value: current, pct: currentPct, color: "bg-emerald-500" },
              { label: "Overdue 1–30d",     value: b1_30,   pct: totalAR > 0 ? (b1_30  / totalAR) * 100 : 0, color: "bg-amber-400" },
              { label: "Overdue 31–90d",    value: b31_60 + b61_90, pct: totalAR > 0 ? ((b31_60 + b61_90) / totalAR) * 100 : 0, color: "bg-orange-500" },
              { label: "Overdue 90+ days",  value: b90plus, pct: over90Pct, color: "bg-rose-600" },
            ].map(({ label, value, pct, color }) => (
              <div key={label} className="flex items-center gap-2 text-[11px]">
                <div className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
                <div className="flex-1 text-stone-600">{label}</div>
                <div className="font-semibold text-stone-800 tabular-nums">{fmt.money(value, ccy)}</div>
                <div className="w-9 text-right text-stone-400">{pct.toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-3">Aging Distribution</div>
          <div className="space-y-2.5">
            {[
              { label: "Current",  value: current, color: "bg-emerald-500", pct: totalAR > 0 ? (current / totalAR) * 100 : 0 },
              { label: "1-30d",    value: b1_30,   color: "bg-amber-400",   pct: totalAR > 0 ? (b1_30  / totalAR) * 100 : 0 },
              { label: "31-60d",   value: b31_60,  color: "bg-orange-500",  pct: totalAR > 0 ? (b31_60 / totalAR) * 100 : 0 },
              { label: "61-90d",   value: b61_90,  color: "bg-rose-500",    pct: totalAR > 0 ? (b61_90 / totalAR) * 100 : 0 },
              { label: "90+ days", value: b90plus, color: "bg-rose-800",    pct: totalAR > 0 ? (b90plus / totalAR) * 100 : 0 },
            ].map(({ label, value, color, pct }) => (
              <div key={label} className="flex items-center gap-2">
                <div className="w-14 text-[11px] text-stone-500 font-medium">{label}</div>
                <div className="flex-1 h-5 bg-stone-100 rounded overflow-hidden">
                  <div className={`h-full ${color}`} style={{ width: `${(value / maxBucket) * 100}%` }} />
                </div>
                <div className="w-10 text-right text-[11px] font-semibold text-stone-600 tabular-nums">{pct.toFixed(0)}%</div>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-3">Health Indicators</div>
          <div className="space-y-3">
            {[
              { label: "Current AR",             value: `${currentPct.toFixed(1)}%`,   sub: "% not yet due",                 good: currentPct > 60,        warn: currentPct < 40 },
              { label: "90+ days overdue",        value: `${over90Pct.toFixed(1)}%`,    sub: "% in oldest bucket",            good: over90Pct < 5,          warn: over90Pct > 15 },
              { label: "Dispute rate",            value: `${disputeRate.toFixed(1)}%`,  sub: "AR value in Disputed stage",    good: disputeRate < 2,         warn: disputeRate > 5 },
              { label: "High-risk customer AR",   value: `${highRiskPct.toFixed(1)}%`,  sub: "Held by High risk customers",   good: highRiskPct < 10,        warn: highRiskPct > 25 },
              { label: "No contact (overdue)",    value: String(neverContacted),        sub: "Overdue with zero follow-up",   good: neverContacted === 0,    warn: neverContacted > 5 },
              { label: "Broken promises",         value: String(brokenPromises),        sub: "Promise date passed, still open", good: brokenPromises === 0,  warn: brokenPromises > 2 },
            ].map(({ label, value, sub, good, warn }) => (
              <div key={label} className="flex items-center justify-between">
                <div>
                  <div className="text-[12px] font-medium text-stone-800">{label}</div>
                  <div className="text-[10px] text-stone-400">{sub}</div>
                </div>
                <div className={`text-sm font-bold tabular-nums px-2 py-0.5 rounded ${good ? "text-emerald-700 bg-emerald-50" : warn ? "text-rose-700 bg-rose-50" : "text-amber-700 bg-amber-50"}`}>
                  {value}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Largest debtors + Rep breakdown */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">Largest Open Balances</div>
          <div className="space-y-2">
            {concentrationRows.length === 0 ? (
              <div className="py-6 text-center text-sm text-stone-500">No open AR</div>
            ) : concentrationRows.map(({ customer, amount, pct }: any, idx: number) => (
              <div key={customer.id} className="flex items-center gap-2">
                <span className="w-5 text-[11px] text-stone-400 font-mono text-right shrink-0">{idx + 1}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-[12px] font-medium text-stone-800 truncate">{customer.name}</span>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span className="text-[11px] tabular-nums text-stone-700 font-semibold">{fmt.money(amount, ccy)}</span>
                      <span className="text-[11px] text-stone-400 w-9 text-right">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-stone-400" style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {repPortfolio.length > 0 ? (
          <Card>
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-4">AR by Rep</div>
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-stone-100">
                  <th className="text-left py-1.5 font-semibold text-stone-500 pr-3">Rep</th>
                  <th className="text-right py-1.5 font-semibold text-stone-500 pr-3">Open AR</th>
                  <th className="text-right py-1.5 font-semibold text-stone-500 pr-3">Overdue</th>
                  <th className="text-right py-1.5 font-semibold text-stone-500">% Overdue</th>
                </tr>
              </thead>
              <tbody>
                {repPortfolio.map(({ rep, openAR, overdueAR }: any) => {
                  const overdPct = openAR > 0 ? (overdueAR / openAR) * 100 : 0;
                  return (
                    <tr key={rep.id} className="border-b border-stone-50 last:border-0">
                      <td className="py-2 font-medium text-stone-800 pr-3">{rep.name}</td>
                      <td className="py-2 text-right tabular-nums text-stone-700 pr-3">{fmt.money(openAR, ccy)}</td>
                      <td className={`py-2 text-right tabular-nums pr-3 font-semibold ${overdueAR > 0 ? "text-rose-600" : "text-emerald-600"}`}>{fmt.money(overdueAR, ccy)}</td>
                      <td className={`py-2 text-right tabular-nums font-medium ${overdPct > 50 ? "text-rose-600" : overdPct > 25 ? "text-amber-600" : "text-stone-500"}`}>
                        {overdPct.toFixed(0)}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        ) : (
          <Card>
            <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">AR by Rep</div>
            <div className="py-6 text-center text-sm text-stone-400">No reps assigned</div>
          </Card>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { invoices, customers, contacts, projects, regions, communications, tasks, reps, orgSettings } = useData() as any;
  const ccy: string = orgSettings?.currency ?? "EUR";
  const { data: session } = useSession();
  const userId = (session?.user as any)?.id;

  // ── AR Snapshot — same source used by all Reports pages ─────────────────
  // Ensures every financial figure on the dashboard reconciles with AR Reports.
  const [snapshotInvoices, setSnapshotInvoices] = useState<any[] | null>(null);
  const [snapshotLoading, setSnapshotLoading] = useState(true);

  useEffect(() => {
    const todayStr = new Date().toISOString().slice(0, 10);
    setSnapshotLoading(true);
    fetch(`/api/reports/ar-snapshot?asOf=${todayStr}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => setSnapshotInvoices(Array.isArray(data) ? data : null))
      .catch(() => setSnapshotInvoices(null))
      .finally(() => setSnapshotLoading(false));
  }, []);

  // Merge snapshot (authoritative open balances) with local invoice metadata
  // (collectionStage, promiseDate, lastFollowupDate, paymentStatus) so that
  // both financial totals AND collection-stage metrics are accurate.
  const effectiveInvoices = useMemo(() => {
    if (!snapshotInvoices) return invoices;
    const localMap = new Map((invoices as any[]).map((i: any) => [i.id, i]));
    return snapshotInvoices.map((snap: any) => {
      const local = localMap.get(snap.id);
      if (local) {
        return {
          ...snap,
          // Enrich with local metadata for collection-stage tracking.
          // Do NOT override paymentStatus — the snapshot is the authority
          // on which invoices are still open (avoids stale-local-DB mismatches).
          collectionStage:  local.collectionStage,
          promiseDate:      local.promiseDate,
          lastFollowupDate: local.lastFollowupDate,
          currency:         local.currency ?? snap.currency,
        };
      }
      return snap;
    });
  }, [snapshotInvoices, invoices]);

  // Detect mixed currencies — warn when AR data spans multiple currencies.
  // The dashboard sums all open balances into one number using the org's home
  // currency symbol, which is misleading when EUR and GBP invoices coexist.
  const hasMixedCurrencies = useMemo(() => {
    const seen = new Set<string>();
    for (const inv of effectiveInvoices) {
      if (inv.currency && inv.txnType !== "CreditMemo") seen.add(inv.currency);
      if (seen.size > 1) return true;
    }
    return false;
  }, [effectiveInvoices]);

  // Setup checklist state
  const [smtpConfigured, setSmtpConfigured] = useState<boolean | null>(null);
  const [hasTemplates, setHasTemplates] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/email/status")
      .then(r => r.json())
      .then(d => setSmtpConfigured(!!d.configured))
      .catch(() => setSmtpConfigured(false));
    fetch("/api/email-templates")
      .then(r => r.json())
      .then(d => setHasTemplates(Array.isArray(d) ? d.length > 0 : false))
      .catch(() => setHasTemplates(false));
  }, []);

  const setupLoading = smtpConfigured === null || hasTemplates === null;

  const setupSteps = useMemo(() => {
    const qboConnected = invoices.length > 0;
    const hasAutoContacts = (contacts ?? []).filter((c: any) => c.receivesAuto).length > 0;
    return [
      { label: "Connect QuickBooks", done: qboConnected, href: "/settings/integrations" },
      { label: "Configure email (SMTP)", done: !!smtpConfigured, href: "/settings/company" },
      { label: "Create an email template", done: !!hasTemplates, href: "/automations" },
      { label: "Enable reminder programme", done: hasAutoContacts, href: "/automations" },
    ];
  }, [invoices, contacts, smtpConfigured, hasTemplates]);

  const setupComplete = setupSteps.every(s => s.done);
  const setupDoneCount = setupSteps.filter(s => s.done).length;

  // Priority alerts
  const alerts = useMemo(() => {
    const list: Array<{ type: string; label: string; sub: string; color: string; href: string; icon: string }> = [];

    const brokenPromises = effectiveInvoices.filter((i: any) =>
      (i.collectionStage === "Promised" || i.collectionStage === "Promise to Pay") &&
      i.promiseDate &&
      new Date(i.promiseDate) < new Date() &&
      i.paymentStatus !== "Paid"
    );
    if (brokenPromises.length > 0) {
      list.push({
        type: "broken_promise",
        label: `${brokenPromises.length} broken promise${brokenPromises.length > 1 ? "s" : ""}`,
        sub: "Payment dates passed — follow up now",
        color: "rose",
        href: "/smart-views",
        icon: "AlertTriangle",
      });
    }

    const neglected90 = effectiveInvoices.filter((i: any) => {
      if (i.paymentStatus === "Paid" || i.paymentStatus === "Written Off") return false;
      if (i.txnType === "CreditMemo") return false;
      const days = Math.floor((Date.now() - new Date(i.dueDate + "T12:00:00Z").getTime()) / 86400000);
      return days > 90;
    });
    if (neglected90.length > 0) {
      const total = neglected90.reduce((s: number, i: any) => s + openBal(i), 0);
      list.push({
        type: "overdue_90",
        label: `90+ day debt: ${new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy, minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(total)}`,
        sub: `${neglected90.length} invoice${neglected90.length > 1 ? "s" : ""} — escalate or write off`,
        color: "rose",
        href: "/smart-views",
        icon: "AlertTriangle",
      });
    }

    const noEmail = (contacts ?? []).filter((c: any) => c.receivesAuto && !c.email);
    if (noEmail.length > 0) {
      list.push({
        type: "no_email",
        label: `${noEmail.length} contact${noEmail.length > 1 ? "s" : ""} missing email`,
        sub: "Programme is ON but no email — reminders won't send",
        color: "amber",
        href: "/automations",
        icon: "Mail",
      });
    }

    return list;
  }, [effectiveInvoices, contacts, ccy]);

  const stats = useMemo(() => {
    const regionInvoices = effectiveInvoices;
    // Open invoices (exclude CMs for counting/stage/overdue logic)
    const open = regionInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
    // Unapplied credits / credit memos — openBal() returns negative for these
    const activeCMs = regionInvoices.filter((i: any) => i.txnType === "CreditMemo" && openBal(i) < 0);
    // Net AR = gross invoices minus unapplied credits — uses same openBal() as AR Health widget
    const grossReceivable = open.reduce((s: number, i: any) => s + openBal(i), 0);
    const creditBalance   = activeCMs.reduce((s: number, i: any) => s + openBal(i), 0); // ≤ 0
    const totalReceivable = grossReceivable + creditBalance;
    const overdue = open.filter((i: any) => daysOverdue(i.dueDate) > 0);
    const totalOverdue = overdue.reduce((s: number, i: any) => s + openBal(i), 0);
    // Aging buckets — CMs land in Current as negative credits (same as AR Reports)
    const buckets: Record<string, number> = { "Current": 0, "1-30": 0, "31-60": 0, "61-90": 0, "90+": 0 };
    open.forEach((i: any) => { buckets[getAgingBucket(i)] += openBal(i); });
    activeCMs.forEach((i: any) => { buckets["Current"] += openBal(i); });
    const disputed = open.filter((i: any) => i.collectionStage === "Disputed").reduce((s: number, i: any) => s + openBal(i), 0);
    const promised = open.filter((i: any) => i.collectionStage === "Promised" || i.collectionStage === "Promise to Pay").reduce((s: number, i: any) => s + openBal(i), 0);
    const dueThisWeek = open.filter((i: any) => { const d = daysOverdue(i.dueDate); return d <= 0 && d >= -7; });
    const sevenDaysAgo = new Date(daysFromNow(-7)).getTime();
    const emailsSent = communications.filter((c: any) => c.direction === "Outbound" && c.channel === "Email" && new Date(c.sentAt).getTime() > sevenDaysAgo).length;
    const replies = communications.filter((c: any) => c.direction === "Inbound" && new Date(c.sentAt).getTime() > sevenDaysAgo).length;



    // 90+ days overdue
    const over90 = open.filter((i: any) => daysOverdue(i.dueDate) > 90).reduce((s: number, i: any) => s + openBal(i), 0);

    // Proactive pipeline: due in 7-14 days, no lastFollowupDate
    const proactivePipeline = open.filter((i: any) => {
      const d = daysOverdue(i.dueDate);
      return d < -6 && d >= -14 && !i.lastFollowupDate;
    });

    return { totalReceivable, totalOverdue, buckets, disputed, promised, dueThisWeek, overdue, emailsSent, replies, openCount: open.length, over90, proactivePipeline };
  }, [effectiveInvoices, invoices, customers, projects, communications]);

  const topOverdue = useMemo(() => {
    const byCust: Record<string, number> = {};
    effectiveInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.txnType !== "CreditMemo" && daysOverdue(i.dueDate) > 0).forEach((i: any) => {
      byCust[i.customerId] = (byCust[i.customerId] || 0) + openBal(i);
    });
    return Object.entries(byCust).map(([cid, amt]) => ({ customer: customers.find((c: any) => c.id === cid), amount: amt }))
      .filter(x => x.customer).sort((a, b) => b.amount - a.amount).slice(0, 5);
  }, [effectiveInvoices, customers]);

  // Concentration risk — top 5 customers by total open AR
  const concentrationRisk = useMemo(() => {
    const byCust: Record<string, number> = {};
    const open = effectiveInvoices.filter((i: any) => i.paymentStatus !== "Paid" && i.paymentStatus !== "Written Off" && i.txnType !== "CreditMemo");
    const totalAR = open.reduce((s: number, i: any) => s + openBal(i), 0);
    open.forEach((i: any) => { byCust[i.customerId] = (byCust[i.customerId] || 0) + openBal(i); });
    const sorted = Object.entries(byCust).map(([cid, amt]) => ({
      customer: customers.find((c: any) => c.id === cid),
      amount: amt,
      pct: totalAR > 0 ? (amt / totalAR) * 100 : 0,
    })).filter(x => x.customer).sort((a, b) => b.amount - a.amount).slice(0, 5);
    const top5Pct = totalAR > 0 ? sorted.reduce((s, x) => s + x.pct, 0) : 0;
    return { rows: sorted, top5Pct, totalAR };
  }, [effectiveInvoices, customers]);

  // AR by Region — net open AR grouped per region (matches Reports → Aging by Region).
  // Invoices contribute positive balances; CreditMemos contribute negative credits
  // (unapplied credits reduce the region total). This ensures the per-region totals
  // reconcile with both the KPI cards and the Reports page.
  const arByRegion = useMemo(() => {
    const openInvoices = effectiveInvoices.filter((i: any) =>
      i.paymentStatus !== "Paid" &&
      i.paymentStatus !== "Written Off" &&
      i.txnType !== "CreditMemo"
    );
    // Unapplied credits (CMs with a negative open balance)
    const activeCMs = effectiveInvoices.filter((i: any) =>
      i.txnType === "CreditMemo" && openBal(i) < 0
    );

    const regionMap: Record<string, { name: string; total: number; overdue: number; count: number }> = {};

    const addRow = (i: any, bal: number, countIt: boolean, overdue: boolean) => {
      const c = customers.find((c: any) => c.id === i.customerId);
      const p = projects.find((p: any) => p.id === i.projectId);
      const regionId = c?.regionId || p?.regionId;
      const region   = (regions ?? []).find((r: any) => r.id === regionId);
      const key  = regionId || "__unassigned__";
      const name = region?.name ?? "Unassigned";
      if (!regionMap[key]) regionMap[key] = { name, total: 0, overdue: 0, count: 0 };
      regionMap[key].total += bal;
      if (countIt) regionMap[key].count += 1;
      if (overdue) regionMap[key].overdue += bal;
    };

    openInvoices.forEach((i: any) => {
      const bal = openBal(i);
      addRow(i, bal, true, daysOverdue(i.dueDate) > 0);
    });

    // CMs land in the region total as negative credits (they don't age)
    activeCMs.forEach((i: any) => addRow(i, openBal(i), false, false));

    return Object.entries(regionMap)
      .map(([id, data]) => ({ id, ...data }))
      .filter(r => r.total !== 0)
      .sort((a, b) => b.total - a.total);
  }, [effectiveInvoices, customers, projects, regions]);

  const myTasks = tasks.filter(t => !t.completed && t.assigneeId === userId).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime()).slice(0, 5);
  const maxBucket = Math.max(...Object.values(stats.buckets), 1);

  return (
    <div className="p-6 max-w-[1400px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Dashboard</h1>
          <p className="text-sm text-stone-500 mt-1">Overview of receivables, aging and collection activity</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-xs text-stone-500 flex items-center gap-1.5">
            {snapshotLoading && <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />}
            Last updated {fmt.date(new Date())}
          </div>
        </div>
      </div>

      {/* Setup Checklist — hidden once all steps complete */}
      {!setupComplete && (
        <div className="bg-gradient-to-r from-stone-900 to-stone-800 text-white rounded-xl p-5 mb-4">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="text-sm font-semibold">Getting started</div>
              <div className="text-[12px] text-stone-400 mt-0.5">Complete these steps to go live</div>
            </div>
            <div className="text-[11px] text-stone-400 shrink-0 ml-4">{setupDoneCount} of 4 steps complete</div>
          </div>
          {/* Progress bar */}
          <div className="h-1.5 bg-stone-700 rounded-full overflow-hidden mb-4">
            <div className="h-full bg-emerald-400 rounded-full transition-all duration-500" style={{ width: `${(setupDoneCount / 4) * 100}%` }} />
          </div>
          {setupLoading ? (
            <div className="space-y-2">
              {[0, 1, 2, 3].map(i => (
                <div key={i} className="h-7 bg-stone-700 rounded-md animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {setupSteps.map((step, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  {step.done ? (
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-500 flex items-center justify-center text-white text-[11px] font-bold">✓</span>
                  ) : (
                    <span className="flex-shrink-0 w-5 h-5 rounded-full border border-stone-600 bg-stone-800" />
                  )}
                  {step.done ? (
                    <span className="text-[12px] text-stone-400 line-through">{step.label}</span>
                  ) : (
                    <Link href={step.href} className="text-[12px] text-white hover:text-emerald-300 underline underline-offset-2">{step.label}</Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* KPI skeleton helper — shown while AR snapshot is loading */}
      {(() => {
        const S = ({ w = "w-28" }: { w?: string }) => (
          <div className={`h-7 ${w} bg-stone-100 animate-pulse rounded mt-1`} />
        );
        const Sub = () => <div className="h-3 w-20 bg-stone-100 animate-pulse rounded mt-2" />;

        return (
          <>
            <div className="grid grid-cols-4 gap-3 mb-3">
              <Card padding="md">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Total Receivable</div>
                  <div className="text-[10px] text-stone-400">As at {new Date().toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" })}</div>
                </div>
                {snapshotLoading ? <><S /><Sub /></> : <>
                  <div className="text-2xl font-semibold text-stone-900 tracking-tight">{fmt.money(stats.totalReceivable, ccy)}</div>
                  <div className="mt-2 text-[11px] text-stone-500">{stats.openCount} open invoices</div>
                </>}
              </Card>
              <Card padding="md">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Overdue</div>
                {snapshotLoading ? <><S /><Sub /></> : <>
                  <div className="text-2xl font-semibold text-rose-600 tracking-tight">{fmt.money(stats.totalOverdue, ccy)}</div>
                  <div className="mt-2 text-[11px] text-stone-500">{stats.overdue.length} overdue invoices</div>
                </>}
              </Card>
              <Card padding="md">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">90+ Days</div>
                {snapshotLoading ? <><S /><Sub /></> : <>
                  <div className="text-2xl font-semibold text-rose-700 tracking-tight">{fmt.money(stats.over90, ccy)}</div>
                  <div className="mt-2 text-[11px] text-stone-500">Escalation candidates</div>
                </>}
              </Card>
              <Card padding="md">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Disputed</div>
                {snapshotLoading ? <><S /><Sub /></> : <>
                  <div className="text-2xl font-semibold text-stone-900 tracking-tight">{fmt.money(stats.disputed, ccy)}</div>
                  <div className="mt-2 text-[11px] text-stone-500">Pending resolution</div>
                </>}
              </Card>
            </div>
            <div className="grid grid-cols-1 gap-3 mb-3">
              <Card padding="md">
                <div className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold mb-2">Promised</div>
                {snapshotLoading ? <><S /><Sub /></> : <>
                  <div className="text-2xl font-semibold text-amber-600 tracking-tight">{fmt.money(stats.promised, ccy)}</div>
                  <div className="mt-2 text-[11px] text-stone-500">Promise to pay</div>
                </>}
              </Card>
            </div>
          </>
        );
      })()}

      {/* Customer Responses summary → inbox */}
      <ResponsesDashboardWidget />

      <div className="grid grid-cols-3 gap-3">
        <Card className="col-span-2">
          <div className="flex items-center justify-between mb-5">
            <h3 className="text-sm font-semibold text-stone-900">Aging buckets</h3>
            <Link href="/reports" className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">Aging report <ArrowUpRight size={12} /></Link>
          </div>
          <div className="space-y-3">
            {["Current", "1-30", "31-60", "61-90", "90+"].map((bucket, i) => {
              const colors = ["bg-emerald-500", "bg-amber-400", "bg-orange-500", "bg-rose-500", "bg-rose-700"];
              const labels = ["Current (not due)", "1-30 days", "31-60 days", "61-90 days", "90+ days"];
              const pct = (stats.buckets[bucket] / maxBucket) * 100;
              return (
                <div key={bucket} className="flex items-center gap-3">
                  <div className="w-32 text-xs text-stone-600 font-medium">{labels[i]}</div>
                  <div className="flex-1 h-7 bg-stone-100 rounded relative overflow-hidden">
                    <div className={`h-full ${colors[i]}`} style={{ width: `${pct}%` }} />
                  </div>
                  <div className="w-28 text-right text-sm font-semibold text-stone-900 tabular-nums">{fmt.money(stats.buckets[bucket], ccy)}</div>
                </div>
              );
            })}
          </div>
        </Card>

        <Card>
          <h3 className="text-sm font-semibold text-stone-900 mb-4">Activity (7 days)</h3>
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between mb-1"><span className="text-xs text-stone-500">Emails sent</span><span className="text-lg font-semibold">{stats.emailsSent}</span></div>
              <div className="h-1.5 bg-stone-100 rounded"><div className="h-full bg-stone-900 rounded" style={{ width: `${Math.min(stats.emailsSent * 10, 100)}%` }} /></div>
            </div>
            <div>
              <div className="flex items-baseline justify-between mb-1"><span className="text-xs text-stone-500">Replies received</span><span className="text-lg font-semibold">{stats.replies}</span></div>
              <div className="h-1.5 bg-stone-100 rounded"><div className="h-full bg-emerald-500 rounded" style={{ width: `${Math.min(stats.replies * 20, 100)}%` }} /></div>
            </div>
            <div className="pt-3 border-t border-stone-100">
              <div className="text-xs text-stone-500 mb-1">Reply rate</div>
              <div className="text-lg font-semibold">{stats.emailsSent ? Math.round(stats.replies / stats.emailsSent * 100) : 0}%</div>
            </div>
          </div>
        </Card>

        <Card className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-stone-900">Top overdue customers</h3>
            <Link href="/customers" className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">View all <ArrowUpRight size={12} /></Link>
          </div>
          {topOverdue.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">No overdue customers</div> : (
            <div className="space-y-1">
              {topOverdue.map(({ customer, amount }, i) => (
                <Link key={customer.id} href={`/customers/${customer.id}`} className="w-full flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-stone-50 group">
                  <div className="w-6 text-xs text-stone-400 font-mono">{i + 1}</div>
                  <div className="w-9 h-9 rounded-md bg-gradient-to-br from-stone-100 to-stone-200 flex items-center justify-center text-stone-600 text-xs font-semibold flex-shrink-0">
                    {customer.name.split(" ").slice(0, 2).map((w: string) => w[0]).join("")}
                  </div>
                  <div className="flex-1 text-left min-w-0">
                    <div className="text-sm font-medium text-stone-900 truncate">{customer.name}</div>
                    <div className="text-[11px] text-stone-500">
                      {customer.code && !customer.code.startsWith("QBO-") ? `${customer.code} · ` : ""}{customer.country}
                    </div>
                  </div>
                  {customer.riskRating === "High" && <Badge variant="red" size="sm">High risk</Badge>}
                  <div className="text-sm font-semibold text-stone-900 tabular-nums">{fmt.money(amount, customer.currency)}</div>
                  <ChevronRight size={14} className="text-stone-300 group-hover:text-stone-500" />
                </Link>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-stone-900">My tasks today</h3>
            <Link href="/tasks" className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">All tasks <ArrowUpRight size={12} /></Link>
          </div>
          {myTasks.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">All caught up</div> : (
            <div className="space-y-2">
              {myTasks.map(t => {
                const overdue = new Date(t.dueDate) < new Date(today());
                const href = t.invoiceId ? `/invoices/${t.invoiceId}` : "/tasks";
                return (
                  <Link key={t.id} href={href} className="w-full flex items-start gap-2.5 px-2 py-2 rounded-md hover:bg-stone-50">
                    <Circle size={14} className="text-stone-300 mt-0.5 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-stone-900 truncate">{t.title}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`text-[11px] ${overdue ? "text-rose-600 font-medium" : "text-stone-500"}`}>{fmt.relative(t.dueDate)}</span>
                        {t.priority === "Urgent" && <Badge variant="red" size="sm">Urgent</Badge>}
                        {t.priority === "High" && <Badge variant="orange" size="sm">High</Badge>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* Priority Attention Alerts */}
        {alerts.length > 0 && (
          <Card className="col-span-2">
            <div className="flex items-center gap-2 mb-4">
              <span className="w-2 h-2 rounded-full bg-orange-500 flex-shrink-0" />
              <h3 className="text-sm font-semibold text-stone-900">Needs attention</h3>
            </div>
            <div className="space-y-2">
              {alerts.map((alert, i) => (
                <Link
                  key={i}
                  href={alert.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-r-lg border-l-2 ${alert.color === "rose" ? "border-rose-500 bg-rose-50 hover:bg-rose-100" : "border-amber-400 bg-amber-50 hover:bg-amber-100"}`}
                >
                  <div className={`flex-shrink-0 ${alert.color === "rose" ? "text-rose-500" : "text-amber-500"}`}>
                    {alert.icon === "AlertTriangle" ? <AlertTriangle size={16} /> : <Mail size={16} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[13px] font-semibold ${alert.color === "rose" ? "text-rose-900" : "text-amber-900"}`}>{alert.label}</div>
                    <div className={`text-[11px] mt-0.5 ${alert.color === "rose" ? "text-rose-600" : "text-amber-700"}`}>{alert.sub}</div>
                  </div>
                  <ChevronRight size={14} className={`flex-shrink-0 ${alert.color === "rose" ? "text-rose-400" : "text-amber-400"}`} />
                </Link>
              ))}
            </div>
          </Card>
        )}

        <Card className="col-span-3">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-stone-900">Invoices due this week</h3>
            <span className="text-xs text-stone-500">{stats.dueThisWeek.length} invoices</span>
          </div>
          {stats.dueThisWeek.length === 0 ? <div className="py-8 text-center text-sm text-stone-500">No invoices due this week</div> : (
            <div className="grid grid-cols-2 gap-2">
              {stats.dueThisWeek.slice(0, 6).map(inv => {
                const customer = customers.find(c => c.id === inv.customerId);
                return (
                  <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center gap-3 p-3 rounded-md ring-1 ring-stone-200 hover:ring-stone-300 hover:bg-stone-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-stone-900 truncate">{customer?.name}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5 font-mono">{inv.invoiceNumber}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-stone-900 tabular-nums">{fmt.money(openBal(inv), inv.currency)}</div>
                      <div className="text-[11px] text-stone-500 mt-0.5">Due {fmt.shortDate(inv.dueDate)}</div>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>

        {/* Concentration Risk */}
        <Card className="col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">Concentration risk</h3>
              <p className="text-[11px] text-stone-500 mt-0.5">Top 5 customers as % of total AR</p>
            </div>
            {concentrationRisk.top5Pct > 50 && (
              <div className="flex items-center gap-1 text-[11px] text-amber-700 bg-amber-50 ring-1 ring-amber-200 px-2 py-1 rounded-md">
                <AlertTriangle size={11} /> High concentration
              </div>
            )}
          </div>
          {concentrationRisk.rows.length === 0 ? (
            <div className="py-6 text-center text-sm text-stone-500">No open AR</div>
          ) : (
            <div className="space-y-2.5">
              {concentrationRisk.rows.map(({ customer, amount, pct }) => (
                <Link key={customer.id} href={`/customers/${customer.id}`} className="block group">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[12px] font-medium text-stone-800 truncate group-hover:text-stone-900">{customer.name}</span>
                    <div className="flex items-center gap-2 ml-2 shrink-0">
                      <span className="text-[11px] font-semibold text-stone-700 tabular-nums">{fmt.money(amount, ccy)}</span>
                      <span className={`text-[11px] font-bold tabular-nums w-10 text-right ${pct > 20 ? "text-amber-600" : "text-stone-500"}`}>{pct.toFixed(1)}%</span>
                    </div>
                  </div>
                  <div className="h-1.5 bg-stone-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${pct > 20 ? "bg-amber-400" : "bg-stone-400"}`} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </Link>
              ))}
              <div className="pt-2 border-t border-stone-100 flex items-center justify-between">
                <span className="text-[11px] text-stone-500">Top 5 total concentration</span>
                <span className={`text-[12px] font-bold tabular-nums ${concentrationRisk.top5Pct > 50 ? "text-amber-600" : "text-emerald-600"}`}>
                  {concentrationRisk.top5Pct.toFixed(1)}%
                </span>
              </div>
            </div>
          )}
        </Card>

        {/* Proactive Pipeline */}
        <Card>
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-stone-900">Proactive pipeline</h3>
              <p className="text-[11px] text-stone-500 mt-0.5">Due in 7–14 days, not yet contacted</p>
            </div>
            <Link href="/smart-views" className="text-xs text-stone-500 hover:text-stone-900 flex items-center gap-1">Smart Views <ArrowUpRight size={12} /></Link>
          </div>
          {stats.proactivePipeline.length === 0 ? (
            <div className="py-6 text-center">
              <div className="text-2xl font-semibold text-emerald-600 mb-1">✓</div>
              <div className="text-sm text-stone-500">All upcoming invoices contacted</div>
            </div>
          ) : (
            <div className="space-y-1.5">
              <div className="text-xs text-amber-700 bg-amber-50 ring-1 ring-amber-200 rounded-md px-3 py-2 mb-3">
                <strong>{stats.proactivePipeline.length}</strong> invoice{stats.proactivePipeline.length !== 1 ? "s" : ""} due soon with no contact logged — reach out now
              </div>
              {stats.proactivePipeline.slice(0, 4).map(inv => {
                const customer = customers.find(c => c.id === inv.customerId);
                const d = Math.abs(daysOverdue(inv.dueDate));
                return (
                  <Link key={inv.id} href={`/invoices/${inv.id}`} className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-stone-50">
                    <div className="flex-1 min-w-0">
                      <div className="text-[12px] font-medium text-stone-800 truncate">{customer?.name}</div>
                      <div className="text-[11px] text-stone-500 font-mono">{inv.invoiceNumber}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-[12px] font-semibold tabular-nums">{fmt.money(inv.total - (inv.paid || 0), inv.currency ?? ccy)}</div>
                      <div className="text-[10px] text-amber-600">in {d}d</div>
                    </div>
                  </Link>
                );
              })}
              {stats.proactivePipeline.length > 4 && (
                <div className="text-center text-[11px] text-stone-400 pt-1">+{stats.proactivePipeline.length - 4} more</div>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ── AR by Region ──────────────────────────────────────────────── */}
      {arByRegion.length > 0 && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-base font-semibold text-stone-900">AR by Region</h2>
              <p className="text-[11px] text-stone-500 mt-0.5">Open receivables broken down by region</p>
            </div>
          </div>
          <div className={`grid gap-3 ${arByRegion.length === 1 ? "grid-cols-1" : arByRegion.length === 2 ? "grid-cols-2" : arByRegion.length === 3 ? "grid-cols-3" : "grid-cols-4"}`}>
            {arByRegion.map(({ id, name, total, overdue, count }) => {
              const overduePct = total > 0 ? (overdue / total) * 100 : 0;
              const currentAmt = total - overdue;
              return (
                <Card key={id} padding="md">
                  <div className="flex items-start justify-between mb-3">
                    <div className="text-[12px] font-semibold text-stone-700 uppercase tracking-wide">{name}</div>
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${overduePct > 50 ? "bg-rose-50 text-rose-600" : overduePct > 25 ? "bg-amber-50 text-amber-600" : "bg-emerald-50 text-emerald-600"}`}>
                      {overduePct.toFixed(0)}% overdue
                    </span>
                  </div>
                  <div className="text-2xl font-semibold text-stone-900 tracking-tight tabular-nums mb-1">
                    {fmt.money(total, ccy)}
                  </div>
                  <div className="text-[11px] text-stone-500 mb-3">{count} open invoice{count !== 1 ? "s" : ""}</div>
                  {/* Stacked bar: current vs overdue */}
                  <div className="h-2 rounded-full overflow-hidden bg-stone-100 mb-2">
                    <div className="h-full flex">
                      {currentAmt > 0 && (
                        <div
                          className="h-full bg-emerald-500"
                          style={{ width: `${total > 0 ? (currentAmt / total) * 100 : 0}%` }}
                        />
                      )}
                      {overdue > 0 && (
                        <div
                          className={`h-full ${overduePct > 50 ? "bg-rose-500" : "bg-amber-400"}`}
                          style={{ width: `${overduePct}%` }}
                        />
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-stone-400">
                    <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> {fmt.money(currentAmt, ccy)} current</span>
                    {overdue > 0 && (
                      <span className={`flex items-center gap-1 font-medium ${overduePct > 50 ? "text-rose-500" : "text-amber-500"}`}>
                        <span className={`w-2 h-2 rounded-full inline-block ${overduePct > 50 ? "bg-rose-500" : "bg-amber-400"}`} />
                        {fmt.money(overdue, ccy)} overdue
                      </span>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Multi-currency warning ───────────────────────────────────── */}
      {hasMixedCurrencies && (
        <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
          <span className="text-amber-500 mt-0.5 shrink-0">⚠</span>
          <p className="text-[12px] text-amber-800 leading-relaxed">
            <span className="font-semibold">Multi-currency data detected.</span>
            {" "}All totals shown use the org&apos;s home currency ({ccy}) symbol but are the arithmetic sum of mixed currencies without FX conversion.
            {" "}For precise home-currency values use the <a href="/reports" className="underline font-medium">AR Reports page</a> with a single-currency filter, or QBO&apos;s native Aged Receivables report.
          </p>
        </div>
      )}

      {/* ── AR Health ─────────────────────────────────────────────────── */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">AR Health</h2>
            <p className="text-[11px] text-stone-500 mt-0.5">5-dimension quality score — reconciled with AR Reports</p>
          </div>
          {snapshotLoading && (
            <div className="flex items-center gap-1.5 text-[11px] text-stone-400">
              <span className="w-2 h-2 rounded-full bg-stone-300 animate-pulse" />
              Syncing with QBO…
            </div>
          )}
        </div>
        <ArHealthWidget
          invoices={effectiveInvoices}
          customers={customers}
          projects={projects}
          reps={reps ?? []}
          communications={communications}
          ccy={ccy}
        />
      </div>
    </div>
  );
}
