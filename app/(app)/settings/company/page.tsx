"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useData } from "@/components/data-provider";
import { Card, Button, Badge } from "@/components/ui";
import { MfaCard } from "@/components/mfa-card";
import { ChevronLeft, User, Palette, Calendar, DollarSign, Search, ChevronDown, Check } from "lucide-react";

// All currencies supported by frankfurter.app (same set used for FX conversion)
const ALL_CURRENCIES = [
  { value: "AED", symbol: "د.إ", name: "UAE Dirham" },
  { value: "AFN", symbol: "؋",   name: "Afghan Afghani" },
  { value: "ALL", symbol: "L",   name: "Albanian Lek" },
  { value: "AMD", symbol: "֏",   name: "Armenian Dram" },
  { value: "ANG", symbol: "ƒ",   name: "Netherlands Antillean Guilder" },
  { value: "AOA", symbol: "Kz",  name: "Angolan Kwanza" },
  { value: "ARS", symbol: "$",   name: "Argentine Peso" },
  { value: "AUD", symbol: "A$",  name: "Australian Dollar" },
  { value: "AWG", symbol: "ƒ",   name: "Aruban Florin" },
  { value: "AZN", symbol: "₼",   name: "Azerbaijani Manat" },
  { value: "BAM", symbol: "KM",  name: "Bosnia-Herzegovina Convertible Mark" },
  { value: "BBD", symbol: "Bds$",name: "Barbadian Dollar" },
  { value: "BDT", symbol: "৳",   name: "Bangladeshi Taka" },
  { value: "BGN", symbol: "лв",  name: "Bulgarian Lev" },
  { value: "BHD", symbol: ".د.ب",name: "Bahraini Dinar" },
  { value: "BND", symbol: "B$",  name: "Brunei Dollar" },
  { value: "BOB", symbol: "Bs.", name: "Bolivian Boliviano" },
  { value: "BRL", symbol: "R$",  name: "Brazilian Real" },
  { value: "BSD", symbol: "B$",  name: "Bahamian Dollar" },
  { value: "BWP", symbol: "P",   name: "Botswanan Pula" },
  { value: "BYN", symbol: "Br",  name: "Belarusian Ruble" },
  { value: "BZD", symbol: "BZ$", name: "Belize Dollar" },
  { value: "CAD", symbol: "C$",  name: "Canadian Dollar" },
  { value: "CHF", symbol: "Fr",  name: "Swiss Franc" },
  { value: "CLP", symbol: "$",   name: "Chilean Peso" },
  { value: "CNY", symbol: "¥",   name: "Chinese Yuan" },
  { value: "COP", symbol: "$",   name: "Colombian Peso" },
  { value: "CRC", symbol: "₡",   name: "Costa Rican Colón" },
  { value: "CZK", symbol: "Kč",  name: "Czech Koruna" },
  { value: "DKK", symbol: "kr",  name: "Danish Krone" },
  { value: "DOP", symbol: "RD$", name: "Dominican Peso" },
  { value: "DZD", symbol: "دج",  name: "Algerian Dinar" },
  { value: "EGP", symbol: "£",   name: "Egyptian Pound" },
  { value: "ETB", symbol: "Br",  name: "Ethiopian Birr" },
  { value: "EUR", symbol: "€",   name: "Euro" },
  { value: "FJD", symbol: "FJ$", name: "Fijian Dollar" },
  { value: "GBP", symbol: "£",   name: "British Pound" },
  { value: "GEL", symbol: "₾",   name: "Georgian Lari" },
  { value: "GHS", symbol: "₵",   name: "Ghanaian Cedi" },
  { value: "GMD", symbol: "D",   name: "Gambian Dalasi" },
  { value: "GTQ", symbol: "Q",   name: "Guatemalan Quetzal" },
  { value: "HKD", symbol: "HK$", name: "Hong Kong Dollar" },
  { value: "HNL", symbol: "L",   name: "Honduran Lempira" },
  { value: "HRK", symbol: "kn",  name: "Croatian Kuna" },
  { value: "HUF", symbol: "Ft",  name: "Hungarian Forint" },
  { value: "IDR", symbol: "Rp",  name: "Indonesian Rupiah" },
  { value: "ILS", symbol: "₪",   name: "Israeli Shekel" },
  { value: "INR", symbol: "₹",   name: "Indian Rupee" },
  { value: "ISK", symbol: "kr",  name: "Icelandic Króna" },
  { value: "JMD", symbol: "J$",  name: "Jamaican Dollar" },
  { value: "JOD", symbol: "JD",  name: "Jordanian Dinar" },
  { value: "JPY", symbol: "¥",   name: "Japanese Yen" },
  { value: "KES", symbol: "KSh", name: "Kenyan Shilling" },
  { value: "KGS", symbol: "с",   name: "Kyrgystani Som" },
  { value: "KHR", symbol: "៛",   name: "Cambodian Riel" },
  { value: "KRW", symbol: "₩",   name: "South Korean Won" },
  { value: "KWD", symbol: "KD",  name: "Kuwaiti Dinar" },
  { value: "KYD", symbol: "CI$", name: "Cayman Islands Dollar" },
  { value: "KZT", symbol: "₸",   name: "Kazakhstani Tenge" },
  { value: "LBP", symbol: "ل.ل", name: "Lebanese Pound" },
  { value: "LKR", symbol: "Rs",  name: "Sri Lankan Rupee" },
  { value: "MAD", symbol: "MAD", name: "Moroccan Dirham" },
  { value: "MDL", symbol: "L",   name: "Moldovan Leu" },
  { value: "MKD", symbol: "ден", name: "Macedonian Denar" },
  { value: "MNT", symbol: "₮",   name: "Mongolian Tugrik" },
  { value: "MOP", symbol: "P",   name: "Macanese Pataca" },
  { value: "MUR", symbol: "Rs",  name: "Mauritian Rupee" },
  { value: "MVR", symbol: "Rf",  name: "Maldivian Rufiyaa" },
  { value: "MWK", symbol: "MK",  name: "Malawian Kwacha" },
  { value: "MXN", symbol: "$",   name: "Mexican Peso" },
  { value: "MYR", symbol: "RM",  name: "Malaysian Ringgit" },
  { value: "MZN", symbol: "MT",  name: "Mozambican Metical" },
  { value: "NAD", symbol: "N$",  name: "Namibian Dollar" },
  { value: "NGN", symbol: "₦",   name: "Nigerian Naira" },
  { value: "NIO", symbol: "C$",  name: "Nicaraguan Córdoba" },
  { value: "NOK", symbol: "kr",  name: "Norwegian Krone" },
  { value: "NPR", symbol: "Rs",  name: "Nepalese Rupee" },
  { value: "NZD", symbol: "NZ$", name: "New Zealand Dollar" },
  { value: "OMR", symbol: "﷼",   name: "Omani Rial" },
  { value: "PAB", symbol: "B/.", name: "Panamanian Balboa" },
  { value: "PEN", symbol: "S/.", name: "Peruvian Sol" },
  { value: "PGK", symbol: "K",   name: "Papua New Guinean Kina" },
  { value: "PHP", symbol: "₱",   name: "Philippine Peso" },
  { value: "PKR", symbol: "₨",   name: "Pakistani Rupee" },
  { value: "PLN", symbol: "zł",  name: "Polish Zloty" },
  { value: "PYG", symbol: "₲",   name: "Paraguayan Guarani" },
  { value: "QAR", symbol: "﷼",   name: "Qatari Rial" },
  { value: "RON", symbol: "lei", name: "Romanian Leu" },
  { value: "RSD", symbol: "din", name: "Serbian Dinar" },
  { value: "RUB", symbol: "₽",   name: "Russian Ruble" },
  { value: "SAR", symbol: "﷼",   name: "Saudi Riyal" },
  { value: "SEK", symbol: "kr",  name: "Swedish Krona" },
  { value: "SGD", symbol: "S$",  name: "Singapore Dollar" },
  { value: "THB", symbol: "฿",   name: "Thai Baht" },
  { value: "TRY", symbol: "₺",   name: "Turkish Lira" },
  { value: "TTD", symbol: "TT$", name: "Trinidad and Tobago Dollar" },
  { value: "TWD", symbol: "NT$", name: "New Taiwan Dollar" },
  { value: "TZS", symbol: "Sh",  name: "Tanzanian Shilling" },
  { value: "UAH", symbol: "₴",   name: "Ukrainian Hryvnia" },
  { value: "UGX", symbol: "Sh",  name: "Ugandan Shilling" },
  { value: "USD", symbol: "$",   name: "US Dollar" },
  { value: "UYU", symbol: "$U",  name: "Uruguayan Peso" },
  { value: "UZS", symbol: "лв",  name: "Uzbekistani Som" },
  { value: "VND", symbol: "₫",   name: "Vietnamese Dong" },
  { value: "XAF", symbol: "Fr",  name: "Central African CFA Franc" },
  { value: "XOF", symbol: "Fr",  name: "West African CFA Franc" },
  { value: "YER", symbol: "﷼",   name: "Yemeni Rial" },
  { value: "ZAR", symbol: "R",   name: "South African Rand" },
  { value: "ZMW", symbol: "ZK",  name: "Zambian Kwacha" },
];

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

  // Currency
  const [currency, setCurrency] = useState("EUR");
  const [savingCurrency, setSavingCurrency] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const [currencyOpen, setCurrencyOpen] = useState(false);
  const currencyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (currencyRef.current && !currencyRef.current.contains(e.target as Node)) {
        setCurrencyOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    if (orgSettings) {
      setBrandingForm({ logoUrl: orgSettings.logoUrl || "", displayName: orgSettings.displayName || "" });
      setDateFormat(orgSettings.dateFormat || "DD MMM YYYY");
      setCurrency(orgSettings.currency || "EUR");
    }
  }, [orgSettings]);

  return (
    <div className="p-6 max-w-[720px] mx-auto">
      {/* Back + header */}
      <div className="mb-6">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-[13px] text-stone-500 hover:text-stone-200 mb-3 transition-colors"
        >
          <ChevronLeft size={14} /> Settings
        </Link>
        <h1 className="text-2xl font-semibold text-white tracking-tight">Company</h1>
        <p className="text-sm text-stone-400 mt-1">Profile, branding and date preferences.</p>
      </div>

      {/* Profile — read-only */}
      <Card className="mb-4">
        <div className="flex items-center gap-2 mb-4">
          <User size={16} className="text-stone-400" />
          <h3 className="text-sm font-semibold text-white">Your profile</h3>
        </div>
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-full bg-gradient-to-br from-stone-600 to-stone-800 flex items-center justify-center text-white text-lg font-semibold">
            {initials}
          </div>
          <div className="flex-1">
            <div className="text-base font-medium text-white">{userName}</div>
            <div className="text-sm text-stone-400">{userEmail}</div>
            <div className="mt-1">
              <Badge variant={isAdmin ? "purple" : "neutral"} size="sm">
                {(session?.user as any)?.role || "User"}
              </Badge>
            </div>
          </div>
        </div>
      </Card>

      {/* Two-factor auth (super admins only — self-gates) */}
      <div className="mb-4">
        <MfaCard />
      </div>

      {/* Organisation branding */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Palette size={16} className="text-stone-400" />
            <h3 className="text-sm font-semibold text-white">Organisation branding</h3>
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
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
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
                  className="w-full h-9 px-3 text-sm rounded-md ring-1 ring-stone-700 bg-stone-800 text-stone-300 placeholder-stone-600 focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                />
                <p className="text-[11px] text-stone-400 mt-1">Paste a URL to your company logo (PNG/SVG).</p>
              </div>
            </div>

            {brandingForm.logoUrl && (
              <div className="flex items-center gap-3 p-3 bg-stone-800 rounded-md ring-1 ring-stone-700">
                <img
                  src={brandingForm.logoUrl}
                  alt="Logo preview"
                  className="w-10 h-10 object-contain rounded"
                  onError={e => (e.currentTarget.style.display = "none")}
                />
                <div>
                  <div className="text-sm font-semibold text-white">
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
            <Calendar size={16} className="text-stone-400" />
            <h3 className="text-sm font-semibold text-white">Date format</h3>
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
                      ? "bg-emerald-600/20 text-white border-emerald-500"
                      : "bg-stone-800 text-stone-300 border-stone-700 hover:border-stone-500"
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

      {/* Home currency */}
      {isAdmin && (
        <Card className="mb-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign size={16} className="text-stone-400" />
            <h3 className="text-sm font-semibold text-white">Home currency</h3>
          </div>
          <p className="text-[12px] text-stone-400 mb-4">All reports, invoices and dashboards will display amounts in this currency.</p>
          <div className="space-y-3">
            {/* Searchable currency picker */}
            <div ref={currencyRef} className="relative">
              {/* Trigger */}
              <button
                onClick={() => { setCurrencyOpen(o => !o); setCurrencySearch(""); }}
                className="w-full flex items-center justify-between px-3 py-2.5 rounded-md ring-1 ring-stone-700 bg-stone-800 text-sm text-white hover:ring-stone-500 transition-colors"
              >
                <span className="flex items-center gap-2">
                  {(() => {
                    const c = ALL_CURRENCIES.find(c => c.value === currency);
                    return c ? (
                      <>
                        <span className="font-mono font-semibold text-emerald-400">{c.value}</span>
                        <span className="text-stone-300">{c.symbol}</span>
                        <span className="text-stone-400">{c.name}</span>
                      </>
                    ) : <span className="text-stone-500">Select currency…</span>;
                  })()}
                </span>
                <ChevronDown size={14} className={`text-stone-500 transition-transform ${currencyOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Dropdown */}
              {currencyOpen && (
                <div className="absolute z-50 mt-1 w-full bg-stone-900 rounded-lg ring-1 ring-stone-700 shadow-2xl overflow-hidden">
                  {/* Search */}
                  <div className="p-2 border-b border-stone-800">
                    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-stone-800 ring-1 ring-stone-700">
                      <Search size={13} className="text-stone-500 shrink-0" />
                      <input
                        autoFocus
                        value={currencySearch}
                        onChange={e => setCurrencySearch(e.target.value)}
                        placeholder="Search currency code or name…"
                        className="flex-1 bg-transparent text-sm text-white placeholder-stone-500 outline-none"
                      />
                    </div>
                  </div>
                  {/* List */}
                  <div className="max-h-64 overflow-y-auto">
                    {ALL_CURRENCIES
                      .filter(c => {
                        const q = currencySearch.toLowerCase();
                        return c.value.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
                      })
                      .map(c => (
                        <button
                          key={c.value}
                          onClick={() => { setCurrency(c.value); setCurrencyOpen(false); }}
                          className={`w-full flex items-center gap-3 px-4 py-2 text-left hover:bg-stone-800 transition-colors ${
                            currency === c.value ? "bg-emerald-600/10" : ""
                          }`}
                        >
                          <span className="w-10 font-mono font-semibold text-[13px] text-emerald-400 shrink-0">{c.value}</span>
                          <span className="w-6 text-stone-400 text-[13px] shrink-0">{c.symbol}</span>
                          <span className="text-[13px] text-stone-300 flex-1">{c.name}</span>
                          {currency === c.value && <Check size={13} className="text-emerald-400 shrink-0" />}
                        </button>
                      ))}
                    {ALL_CURRENCIES.filter(c => {
                      const q = currencySearch.toLowerCase();
                      return c.value.toLowerCase().includes(q) || c.name.toLowerCase().includes(q);
                    }).length === 0 && (
                      <div className="px-4 py-6 text-center text-sm text-stone-500">No currencies match "{currencySearch}"</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <Button
              size="sm"
              disabled={savingCurrency}
              onClick={async () => {
                setSavingCurrency(true);
                try {
                  await updateOrgSettings({ currency });
                } finally {
                  setSavingCurrency(false);
                }
              }}
            >
              {savingCurrency ? "Saving…" : "Save currency"}
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}
