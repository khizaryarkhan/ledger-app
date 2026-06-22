"use client";

import { useState, useEffect, useCallback } from "react";
import { Percent, Loader, RefreshCw, Plus, Trash2, Tag, Power } from "lucide-react";
import { Card, Badge, Button, Modal, Toast } from "@/components/ui";
import { fmt } from "@/lib/format";

type Promo = { id: string; code: string; active: boolean; timesRedeemed: number; maxRedemptions: number | null };
type Coupon = {
  id: string; name: string; percentOff: number | null; amountOff: number | null; currency: string | null;
  duration: string; durationInMonths: number | null; timesRedeemed: number; maxRedemptions: number | null;
  valid: boolean; created: number | null; promotionCodes: Promo[];
};

function discountLabel(c: Coupon) {
  const amt = c.percentOff != null ? `${c.percentOff}% off` : c.amountOff != null ? `${fmt.money(c.amountOff / 100, c.currency ?? "GBP")} off` : "—";
  const dur = c.duration === "once" ? "once" : c.duration === "forever" ? "forever" : `${c.durationInMonths ?? "?"} months`;
  return `${amt} · ${dur}`;
}

function CreateModal({ open, onClose, onDone, onToast }: { open: boolean; onClose: () => void; onDone: () => void; onToast: (t: any) => void }) {
  const [name, setName]       = useState("");
  const [type, setType]       = useState<"percent" | "amount">("percent");
  const [value, setValue]     = useState("");
  const [currency, setCurrency] = useState("GBP");
  const [duration, setDuration] = useState<"once" | "repeating" | "forever">("once");
  const [months, setMonths]   = useState("3");
  const [promoCode, setPromoCode] = useState("");
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState("");

  useEffect(() => { if (open) { setName(""); setType("percent"); setValue(""); setDuration("once"); setMonths("3"); setPromoCode(""); setErr(""); } }, [open]);

  const submit = async () => {
    setErr("");
    const num = parseFloat(value);
    if (!name.trim()) return setErr("Name is required");
    if (!num || num <= 0) return setErr("Enter a valid value");
    setSaving(true);
    try {
      const body: any = {
        name: name.trim(), type, duration,
        value: type === "percent" ? num : Math.round(num * 100),
        currency: type === "amount" ? currency : undefined,
        durationInMonths: duration === "repeating" ? parseInt(months) : undefined,
        promoCode: promoCode.trim() || undefined,
      };
      const r = await fetch("/api/admin/billing/coupons", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (!r.ok) { setErr(d.error || "Failed"); return; }
      onToast({ type: "success", message: "Discount created" }); onDone(); onClose();
    } catch (e: any) { setErr(e?.message || "Network error"); }
    finally { setSaving(false); }
  };

  const inp = "w-full px-3 py-2 rounded-lg border border-stone-700 bg-stone-800/60 text-sm text-white placeholder-stone-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500";
  const lbl = "text-xs text-stone-400 block mb-1.5";

  return (
    <Modal open={open} onClose={onClose} title="New discount"
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={submit} disabled={saving}>{saving && <Loader size={13} className="animate-spin mr-1" />}{saving ? "Creating…" : "Create discount"}</Button></>}>
      <div className="px-5 py-5 space-y-4">
        <div><label className={lbl}>Name (internal)</label><input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Launch 20%" className={inp} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Type</label>
            <select value={type} onChange={e => setType(e.target.value as any)} className={inp}><option value="percent">Percentage</option><option value="amount">Fixed amount</option></select>
          </div>
          <div><label className={lbl}>{type === "percent" ? "Percent off" : "Amount off"}</label>
            <div className="flex gap-2">
              <input value={value} onChange={e => setValue(e.target.value)} placeholder={type === "percent" ? "20" : "50.00"} inputMode="decimal" className={inp} />
              {type === "amount" && (
                <select value={currency} onChange={e => setCurrency(e.target.value)} className={inp + " w-24"}>
                  {["GBP","EUR","USD"].map(c => <option key={c}>{c}</option>)}
                </select>
              )}
            </div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className={lbl}>Applies</label>
            <select value={duration} onChange={e => setDuration(e.target.value as any)} className={inp}>
              <option value="once">Once (first invoice)</option>
              <option value="repeating">Repeating (N months)</option>
              <option value="forever">Forever</option>
            </select>
          </div>
          {duration === "repeating" && <div><label className={lbl}>Months</label><input value={months} onChange={e => setMonths(e.target.value)} inputMode="numeric" className={inp} /></div>}
        </div>
        <div><label className={lbl}>Promotion code <span className="text-stone-600">(optional, customer-facing)</span></label>
          <input value={promoCode} onChange={e => setPromoCode(e.target.value.toUpperCase())} placeholder="LAUNCH20" className={inp + " font-mono"} />
        </div>
        {err && <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-300">{err}</div>}
      </div>
    </Modal>
  );
}

export default function DiscountsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [toast, setToast]     = useState<any>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [acting, setActing]   = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch("/api/admin/billing/coupons");
      const d = await r.json();
      if (r.ok) setCoupons(d.coupons ?? []);
      else setToast({ type: "error", message: d.error ?? `Failed (${r.status})` });
    } catch (e: any) { setToast({ type: "error", message: e?.message ?? "Network error" }); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (couponId: string, body: any, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setActing(couponId + (body.codeId ?? ""));
    try {
      const r = await fetch(`/api/admin/billing/coupons/${couponId}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const d = await r.json();
      if (r.ok) { setToast({ type: "success", message: "Done" }); load(); }
      else setToast({ type: "error", message: d.error ?? "Failed" });
    } finally { setActing(null); }
  };

  const addCode = (couponId: string) => {
    const code = window.prompt("New promotion code (e.g. SAVE20):")?.trim();
    if (code) act(couponId, { action: "add_code", code });
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-base font-semibold text-white">Discounts &amp; coupons</h1>
          <p className="text-xs text-stone-500 mt-0.5">Reusable discounts and customer-facing promotion codes</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={loading} className="flex items-center gap-1.5 text-xs text-stone-400 hover:text-stone-200 disabled:opacity-40"><RefreshCw size={12} className={loading ? "animate-spin" : ""} /></button>
          <Button onClick={() => setShowCreate(true)}><Plus size={14} /><span className="ml-1.5">New discount</span></Button>
        </div>
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-20 bg-stone-800 rounded-xl animate-pulse" />)}</div>
      ) : coupons.length === 0 ? (
        <Card><div className="py-14 text-center"><Percent size={28} className="text-stone-600 mx-auto mb-3" /><p className="text-sm text-stone-500">No discounts yet</p></div></Card>
      ) : (
        <div className="space-y-3">
          {coupons.map(c => (
            <Card key={c.id} padding="md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white">{c.name}</span>
                    {!c.valid && <Badge variant="neutral" size="sm">expired</Badge>}
                  </div>
                  <p className="text-xs text-stone-400 mt-0.5">{discountLabel(c)}</p>
                  <p className="text-[11px] text-stone-500 mt-0.5">
                    Redeemed {c.timesRedeemed}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""} times
                  </p>
                </div>
                <button onClick={() => act(c.id, { action: "delete" }, `Delete discount "${c.name}"? Existing subscriptions keep it; it just can't be applied to new ones.`)}
                  disabled={acting === c.id} className="text-stone-600 hover:text-rose-400 p-1 disabled:opacity-40" title="Delete"><Trash2 size={14} /></button>
              </div>

              {/* Promotion codes */}
              <div className="mt-3 pt-3 border-t border-stone-800">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wider text-stone-500 font-semibold">Promotion codes</span>
                  <button onClick={() => addCode(c.id)} className="text-[11px] text-sky-400 hover:text-sky-300 flex items-center gap-1"><Plus size={11} /> Add code</button>
                </div>
                {c.promotionCodes.length === 0 ? (
                  <p className="text-[12px] text-stone-600">No public code — applied manually to subscriptions.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {c.promotionCodes.map(p => (
                      <div key={p.id} className={`flex items-center gap-2 px-2.5 py-1 rounded-md border text-xs ${p.active ? "border-emerald-700/40 bg-emerald-500/10" : "border-stone-700 bg-stone-800/40 opacity-60"}`}>
                        <Tag size={11} className={p.active ? "text-emerald-400" : "text-stone-500"} />
                        <span className="font-mono text-stone-200">{p.code}</span>
                        <span className="text-[10px] text-stone-500">{p.timesRedeemed}×</span>
                        <button onClick={() => act(c.id, { action: "toggle_code", codeId: p.id, active: !p.active })}
                          className="text-stone-500 hover:text-stone-300" title={p.active ? "Deactivate" : "Activate"}><Power size={11} /></button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <CreateModal open={showCreate} onClose={() => setShowCreate(false)} onDone={load} onToast={setToast} />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
