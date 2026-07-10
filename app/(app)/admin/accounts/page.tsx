"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Loader, X, FileText, CreditCard, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { fmt } from "@/lib/format";

type WonRow = { accountId: string; ref: string; name: string; email: string | null; organisationId: string | null; owner: string | null; leadId: string | null; value: number | null; currency: string };
type FailRow = { accountId: string; ref: string; name: string; organisationId: string | null; owner: string | null; planName: string | null; subStatus: string | null; lastPaymentStatus: string | null };
type AccountsQueueResponse = {
  wonUnbilled?: WonRow[];
  paymentFailed?: FailRow[];
  needsSetup?: boolean;
};

const money = (v: number, c?: string) => fmt.money(v ?? 0, (c || "USD").toUpperCase());

export default function AccountsActionQueue() {
  const router = useRouter();
  const [won, setWon] = useState<WonRow[]>([]);
  const [failed, setFailed] = useState<FailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [invoiceFor, setInvoiceFor] = useState<WonRow | null>(null);
  const [toast, setToast] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/accounts").then(async (r): Promise<AccountsQueueResponse> => r.ok ? r.json() : {}).then(d => {
      setWon(d.wonUnbilled ?? []); setFailed(d.paymentFailed ?? []); setNeedsSetup(!!d.needsSetup);
    }).finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const total = won.length + failed.length;

  return (
    <div className="max-w-[1000px] mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-white">Billing actions</h1>
        <p className="text-xs text-stone-500 mt-0.5">Companies needing a billing action — won deals to invoice, and payment problems to fix. Browse all companies in <button onClick={() => router.push("/admin/leads")} className="text-sky-400 hover:text-sky-300">Pipeline</button> or <button onClick={() => router.push("/admin/customers")} className="text-sky-400 hover:text-sky-300">Customers</button>.</p>
      </div>

      {toast && <div className="mb-4 text-[12px] text-emerald-400">{toast}</div>}
      {needsSetup && (
        <div className="mb-4 rounded-lg ring-1 ring-amber-500/30 bg-amber-500/5 px-4 py-3 text-[13px] text-amber-300">The <span className="font-mono">crm_accounts</span> table isn't set up yet — run the backfill once it is.</div>
      )}

      {loading ? (
        <div className="h-48 rounded-xl bg-stone-900/50 border border-stone-800 animate-pulse" />
      ) : total === 0 ? (
        <div className="py-20 text-center border border-stone-800 rounded-xl">
          <CheckCircle2 size={26} className="text-emerald-500/70 mx-auto mb-3" />
          <p className="text-sm text-stone-400">Nothing needs action — every won deal is billed and all payments are current.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Won — needs billing */}
          <section className="rounded-xl border border-stone-800 overflow-hidden">
            <div className="flex items-center gap-2 px-4 py-2.5 bg-stone-900/40 border-b border-stone-800">
              <FileText size={14} className="text-amber-400" />
              <span className="text-[11px] uppercase tracking-wider text-stone-400 font-semibold">Won — needs invoice / subscription</span>
              <span className="text-[11px] text-stone-600">{won.length}</span>
            </div>
            {won.length === 0 ? <p className="text-xs text-stone-600 px-4 py-5">No won deals waiting to be billed.</p> : (
              <div className="divide-y divide-stone-800/50">
                {won.map(r => (
                  <div key={r.accountId} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-800/20">
                    <div className="w-7 h-7 rounded-lg bg-stone-800 flex items-center justify-center text-[10px] text-stone-300 shrink-0">{(r.name || "?").slice(0, 2).toUpperCase()}</div>
                    <button onClick={() => router.push(`/admin/accounts/${r.accountId}`)} className="min-w-0 flex-1 text-left">
                      <div className="flex items-center gap-2"><span className="text-sm text-stone-100 font-medium truncate">{r.name}</span><span className="font-mono text-[11px] text-stone-600">{r.ref}</span></div>
                      <div className="text-[11px] text-stone-500 truncate">{r.email || "—"}{r.owner ? ` · ${r.owner}` : ""}</div>
                    </button>
                    {r.value ? <span className="text-xs text-stone-300 tabular-nums shrink-0">{money(r.value, r.currency)}</span> : null}
                    <button onClick={() => setInvoiceFor(r)}
                      className="flex items-center gap-1.5 h-8 px-3 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white shrink-0">
                      <FileText size={13} /> Create invoice
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Payment failed */}
          {failed.length > 0 && (
            <section className="rounded-xl border border-rose-500/25 overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 bg-rose-500/5 border-b border-rose-500/20">
                <AlertTriangle size={14} className="text-rose-400" />
                <span className="text-[11px] uppercase tracking-wider text-rose-300 font-semibold">Payment failed — needs attention</span>
                <span className="text-[11px] text-stone-600">{failed.length}</span>
              </div>
              <div className="divide-y divide-stone-800/50">
                {failed.map(r => (
                  <div key={r.accountId} className="flex items-center gap-3 px-4 py-3 hover:bg-stone-800/20">
                    <div className="w-7 h-7 rounded-lg bg-stone-800 flex items-center justify-center text-[10px] text-stone-300 shrink-0">{(r.name || "?").slice(0, 2).toUpperCase()}</div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2"><span className="text-sm text-stone-100 font-medium truncate">{r.name}</span><span className="font-mono text-[11px] text-stone-600">{r.ref}</span></div>
                      <div className="text-[11px] text-rose-400/80 truncate">{r.planName ? `${r.planName} · ` : ""}{r.lastPaymentStatus === "failed" ? "last payment failed" : r.subStatus}</div>
                    </div>
                    {r.organisationId && (
                      <button onClick={() => router.push(`/admin/customers/${r.organisationId}`)}
                        className="flex items-center gap-1.5 h-8 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 shrink-0">
                        <CreditCard size={13} /> Fix payment <ArrowRight size={12} />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}

      {invoiceFor && (
        <CreateInvoice row={invoiceFor} onClose={() => setInvoiceFor(null)}
          onDone={(msg) => { setInvoiceFor(null); setToast(msg); load(); setTimeout(() => setToast(""), 4000); }} />
      )}
    </div>
  );
}

// Inline invoice/subscription creation for a Won account (ensure-org → create-invoice).
function CreateInvoice({ row, onClose, onDone }: { row: WonRow; onClose: () => void; onDone: (msg: string) => void }) {
  const [mode, setMode] = useState<"subscription" | "oneoff">("subscription");
  const [email, setEmail] = useState(row.email ?? "");
  const [adminEmail, setAdminEmail] = useState(row.email ?? "");
  const [adminName, setAdminName] = useState("");
  const [currency, setCurrency] = useState(row.currency || "USD");
  const [amount, setAmount] = useState(row.value ? String(row.value) : "");
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [planName, setPlanName] = useState("Subscription");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  // Post-create result panel: the hosted link + email status must be visible
  // and copyable — never assume the email arrived.
  const [result, setResult] = useState<{ hostedInvoiceUrl: string | null; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async () => {
    setErr(""); setSaving(true);
    try {
      // ensure-org also provisions the pending admin user — on payment this is
      // who receives the set-password invite. Without it the customer pays for
      // an account nobody can log into.
      const og = await fetch(`/api/admin/accounts/${row.accountId}/ensure-org`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adminEmail: adminEmail.trim() || email.trim(), adminName: adminName.trim() || row.name }),
      }).then(r => r.json());
      if (!og?.orgId) { setErr("Could not set up the customer org"); setSaving(false); return; }
      if (!og.userCount) { setErr("The customer org has no user — enter the customer admin's email so they can receive login credentials on payment."); setSaving(false); return; }
      const body: any = { orgId: og.orgId, mode, billingEmail: email.trim(), currency: currency.toLowerCase(), daysUntilDue: 14 };
      if (mode === "subscription") {
        const amt = Math.round((parseFloat(amount) || 0) * 100);
        if (amt <= 0) { setErr("Enter a recurring amount"); setSaving(false); return; }
        body.amount = amt; body.interval = interval; body.planName = planName || "Subscription";
      } else {
        const amt = Math.round((parseFloat(amount) || 0) * 100);
        if (amt <= 0) { setErr("Enter an amount"); setSaving(false); return; }
        body.lineItems = [{ description: desc.trim() || "Services", amount: amt }];
      }
      const r = await fetch("/api/admin/billing/create-invoice", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Failed to create invoice"); setSaving(false); return; }
      setSaving(false);
      setResult({ hostedInvoiceUrl: d.hostedInvoiceUrl ?? null, emailSent: !!d.emailSent });
    } catch { setErr("Failed to create invoice"); setSaving(false); }
  };

  const inp = "w-full px-3 py-2 text-sm rounded-lg bg-stone-800 border border-stone-700 text-stone-200 focus:outline-none focus:border-emerald-500";
  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-stone-900 rounded-xl w-full max-w-md ring-1 ring-stone-800">
        <div className="px-5 py-4 border-b border-stone-800 flex items-center justify-between">
          <div><h2 className="font-semibold text-white">Bill {row.name}</h2><p className="text-[11px] text-stone-500 mt-0.5">Creating this moves them to Customers.</p></div>
          <button onClick={onClose} className="p-1 hover:bg-stone-800 rounded text-stone-400 hover:text-white"><X size={16} /></button>
        </div>
        {result ? (
          <div className="p-5 space-y-3">
            <div className={`text-sm px-3 py-2 rounded ring-1 ${result.emailSent ? "text-emerald-400 bg-emerald-500/10 ring-emerald-500/30" : "text-amber-400 bg-amber-500/10 ring-amber-500/30"}`}>
              {result.emailSent
                ? `Invoice created and emailed to ${email.trim()}.`
                : "Invoice created, but the email FAILED to send — share the payment link with the customer manually."}
            </div>
            {result.hostedInvoiceUrl && (
              <div className="flex items-center gap-2">
                <input readOnly value={result.hostedInvoiceUrl} className={`${inp} text-[11px] font-mono`} onFocus={e => e.target.select()} />
                <button
                  onClick={() => { navigator.clipboard.writeText(result.hostedInvoiceUrl!); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                  className="h-9 px-3 text-xs font-medium rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800 shrink-0">
                  {copied ? "Copied ✓" : "Copy link"}
                </button>
              </div>
            )}
            <p className="text-[11px] text-stone-500">On payment, {adminEmail.trim() || email.trim()} automatically receives a set-password email and the account activates.</p>
            <div className="flex justify-end">
              <button onClick={() => onDone(`Invoice created for ${row.name} — moved to Customers.`)}
                className="h-9 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white">Done</button>
            </div>
          </div>
        ) : (
        <div className="p-5 space-y-3">
          {err && <div className="text-sm text-rose-400 bg-rose-500/10 px-3 py-2 rounded ring-1 ring-rose-500/30">{err}</div>}
          <div className="flex gap-1 p-1 rounded-lg bg-stone-800 w-fit">
            {(["subscription", "oneoff"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)} className={`px-3 h-7 text-xs font-medium rounded-md ${mode === m ? "bg-stone-600 text-white" : "text-stone-400"}`}>{m === "subscription" ? "Recurring" : "One-off"}</button>
            ))}
          </div>
          <div><label className="text-xs text-stone-400 block mb-1.5">Billing email</label><input className={inp} value={email} onChange={e => setEmail(e.target.value)} placeholder="billing@company.com" /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="text-xs text-stone-400 block mb-1.5">Customer admin name</label><input className={inp} value={adminName} onChange={e => setAdminName(e.target.value)} placeholder="Who gets the login" /></div>
            <div><label className="text-xs text-stone-400 block mb-1.5">Customer admin email</label><input className={inp} value={adminEmail} onChange={e => setAdminEmail(e.target.value)} placeholder="defaults to billing email" /></div>
          </div>
          <p className="text-[11px] text-stone-600 -mt-1">This person receives the set-password invite automatically when the invoice is paid.</p>
          {mode === "subscription" ? (
            <>
              <div><label className="text-xs text-stone-400 block mb-1.5">Plan name</label><input className={inp} value={planName} onChange={e => setPlanName(e.target.value)} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1"><label className="text-xs text-stone-400 block mb-1.5">Amount</label><input className={inp} value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="99" /></div>
                <div><label className="text-xs text-stone-400 block mb-1.5">Per</label><select className={inp} value={interval} onChange={e => setInterval(e.target.value as any)}><option value="month">month</option><option value="year">year</option></select></div>
                <div><label className="text-xs text-stone-400 block mb-1.5">Currency</label><select className={inp} value={currency} onChange={e => setCurrency(e.target.value)}>{["USD", "EUR", "GBP"].map(c => <option key={c}>{c}</option>)}</select></div>
              </div>
            </>
          ) : (
            <>
              <div><label className="text-xs text-stone-400 block mb-1.5">Description</label><input className={inp} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Setup fee / services" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-xs text-stone-400 block mb-1.5">Amount</label><input className={inp} value={amount} onChange={e => setAmount(e.target.value)} inputMode="decimal" placeholder="500" /></div>
                <div><label className="text-xs text-stone-400 block mb-1.5">Currency</label><select className={inp} value={currency} onChange={e => setCurrency(e.target.value)}>{["USD", "EUR", "GBP"].map(c => <option key={c}>{c}</option>)}</select></div>
              </div>
            </>
          )}
        </div>
        )}
        {!result && (
        <div className="px-5 py-3 border-t border-stone-800 flex justify-end gap-2">
          <button onClick={onClose} className="h-9 px-4 text-sm rounded-lg border border-stone-700 text-stone-300 hover:bg-stone-800">Cancel</button>
          <button onClick={submit} disabled={saving} className="h-9 px-4 text-sm font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white disabled:opacity-60 flex items-center gap-1.5">{saving ? <Loader size={14} className="animate-spin" /> : <FileText size={14} />} Create & send</button>
        </div>
        )}
      </div>
    </div>
  );
}
