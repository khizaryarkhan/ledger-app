"use client";

import { useState } from "react";
import { Loader, CheckCircle2, AlertCircle } from "lucide-react";

const COMPANY_SIZES = [
  "1–10 employees",
  "11–50 employees",
  "51–200 employees",
  "201–500 employees",
  "500+ employees",
];

const SERVICES = [
  "Accounts Receivable Automation",
  "Invoice Chasing & Collections",
  "Customer Payment Portal",
  "AR Reporting & Analytics",
  "Services with a bookkeeper for full accounting cycle",
  "Full Platform",
  "Not sure — I'd like a demo",
];

const COUNTRIES = [
  "United Kingdom",
  "Ireland",
  "United States",
  "Canada",
  "Australia",
  "New Zealand",
  "South Africa",
  "Pakistan",
  "India",
  "United Arab Emirates",
  "Saudi Arabia",
  "Qatar",
  "Bahrain",
  "Kuwait",
  "Oman",
  "Germany",
  "France",
  "Netherlands",
  "Spain",
  "Italy",
  "Sweden",
  "Norway",
  "Denmark",
  "Finland",
  "Switzerland",
  "Belgium",
  "Portugal",
  "Poland",
  "Singapore",
  "Malaysia",
  "Nigeria",
  "Kenya",
  "Ghana",
  "Other",
];

export function InterestForm({ className = "" }: { className?: string }) {
  const [form, setForm] = useState({
    fullName: "",
    companyName: "",
    email: "",
    phone: "",
    country: "",
    companySize: "",
    interestedService: "",
    message: "",
  });
  const [status, setStatus]   = useState<"idle" | "loading" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const set = (k: string) => (e: any) => setForm(f => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.fullName.trim() || !form.email.trim()) return;
    setStatus("loading");
    setErrorMsg("");
    try {
      const r = await fetch("/api/interest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          utmSource:   new URLSearchParams(window.location.search).get("utm_source"),
          utmMedium:   new URLSearchParams(window.location.search).get("utm_medium"),
          utmCampaign: new URLSearchParams(window.location.search).get("utm_campaign"),
        }),
      });
      if (r.ok) {
        setStatus("success");
      } else {
        const d = await r.json().catch(() => ({}));
        setErrorMsg(d.error ?? "We couldn't submit your request. Please try again.");
        setStatus("error");
      }
    } catch {
      setErrorMsg("We couldn't submit your request. Please check your connection and try again.");
      setStatus("error");
    }
  };

  if (status === "success") {
    return (
      <div className={`flex flex-col items-center gap-4 py-10 text-center ${className}`}>
        <div className="w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center">
          <CheckCircle2 size={26} className="text-emerald-400" />
        </div>
        <h3 className="text-lg font-semibold text-white">Request received</h3>
        <p className="text-sm text-stone-400 max-w-xs leading-relaxed">
          Thanks for your interest. Our team has received your request and will contact you shortly.
        </p>
      </div>
    );
  }

  const selectCls = "w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-900 text-stone-200 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 appearance-none transition-colors";
  const inputCls  = "w-full h-10 px-3 text-sm rounded-lg border border-stone-700 bg-stone-900 text-white placeholder-stone-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors";

  return (
    <form onSubmit={handleSubmit} className={`space-y-4 ${className}`}>
      {status === "error" && (
        <div className="flex items-start gap-2.5 p-3 bg-rose-500/10 border border-rose-500/20 rounded-lg">
          <AlertCircle size={14} className="text-rose-400 mt-0.5 flex-shrink-0" />
          <p className="text-xs text-rose-400">{errorMsg}</p>
        </div>
      )}

      {/* Row 1: Name + Company */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">
            Full name <span className="text-rose-500">*</span>
          </label>
          <input type="text" required value={form.fullName} onChange={set("fullName")}
            placeholder="Jane Smith" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">Business / company name</label>
          <input type="text" value={form.companyName} onChange={set("companyName")}
            placeholder="Acme Ltd" className={inputCls} />
        </div>
      </div>

      {/* Row 2: Email + Phone */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">
            Email address <span className="text-rose-500">*</span>
          </label>
          <input type="email" required value={form.email} onChange={set("email")}
            placeholder="jane@company.com" className={inputCls} />
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">
            Phone <span className="text-stone-600">(optional)</span>
          </label>
          <input type="tel" value={form.phone} onChange={set("phone")}
            placeholder="+44 7700 900 000" className={inputCls} />
        </div>
      </div>

      {/* Row 3: Country + Company size */}
      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">
            Country <span className="text-stone-600">(optional)</span>
          </label>
          <select value={form.country} onChange={set("country")} className={selectCls}>
            <option value="">Select country…</option>
            {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-stone-400 mb-1.5">
            Company size <span className="text-stone-600">(optional)</span>
          </label>
          <select value={form.companySize} onChange={set("companySize")} className={selectCls}>
            <option value="">Select…</option>
            {COMPANY_SIZES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Row 4: Interested in (full width) */}
      <div>
        <label className="block text-xs text-stone-400 mb-1.5">
          Interested in <span className="text-stone-600">(optional)</span>
        </label>
        <select value={form.interestedService} onChange={set("interestedService")} className={selectCls}>
          <option value="">Select a service…</option>
          {SERVICES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Row 5: Message */}
      <div>
        <label className="block text-xs text-stone-400 mb-1.5">
          Message <span className="text-stone-600">(optional)</span>
        </label>
        <textarea value={form.message} onChange={set("message")} rows={3} maxLength={2000}
          placeholder="Tell us a bit about your business or what you're looking for…"
          className="w-full px-3 py-2.5 text-sm rounded-lg border border-stone-700 bg-stone-900 text-white placeholder-stone-500 resize-none focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-colors"
        />
      </div>

      <button type="submit" disabled={status === "loading"}
        className="w-full h-11 flex items-center justify-center gap-2 text-sm font-semibold rounded-lg bg-emerald-500 text-white hover:bg-emerald-400 disabled:bg-stone-700 disabled:text-stone-500 transition-colors">
        {status === "loading"
          ? <><Loader size={15} className="animate-spin" /> Sending…</>
          : "Request a Demo"}
      </button>

      <p className="text-[11px] text-stone-600 text-center">
        By submitting you agree to our privacy policy. We will never share your data.
      </p>
    </form>
  );
}
