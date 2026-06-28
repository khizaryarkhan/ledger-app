"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import {
  CreditCard, Loader, ExternalLink, RefreshCw, CheckCircle2, AlertTriangle,
  Plus, Pencil, Clock, Zap, Hand, ChevronDown, X, FileText, Ban, Trash2,
} from "lucide-react";
import { Card, Badge, Button, Modal, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";
import { COUNTRIES } from "@/lib/countries";

// ─── helpers ────────────────────────────────────────────────────────────────

function fmtPlan(amount: number | null, currency: string | null, interval: string | null) {
  if (!amount || !currency) return null;
  const money = fmt.money(amount / 100, currency.toUpperCase());
  return interval ? `${money}/${interval}` : money;
}

function daysUntil(date: string | Date | null): number | null {
  if (!date) return null;
  const ms = new Date(date).getTime() - Date.now();
  return Math.ceil(ms / 86_400_000);
}

function ExpiryCell({ sub }: { sub: any }) {
  if (sub.source === "manual") {
    if (!sub.manualExpiresAt) {
      return <span className="text-stone-500 text-xs">No expiry</span>;
    }
    const days = daysUntil(sub.manualExpiresAt);
    const label = new Date(sub.manualExpiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    if (days === null || days < 0) {
      return <span className="text-rose-400 text-xs font-medium">{label} (expired)</span>;
    }
    if (days <= 7) {
      return <span className="text-amber-400 text-xs font-medium">{label} ({days}d left)</span>;
    }
    return <span className="text-stone-300 text-xs">{label}</span>;
  }
  if (!sub.currentPeriodEnd) return <span className="text-stone-600 text-xs">—</span>;
  return (
    <span className="text-stone-400 text-xs">
      {new Date(sub.currentPeriodEnd).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
    </span>
  );
}

const STRIPE_STATUS_BADGE: Record<string, string> = {
  active:              "green",
  trialing:            "blue",
  past_due:            "red",
  canceled:            "neutral",
  cancelled:           "neutral",
  incomplete:          "yellow",
  incomplete_expired:  "neutral",
  unpaid:              "red",
  paused:              "neutral",
};

const PAYMENT_BADGE: Record<string, string> = {
  paid:    "green",
  pending: "yellow",
  overdue: "red",
  waived:  "neutral",
};

// ─── Create Stripe Invoice / Subscription Modal ──────────────────────────────
// Creates a Stripe-hosted invoice (no card data touched). "Subscription" bills a
// custom recurring price (the sales-led primary path); "One-off" sends a single
// invoice. Stripe issues & emails the invoice; the webhook syncs status → access.

function StripeInvoiceModal({ open, onClose, onDone, onToast }: {
  open: boolean; onClose: () => void; onDone: () => void; onToast: (t: any) => void;
}) {
  const [orgs, setOrgs]         = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId]       = useState("");
  const [mode, setMode]         = useState<"subscription" | "oneoff">("subscription");
  const [billingEmail, setBillingEmail] = useState("");
  const [country, setCountry]   = useState("IE");
  const [stateRegion, setStateRegion] = useState("");
  const [postalCode, setPostalCode] = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [daysUntilDue, setDaysUntilDue] = useState("14");
  // subscription
  const [planName, setPlanName] = useState("");
  const [amount, setAmount]     = useState("");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [coupons, setCoupons]   = useState<{ id: string; name: string }[]>([]);
  const [couponId, setCouponId] = useState("");
  // one-off
  const [items, setItems]       = useState<{ description: string; amount: string }[]>([{ description: "", amount: "" }]);
  const [memo, setMemo]         = useState("");
  const [saving, setSaving]     = useState(false);
  const [err, setErr]           = useState("");
  const [result, setResult]     = useState<any>(null);

  useEffect(() => {
    if (!open) return;
    setErr(""); setResult(null);
    fetch("/api/admin/organisations")
      .then(r => r.ok ? r.json() : [])
      .then(d => setOrgs((Array.isArray(d) ? d : (d?.organisations ?? [])).map((o: any) => ({ id: o.id, name: o.name }))));
    fetch("/api/admin/billing/coupons")
      .then(r => r.ok ? r.json() : { coupons: [] })
      .then(d => setCoupons((d.coupons ?? []).filter((c: any) => c.valid).map((c: any) => ({ id: c.id, name: `${c.name} (${c.percentOff != null ? c.percentOff + "%" : (c.amountOff != null ? (c.amountOff / 100).toFixed(2) + " " + (c.currency ?? "") : "")})` }))))
      .catch(() => {});
  }, [open]);

  const setItem = (i: number, k: "description" | "amount", v: string) =>
    setItems(prev => prev.map((it, idx) => idx === i ? { ...it, [k]: v } : it));

  const submit = async () => {
    setErr("");
    if (!orgId) return setErr("Select an organisation");
    if (!billingEmail.trim()) return setErr("Billing email is required");
    if (!country) return setErr("Select the customer's country");
    const payload: any = {
      orgId, mode, billingEmail: billingEmail.trim(),
      currency: currency.toLowerCase(),
      daysUntilDue: parseInt(daysUntilDue) || 14,
      country,
      state: stateRegion.trim() || undefined,
      postalCode: postalCode.trim() || undefined,
    };
    if (mode === "subscription") {
      const cents = Math.round(parseFloat(amount) * 100);
      if (!cents || cents <= 0) return setErr("Enter a valid amount");
      payload.amount = cents;
      payload.interval = interval;
      payload.planName = planName.trim() || "Custom plan";
      if (couponId) payload.couponId = couponId;
    } else {
      const li = items
        .filter(it => it.description.trim() && parseFloat(it.amount) > 0)
        .map(it => ({ description: it.description.trim(), amount: Math.round(parseFloat(it.amount) * 100) }));
      if (li.length === 0) return setErr("Add at least one line item with a description and amount");
      payload.lineItems = li;
      payload.memo = memo.trim() || undefined;
    }
    setSaving(true);
    try {
      const r = await fetch("/api/admin/billing/create-invoice", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || `Failed (${r.status})`); return; }
      setResult(d);
      onToast({ type: "success", message: mode === "subscription" ? "First invoice created" : "Invoice created & sent" });
      onDone();
    } catch (e: any) {
      setErr(e?.message || "Network error");
    } finally {
      setSaving(false);
    }
  };

  const CURRENCIES = ["GBP", "EUR", "USD", "AUD", "CAD", "NZD", "CHF", "AED", "INR", "SGD", "ZAR"];
  const inp = "px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500";
  const label = "text-xs text-stone-400 block mb-1.5";

  const oneOffTotal = items.reduce((s, it) => s + (parseFloat(it.amount) || 0), 0);
  const symbol = ({ GBP: "£", EUR: "€", USD: "$", AUD: "$", CAD: "$", NZD: "$", INR: "₹" } as Record<string, string>)[currency] ?? "";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Create Stripe invoice"
      footer={result ? (
        <Button variant="primary" onClick={() => { setResult(null); onClose(); }}>Done</Button>
      ) : (
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={saving}>
            {saving && <Loader size={13} className="animate-spin mr-1" />}
            {saving ? "Creating…" : "Create & send invoice"}
          </Button>
        </>
      )}
    >
      {result ? (
        <div className="px-5 py-6 space-y-4">
          <div className="flex items-center gap-2.5 text-emerald-300">
            <div className="w-9 h-9 rounded-full bg-emerald-500/15 flex items-center justify-center"><CheckCircle2 size={18} /></div>
            <div>
              <p className="text-sm font-medium text-white">{result.recurring ? "First invoice ready to share" : "Invoice created & emailed"}</p>
              <p className="text-xs text-stone-400">
                {result.recurring
                  ? "Share the link below. When the customer pays this first invoice, their card is saved and every period after is charged automatically."
                  : <>Status: <span className="text-stone-200 capitalize">{result.status}</span></>}
              </p>
            </div>
          </div>
          {result.hostedInvoiceUrl && (
            <a href={result.hostedInvoiceUrl} target="_blank" rel="noreferrer"
               className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-sky-500/30 bg-sky-500/10 text-sm text-sky-300 hover:bg-sky-500/15 transition-colors">
              <span className="flex items-center gap-2"><ExternalLink size={14} /> Open / copy invoice link</span>
              <span className="text-[11px] text-sky-400/70">opens Stripe</span>
            </a>
          )}
        </div>
      ) : (
        <div className="px-5 py-5 space-y-4">
          {/* Organisation */}
          <div>
            <label className={label}>Organisation <span className="text-rose-400">*</span></label>
            <select value={orgId} onChange={e => setOrgId(e.target.value)} className={inp + " w-full"}>
              <option value="">Select an organisation…</option>
              {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>

          {/* Billing email */}
          <div>
            <label className={label}>Billing email <span className="text-rose-400">*</span></label>
            <input type="email" value={billingEmail} onChange={e => setBillingEmail(e.target.value)}
              placeholder="finance@client.com" className={inp + " w-full"} />
            <p className="text-[11px] text-stone-600 mt-1">Stripe sends the hosted invoice here.</p>
          </div>

          {/* Customer location (for tax & records) */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-1">
              <label className={label}>Country <span className="text-rose-400">*</span></label>
              <select value={country} onChange={e => setCountry(e.target.value)} className={inp + " w-full"}>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
              </select>
            </div>
            <div className="col-span-1">
              <label className={label}>State / region</label>
              <input value={stateRegion} onChange={e => setStateRegion(e.target.value)} placeholder={country === "US" ? "CA" : "optional"} className={inp + " w-full"} />
            </div>
            <div className="col-span-1">
              <label className={label}>Postal code</label>
              <input value={postalCode} onChange={e => setPostalCode(e.target.value)} placeholder="optional" className={inp + " w-full"} />
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-stone-600">Used for tax calculation and the customer's billing record.</p>

          {/* Mode segmented control */}
          <div className="grid grid-cols-2 gap-1.5 p-1 bg-stone-800/60 rounded-lg">
            {([["subscription", "Recurring"], ["oneoff", "One-off invoice"]] as const).map(([m, lbl]) => (
              <button key={m} onClick={() => setMode(m)}
                className={`h-8 text-xs font-medium rounded-md transition-all ${
                  mode === m ? "bg-sky-500/15 text-sky-300 ring-1 ring-sky-500/40" : "text-stone-400 hover:text-stone-200"
                }`}>
                {lbl}
              </button>
            ))}
          </div>

          {mode === "subscription" ? (
            <>
              <div>
                <label className={label}>Plan name</label>
                <input value={planName} onChange={e => setPlanName(e.target.value)}
                  placeholder="e.g. AR Automation — Pro" className={inp + " w-full"} />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className={label}>Amount</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">{symbol}</span>
                    <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="499.00" inputMode="decimal"
                      className={inp + ` w-full ${symbol ? "pl-7" : ""}`} />
                  </div>
                </div>
                <div>
                  <label className={label}>Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className={inp + " w-full"}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className={label}>Billing cycle</label>
                  <select value={interval} onChange={e => setInterval(e.target.value as any)} className={inp + " w-full"}>
                    <option value="month">Monthly</option>
                    <option value="year">Yearly</option>
                  </select>
                </div>
              </div>
              {coupons.length > 0 && (
                <div>
                  <label className={label}>Discount <span className="text-stone-600">(optional)</span></label>
                  <select value={couponId} onChange={e => setCouponId(e.target.value)} className={inp + " w-full"}>
                    <option value="">No discount</option>
                    {coupons.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              )}
            </>
          ) : (
            <>
              <div>
                <label className={label}>Line items</label>
                <div className="space-y-2">
                  {items.map((it, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <input value={it.description} onChange={e => setItem(i, "description", e.target.value)}
                        placeholder="Description — e.g. Setup fee" className={inp + " flex-1 min-w-0"} />
                      <div className="relative w-32 shrink-0">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-stone-500">{symbol}</span>
                        <input value={it.amount} onChange={e => setItem(i, "amount", e.target.value)}
                          placeholder="0.00" inputMode="decimal" className={inp + ` w-full text-right ${symbol ? "pl-7" : ""}`} />
                      </div>
                      <button onClick={() => setItems(items.length > 1 ? items.filter((_, idx) => idx !== i) : items)}
                        disabled={items.length === 1}
                        className="text-stone-600 hover:text-rose-400 p-1.5 shrink-0 disabled:opacity-30 disabled:hover:text-stone-600">
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between mt-2">
                  <button onClick={() => setItems([...items, { description: "", amount: "" }])}
                    className="text-xs text-sky-400 hover:text-sky-300 flex items-center gap-1"><Plus size={12} /> Add line</button>
                  <span className="text-xs text-stone-400">Total <span className="text-white font-medium tabular-nums">{symbol}{oneOffTotal.toFixed(2)}</span></span>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={label}>Currency</label>
                  <select value={currency} onChange={e => setCurrency(e.target.value)} className={inp + " w-full"}>
                    {CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className={label}>Memo <span className="text-stone-600">(optional)</span></label>
                <input value={memo} onChange={e => setMemo(e.target.value)}
                  placeholder="Shown on the invoice" className={inp + " w-full"} />
              </div>
            </>
          )}

          <div>
            <label className={label}>Payment terms</label>
            <div className="flex items-center gap-2">
              <input value={daysUntilDue} onChange={e => setDaysUntilDue(e.target.value)} inputMode="numeric"
                className={inp + " w-20 text-center"} />
              <span className="text-xs text-stone-500">days until due</span>
            </div>
          </div>

          {err && <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">{err}</div>}
        </div>
      )}
    </Modal>
  );
}

// ─── Manual Subscription Modal ───────────────────────────────────────────────

type ManualModalProps = {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  existing?: any;
};

function ManualModal({ open, onClose, onSaved, existing }: ManualModalProps) {
  const [orgs, setOrgs]               = useState<{ id: string; name: string }[]>([]);
  const [orgId, setOrgId]             = useState(existing?.orgId ?? "");
  const [planName, setPlanName]       = useState(existing?.planName ?? "");
  const [amount, setAmount]           = useState(existing?.planAmount != null ? String(existing.planAmount / 100) : "");
  const [currency, setCurrency]       = useState(existing?.planCurrency?.toUpperCase() ?? "GBP");
  const [interval, setInterval]       = useState(existing?.planInterval ?? "month");
  const [noExpiry, setNoExpiry]       = useState(!existing?.manualExpiresAt);
  const [expiresAt, setExpiresAt]     = useState(
    existing?.manualExpiresAt
      ? new Date(existing.manualExpiresAt).toISOString().slice(0, 10)
      : ""
  );
  const [payStatus, setPayStatus]     = useState<string>(existing?.manualPaymentStatus ?? "paid");
  const [invoiceRef, setInvoiceRef]   = useState(existing?.manualInvoiceRef ?? "");
  const [notes, setNotes]             = useState(existing?.manualNotes ?? "");
  const [billingEmail, setBillingEmail] = useState(existing?.billingEmail ?? "");
  const [saving, setSaving]           = useState(false);
  const [err, setErr]                 = useState("");

  useEffect(() => {
    if (!open || existing) return;
    fetch("/api/admin/organisations")
      .then(r => r.ok ? r.json() : [])
      .then(d => setOrgs(
        (Array.isArray(d) ? d : (d?.organisations ?? []))
          .filter((o: any) => !o.subId)   // only orgs without an existing subscription
          .map((o: any) => ({ id: o.id, name: o.name }))
      ));
  }, [open, existing]);

  const handleSubmit = async () => {
    setErr("");
    if (!existing && !orgId) { setErr("Select an organisation"); return; }
    if (!planName.trim()) { setErr("Plan name is required"); return; }

    setSaving(true);
    try {
      const payload: any = {
        planName,
        amount:        amount ? Math.round(parseFloat(amount) * 100) : undefined,
        currency:      currency || undefined,
        interval:      interval || undefined,
        expiresAt:     noExpiry ? null : (expiresAt ? new Date(expiresAt).toISOString() : null),
        paymentStatus: payStatus,
        invoiceRef:    invoiceRef || undefined,
        notes:         notes || undefined,
        billingEmail:  billingEmail || undefined,
      };

      let url: string;
      let method: string;

      if (existing) {
        // Edit: PATCH the existing subscription
        url    = `/api/admin/subscriptions/${existing.id}`;
        method = "PATCH";
        payload.action = "update";
      } else {
        // Create
        url    = "/api/admin/subscriptions/manual";
        method = "POST";
        payload.orgId = orgId;
      }

      const r = await fetch(url, {
        method,
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (r.ok) {
        onSaved();
        onClose();
      } else {
        const d = await r.json().catch(() => ({}));
        setErr(d.error ?? "Failed to save");
      }
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={existing ? "Edit Manual Subscription" : "Add Manual Subscription"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSubmit} disabled={saving}>
            {saving && <Loader size={13} className="animate-spin mr-1" />}
            {existing ? "Save changes" : "Create subscription"}
          </Button>
        </>
      }
    >
      <div className="px-5 py-5 space-y-4">
        {err && (
          <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">{err}</div>
        )}

        {/* Org selector — only on create */}
        {!existing && (
          <div>
            <label className="text-xs text-stone-400 block mb-1.5">Organisation <span className="text-rose-400">*</span></label>
            {orgs.length === 0 ? (
              <div className="px-3 py-2.5 rounded-lg border border-stone-700 bg-stone-800/40 text-xs text-stone-400">
                All organisations already have a subscription. Edit an existing subscription instead.
              </div>
            ) : (
              <select
                value={orgId}
                onChange={e => setOrgId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">Select organisation…</option>
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            )}
          </div>
        )}

        {/* Plan name */}
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">Plan name <span className="text-rose-400">*</span></label>
          <input
            value={planName}
            onChange={e => setPlanName(e.target.value)}
            placeholder="e.g. Annual Pro, Monthly Standard"
            className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Amount + currency + interval */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-1">
            <label className="text-xs text-stone-400 block mb-1.5">Amount</label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          </div>
          <div className="col-span-1">
            <label className="text-xs text-stone-400 block mb-1.5">Currency</label>
            <select
              value={currency}
              onChange={e => setCurrency(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              {["GBP", "USD", "EUR", "AUD", "CAD"].map(c => <option key={c}>{c}</option>)}
            </select>
          </div>
          <div className="col-span-1">
            <label className="text-xs text-stone-400 block mb-1.5">Billing cycle</label>
            <select
              value={interval}
              onChange={e => setInterval(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            >
              <option value="month">Monthly</option>
              <option value="year">Annual</option>
              <option value="custom">Custom</option>
            </select>
          </div>
        </div>

        {/* Access expiry */}
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">Access until</label>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={noExpiry}
                onChange={e => setNoExpiry(e.target.checked)}
                className="accent-emerald-500"
              />
              <span className="text-xs text-stone-300">No expiry (unlimited)</span>
            </label>
          </div>
          {!noExpiry && (
            <input
              type="date"
              value={expiresAt}
              onChange={e => setExpiresAt(e.target.value)}
              className="mt-2 w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
            />
          )}
        </div>

        {/* Payment status */}
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">Payment status</label>
          <div className="flex gap-2 flex-wrap">
            {(["paid", "pending", "overdue", "waived"] as const).map(s => (
              <button
                key={s}
                onClick={() => setPayStatus(s)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium border capitalize transition-all ${
                  payStatus === s
                    ? s === "paid"   ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                    : s === "overdue" ? "bg-rose-500/15 border-rose-500/40 text-rose-300"
                    : s === "pending" ? "bg-amber-500/15 border-amber-500/40 text-amber-300"
                    : "bg-stone-700 border-stone-600 text-stone-300"
                    : "border-stone-700 text-stone-400 hover:border-stone-600"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Invoice ref */}
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">
            Invoice / PO reference <span className="text-stone-600">(optional)</span>
          </label>
          <input
            value={invoiceRef}
            onChange={e => setInvoiceRef(e.target.value)}
            placeholder="INV-2024-001"
            className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Billing email */}
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">
            Billing email <span className="text-stone-600">(optional)</span>
          </label>
          <input
            type="email"
            value={billingEmail}
            onChange={e => setBillingEmail(e.target.value)}
            placeholder="accounts@client.com"
            className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>

        {/* Notes */}
        <div>
          <label className="text-xs text-stone-400 block mb-1.5">
            Internal notes <span className="text-stone-600">(optional)</span>
          </label>
          <textarea
            value={notes}
            onChange={e => setNotes(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Context for this subscription — payment method, account manager, etc."
            className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 resize-none focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500"
          />
        </div>
      </div>
    </Modal>
  );
}

// ─── Extend dropdown ──────────────────────────────────────────────────────────

function ExtendDropdown({ subId, onDone }: { subId: string; onDone: () => void }) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState<number | null>(null);

  const extend = async (days: number) => {
    setLoading(days);
    setOpen(false);
    try {
      await fetch(`/api/admin/subscriptions/${subId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "extend", days }),
      });
      onDone();
    } finally { setLoading(null); }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={loading !== null}
        className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200 transition-colors disabled:opacity-40"
      >
        {loading !== null ? <Loader size={10} className="animate-spin" /> : <Clock size={10} />}
        Extend
        <ChevronDown size={10} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 bg-stone-900 border border-stone-700 rounded-lg shadow-xl overflow-hidden min-w-[90px]">
            {[30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => extend(d)}
                className="w-full text-left px-3 py-2 text-xs text-stone-300 hover:bg-stone-800 hover:text-white transition-colors"
              >
                +{d} days
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

type Tab = "all" | "stripe" | "manual" | "expiring" | "attention";

type SyncResult = { synced: number; skipped: number; errors: string[] } | null;

export default function SubscriptionsPage() {
  const [subs, setSubs]             = useState<any[]>([]);
  const [loading, setLoading]       = useState(true);
  const [syncing, setSyncing]       = useState(false);
  const [syncResult, setSyncResult] = useState<SyncResult>(null);
  const [tab, setTab]               = useState<Tab>("all");
  const [showAdd, setShowAdd]       = useState(false);
  const [showInvoice, setShowInvoice] = useState(false);
  const [editing, setEditing]       = useState<any>(null);
  const [toast, setToast]           = useState<any>(null);
  const [deleteTarget, setDeleteTarget] = useState<any>(null); // org to delete
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleting, setDeleting]     = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/subscriptions");
      const d = await r.json();
      if (r.ok) {
        setSubs(d.subscriptions ?? []);
      } else {
        setToast({ type: "error", message: d.error ?? `Failed to load (${r.status})` });
      }
    } catch (e: any) {
      setToast({ type: "error", message: e?.message ?? "Network error" });
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSyncAll = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const r = await fetch("/api/admin/subscriptions/sync", { method: "POST" });
      const d = await r.json();
      setSyncResult(d);
      if (r.ok) await load();
    } catch {
      setSyncResult({ synced: 0, skipped: 0, errors: ["Network error — sync failed"] });
    } finally { setSyncing(false); }
  };

  const cancelStripe = async (s: any) => {
    if (!confirm(`Cancel ${s.orgName ?? "this org"}'s Stripe subscription now and revoke access? This cannot be undone.`)) return;
    try {
      const r = await fetch(`/api/admin/subscriptions/${s.id}/cancel`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ atPeriodEnd: false }),
      });
      const d = await r.json();
      if (r.ok) { setToast({ type: "success", message: "Subscription cancelled — access revoked" }); load(); }
      else setToast({ type: "error", message: d.error ?? "Cancel failed" });
    } catch (e: any) {
      setToast({ type: "error", message: e?.message ?? "Network error" });
    }
  };

  const deleteOrg = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const r = await fetch(`/api/admin/organisations/${deleteTarget.orgId}`, { method: "DELETE" });
      const d = await r.json();
      if (r.ok) {
        setToast({ type: "success", message: `"${deleteTarget.orgName}" deleted — all data removed.` });
        setDeleteTarget(null);
        setDeleteConfirmName("");
        load();
      } else {
        setToast({ type: "error", message: d.error ?? "Delete failed" });
      }
    } catch (e: any) {
      setToast({ type: "error", message: e?.message ?? "Network error" });
    } finally { setDeleting(false); }
  };

  const handleQuickAction = async (subId: string, action: string) => {
    const r = await fetch(`/api/admin/subscriptions/${subId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    if (r.ok) {
      setToast({ type: "success", message: action === "mark_paid" ? "Marked as paid" : action === "suspend" ? "Suspended" : "Reactivated" });
      load();
    } else {
      setToast({ type: "error", message: "Action failed" });
    }
  };

  // ── derived stats ──
  const now = Date.now();
  const totalStripeActive  = subs.filter(s => s.source === "stripe" && (s.status === "active" || s.status === "trialing")).length;
  const totalManualActive  = subs.filter(s => s.source === "manual" && (!s.manualExpiresAt || new Date(s.manualExpiresAt).getTime() > now)).length;
  const expiringCount      = subs.filter(s => {
    if (s.source !== "manual" || !s.manualExpiresAt) return false;
    const d = daysUntil(s.manualExpiresAt);
    return d !== null && d >= 0 && d <= 7;
  }).length;
  const attentionCount     = subs.filter(s => {
    if (s.source === "stripe") return s.status === "past_due" || s.status === "unpaid";
    return s.manualPaymentStatus === "overdue";
  }).length;

  // ── filtered rows ──
  const filtered = subs.filter(s => {
    if (tab === "stripe")   return s.source === "stripe";
    if (tab === "manual")   return s.source === "manual";
    if (tab === "expiring") {
      if (s.source !== "manual" || !s.manualExpiresAt) return false;
      const d = daysUntil(s.manualExpiresAt);
      return d !== null && d >= 0 && d <= 7;
    }
    if (tab === "attention") {
      if (s.source === "stripe") return s.status === "past_due" || s.status === "unpaid";
      return s.manualPaymentStatus === "overdue";
    }
    return true;
  });

  const tabs: { key: Tab; label: string; count?: number; warn?: boolean }[] = [
    { key: "all",       label: "All",            count: subs.length },
    { key: "stripe",    label: "Stripe",         count: subs.filter(s => s.source === "stripe").length },
    { key: "manual",    label: "Manual",         count: subs.filter(s => s.source === "manual").length },
    { key: "expiring",  label: "Expiring soon",  count: expiringCount,  warn: expiringCount > 0 },
    { key: "attention", label: "Needs attention", count: attentionCount, warn: attentionCount > 0 },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Subscriptions</h1>
          <p className="text-xs text-stone-500 mt-0.5">Stripe-managed and manual subscriptions across all organisations</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading || syncing}
            className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 transition-colors disabled:opacity-40"
          >
            <Loader size={12} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
          <button
            onClick={handleSyncAll}
            disabled={syncing || loading}
            className="flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 bg-stone-800/50 text-stone-300 hover:bg-stone-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-all"
          >
            <RefreshCw size={12} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing…" : "Sync Stripe"}
          </button>
          <button
            onClick={() => setShowInvoice(true)}
            className="flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg bg-sky-600 hover:bg-sky-500 text-white transition-colors"
          >
            <FileText size={13} /> Create invoice
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-2 h-8 px-3 text-xs font-medium rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white transition-colors"
          >
            <Plus size={13} /> Add manual
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        {[
          { label: "Total", value: subs.length, icon: CreditCard, color: "stone" },
          { label: "Active (Stripe)", value: totalStripeActive, icon: Zap, color: "blue" },
          { label: "Active (Manual)", value: totalManualActive, icon: Hand, color: "emerald" },
          { label: "Expiring ≤7 days", value: expiringCount, icon: Clock, color: expiringCount > 0 ? "amber" : "stone" },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className={`p-3 rounded-xl border ${
            color === "amber" && value > 0
              ? "border-amber-500/30 bg-amber-500/5"
              : "border-stone-800 bg-stone-900/50"
          }`}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] text-stone-500">{label}</span>
              <Icon size={13} className={
                color === "blue"    ? "text-blue-400" :
                color === "emerald" ? "text-emerald-400" :
                color === "amber" && value > 0   ? "text-amber-400" :
                "text-stone-600"
              } />
            </div>
            <p className={`text-xl font-semibold ${
              color === "amber" && value > 0 ? "text-amber-300" : "text-white"
            }`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Sync result banner */}
      {syncResult && (
        <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border text-sm ${
          syncResult.errors.length
            ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
            : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
        }`}>
          {syncResult.errors.length
            ? <AlertTriangle size={15} className="text-amber-400 mt-0.5 shrink-0" />
            : <CheckCircle2 size={15} className="text-emerald-400 mt-0.5 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="font-medium">
              Sync complete — {syncResult.synced} updated, {syncResult.skipped} skipped
              {syncResult.errors.length > 0 && `, ${syncResult.errors.length} error${syncResult.errors.length !== 1 ? "s" : ""}`}
            </p>
            {syncResult.errors.length > 0 && (
              <ul className="mt-1 text-[11px] text-amber-400/80 space-y-0.5">
                {syncResult.errors.slice(0, 5).map((e, i) => <li key={i}>· {e}</li>)}
              </ul>
            )}
          </div>
          <button onClick={() => setSyncResult(null)} className="text-stone-500 hover:text-stone-300 ml-2 shrink-0">
            <X size={14} />
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-stone-800 pb-0">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? "border-emerald-500 text-white"
                : "border-transparent text-stone-500 hover:text-stone-300"
            }`}
          >
            {t.label}
            {t.count !== undefined && t.count > 0 && (
              <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                t.warn
                  ? "bg-amber-500/20 text-amber-300"
                  : "bg-stone-800 text-stone-400"
              }`}>{t.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <Card padding="none">
        {loading ? (
          <div className="p-5 space-y-3">
            {[1,2,3,4,5].map(i => <div key={i} className="h-12 bg-stone-800 rounded animate-pulse" />)}
          </div>
        ) : !filtered.length ? (
          <div className="py-16 text-center">
            <CreditCard size={28} className="text-stone-600 mx-auto mb-3" />
            <p className="text-sm text-stone-500">No subscriptions in this view</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[900px]">
              <thead>
                <tr className="border-b border-stone-800">
                  {["Organisation", "Source", "Plan", "Status", "Expiry / Period", "Payment", "Actions"].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-[11px] text-stone-500 font-medium whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((s: any) => {
                  const planStr = fmtPlan(s.planAmount, s.planCurrency, s.planInterval);
                  const isManual = s.source === "manual";
                  const isExpiringSoon = isManual && (() => { const d = daysUntil(s.manualExpiresAt); return d !== null && d >= 0 && d <= 7; })();
                  const isOverdue = isManual
                    ? s.manualPaymentStatus === "overdue"
                    : s.status === "past_due" || s.status === "unpaid";

                  return (
                    <tr
                      key={s.id}
                      className={`border-b border-stone-800/50 hover:bg-stone-800/25 transition-colors ${
                        isExpiringSoon ? "bg-amber-500/3" : isOverdue ? "bg-rose-500/3" : ""
                      }`}
                    >
                      {/* Organisation */}
                      <td className="px-4 py-3">
                        {s.orgId ? (
                          <Link href={`/admin/customers/${s.orgId}`} className="text-white text-xs font-medium hover:text-emerald-400 transition-colors">
                            {s.orgName ?? "—"}
                          </Link>
                        ) : (
                          <p className="text-white text-xs font-medium">{s.orgName ?? "—"}</p>
                        )}
                        {s.billingEmail && (
                          <p className="text-[11px] text-stone-500 truncate max-w-[150px]">{s.billingEmail}</p>
                        )}
                        {s.orgId && (
                          <p className="font-mono text-[10px] text-stone-600 select-all mt-0.5" title={s.orgId}>{s.orgId.slice(0, 8)}…</p>
                        )}
                      </td>

                      {/* Source */}
                      <td className="px-4 py-3">
                        {isManual ? (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-stone-600 bg-stone-800 text-stone-300 font-medium">
                            <Hand size={9} /> Manual
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 text-blue-300 font-medium">
                            <Zap size={9} /> Stripe
                          </span>
                        )}
                      </td>

                      {/* Plan */}
                      <td className="px-4 py-3">
                        {s.planName ? (
                          <>
                            <p className="text-stone-200 text-xs font-medium">{s.planName}</p>
                            {planStr && <p className="text-[11px] text-stone-500">{planStr}</p>}
                          </>
                        ) : (
                          <span className="text-stone-600 text-xs">—</span>
                        )}
                        {isManual && s.manualInvoiceRef && (
                          <p className="text-[11px] text-stone-600 font-mono">{s.manualInvoiceRef}</p>
                        )}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        {isManual ? (
                          (() => {
                            const d = daysUntil(s.manualExpiresAt);
                            if (!s.manualExpiresAt) return <Badge variant="green">Active</Badge>;
                            if (d !== null && d < 0) return <Badge variant="neutral">Expired</Badge>;
                            return <Badge variant="green">Active</Badge>;
                          })()
                        ) : (
                          <>
                            <Badge variant={(STRIPE_STATUS_BADGE[s.status] ?? "neutral") as any}>{s.status ?? "—"}</Badge>
                            {s.cancelAtPeriodEnd && (
                              <p className="text-[11px] text-amber-400 mt-0.5">Cancels at period end</p>
                            )}
                          </>
                        )}
                      </td>

                      {/* Expiry / Period */}
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        <ExpiryCell sub={s} />
                      </td>

                      {/* Payment */}
                      <td className="px-4 py-3">
                        {isManual ? (
                          s.manualPaymentStatus ? (
                            <Badge variant={(PAYMENT_BADGE[s.manualPaymentStatus] ?? "neutral") as any} size="sm">
                              {s.manualPaymentStatus}
                            </Badge>
                          ) : <span className="text-stone-600 text-xs">—</span>
                        ) : (
                          s.lastPaymentStatus ? (
                            <div>
                              <Badge variant={s.lastPaymentStatus === "paid" ? "green" : "red" as any} size="sm">
                                {s.lastPaymentStatus}
                              </Badge>
                              {s.lastPaymentAmount && s.planCurrency && (
                                <p className="text-[11px] text-stone-500 mt-0.5">
                                  {fmt.money(s.lastPaymentAmount / 100, s.planCurrency.toUpperCase())}
                                </p>
                              )}
                            </div>
                          ) : <span className="text-stone-600 text-xs">—</span>
                        )}
                      </td>

                      {/* Actions */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {s.orgId && (
                            <Link
                              href={`/admin/invoices?org=${s.orgId}`}
                              className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-stone-700 text-stone-400 hover:border-stone-500 hover:text-stone-200 transition-colors"
                              title="View this organisation's invoices"
                            >
                              <FileText size={11} /> Invoices
                            </Link>
                          )}
                          {isManual ? (
                            <>
                              <ExtendDropdown
                                subId={s.id}
                                onDone={() => { load(); setToast({ type: "success", message: "Access extended" }); }}
                              />
                              {s.manualPaymentStatus !== "paid" && (
                                <button
                                  onClick={() => handleQuickAction(s.id, "mark_paid")}
                                  className="text-[11px] px-2 py-1 rounded border border-emerald-700/50 text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                                >
                                  Mark paid
                                </button>
                              )}
                              <button
                                onClick={() => setEditing(s)}
                                className="text-stone-500 hover:text-stone-300 p-1 transition-colors"
                                title="Edit"
                              >
                                <Pencil size={12} />
                              </button>
                            </>
                          ) : (
                            <>
                              {s.stripeCustomerId && (
                                <a
                                  href={`https://dashboard.stripe.com/customers/${s.stripeCustomerId}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-stone-500 hover:text-emerald-400 transition-colors p-1"
                                  title="Open in Stripe"
                                >
                                  <ExternalLink size={13} />
                                </a>
                              )}
                              {(s.status === "active" || s.status === "trialing" || s.status === "past_due") && (
                                <button
                                  onClick={() => cancelStripe(s)}
                                  className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border border-rose-700/50 text-rose-400 hover:bg-rose-500/10 transition-colors"
                                  title="Cancel subscription & revoke access"
                                >
                                  <Ban size={11} /> Cancel
                                </button>
                              )}
                            </>
                          )}
                          {s.orgId && (
                            <button
                              onClick={() => { setDeleteTarget(s); setDeleteConfirmName(""); }}
                              className="text-stone-600 hover:text-rose-400 p-1 transition-colors"
                              title="Delete organisation and all its data"
                            >
                              <Trash2 size={12} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create Stripe Invoice Modal */}
      <StripeInvoiceModal
        open={showInvoice}
        onClose={() => setShowInvoice(false)}
        onDone={() => { load(); }}
        onToast={(t: any) => setToast(t)}
      />

      {/* Add Manual Modal */}
      <ManualModal
        open={showAdd}
        onClose={() => setShowAdd(false)}
        onSaved={() => { load(); setToast({ type: "success", message: "Manual subscription created" }); }}
      />

      {/* Edit Modal */}
      {editing && (
        <ManualModal
          open={!!editing}
          onClose={() => setEditing(null)}
          onSaved={() => { load(); setToast({ type: "success", message: "Subscription updated" }); }}
          existing={editing}
        />
      )}

      {/* Delete Organisation Modal */}
      {deleteTarget && (
        <Modal
          open={!!deleteTarget}
          onClose={() => { setDeleteTarget(null); setDeleteConfirmName(""); }}
          title="Delete organisation"
          footer={
            <>
              <Button variant="secondary" onClick={() => { setDeleteTarget(null); setDeleteConfirmName(""); }}>Cancel</Button>
              <button
                onClick={deleteOrg}
                disabled={deleting || deleteConfirmName !== deleteTarget.orgName}
                className="flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg bg-rose-600 hover:bg-rose-500 text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {deleting && <Loader size={12} className="animate-spin" />}
                {deleting ? "Deleting…" : "Delete permanently"}
              </button>
            </>
          }
        >
          <div className="px-5 py-5 space-y-4">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-rose-500/10 border border-rose-500/20">
              <AlertTriangle size={16} className="text-rose-400 mt-0.5 shrink-0" />
              <div className="text-xs text-rose-300 space-y-1">
                <p className="font-semibold">This cannot be undone.</p>
                <p>Deleting <span className="text-white font-medium">"{deleteTarget.orgName}"</span> will permanently remove:</p>
                <ul className="list-disc list-inside text-rose-300/80 space-y-0.5 mt-1">
                  <li>All users and login access</li>
                  <li>All invoices, communications, and tasks</li>
                  <li>All sync data (QBO, Xero, Sage)</li>
                  <li>The subscription record</li>
                  {deleteTarget.source === "stripe" && <li className="text-rose-200 font-medium">Stripe subscription will be cancelled immediately</li>}
                </ul>
              </div>
            </div>
            <div>
              <label className="text-xs text-stone-400 block mb-2">
                Type <span className="text-white font-mono font-semibold">{deleteTarget.orgName}</span> to confirm
              </label>
              <input
                value={deleteConfirmName}
                onChange={e => setDeleteConfirmName(e.target.value)}
                placeholder={deleteTarget.orgName}
                className="w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-600 focus:border-rose-500 focus:outline-none focus:ring-1 focus:ring-rose-500"
                autoFocus
              />
              {deleteConfirmName && deleteConfirmName !== deleteTarget.orgName && (
                <p className="text-[11px] text-rose-400 mt-1">Name doesn't match exactly</p>
              )}
            </div>
          </div>
        </Modal>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
