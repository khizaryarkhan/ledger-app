const MONTH_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

/**
 * Format a date according to an org's chosen date format.
 * Supported formats:
 *   DD MMM YYYY  → 07 May 2026  (default)
 *   DD/MM/YYYY   → 07/05/2026
 *   MM/DD/YYYY   → 05/07/2026
 *   YYYY-MM-DD   → 2026-05-07
 *   MMM DD, YYYY → May 07, 2026
 */
export function formatDate(d: string | Date | null | undefined, format = "DD MMM YYYY"): string {
  if (!d) return "—";
  const date = new Date(d);
  if (isNaN(date.getTime())) return "—";
  const day = date.getDate().toString().padStart(2, "0");
  const month = date.getMonth();
  const year = date.getFullYear();
  const mm = (month + 1).toString().padStart(2, "0");
  switch (format) {
    case "DD MMM YYYY":  return `${day} ${MONTH_SHORT[month]} ${year}`;
    case "DD/MM/YYYY":   return `${day}/${mm}/${year}`;
    case "MM/DD/YYYY":   return `${mm}/${day}/${year}`;
    case "YYYY-MM-DD":   return `${year}-${mm}-${day}`;
    case "MMM DD, YYYY": return `${MONTH_SHORT[month]} ${day}, ${year}`;
    default:             return `${day} ${MONTH_SHORT[month]} ${year}`;
  }
}

/** Pick a sensible English locale for a given ISO 4217 currency code. */
function currencyLocale(ccy: string): string {
  if (ccy === "GBP") return "en-GB";
  if (ccy === "EUR") return "en-IE";
  if (ccy === "AUD") return "en-AU";
  if (ccy === "NZD") return "en-NZ";
  if (ccy === "SGD") return "en-SG";
  if (ccy === "ZAR") return "en-ZA";
  if (ccy === "NOK" || ccy === "DKK" || ccy === "SEK") return "en-US"; // use US formatting for Scandinavian currencies
  return "en-US"; // USD, CAD, CHF, AED, etc.
}

export const fmt = {
  money: (n: number | null | undefined, ccy = "EUR") => {
    if (n == null || isNaN(n)) return "—";
    return new Intl.NumberFormat(currencyLocale(ccy), { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
  },
  // Always includes year — use formatDate(d, orgSettings.dateFormat) for org-specific format
  date: (d: string | Date | null | undefined) => d ? new Date(d).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" }) : "—",
  // Short date — now includes year for clarity
  shortDate: (d: string | Date | null | undefined) => d ? new Date(d).toLocaleDateString("en-IE", { day: "2-digit", month: "short", year: "numeric" }) : "—",
  relative: (d: string | Date | null | undefined) => {
    if (!d) return "—";
    const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
    if (days === 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 0) return `in ${Math.abs(days)}d`;
    if (days < 7) return `${days}d ago`;
    if (days < 30) return `${Math.floor(days / 7)}w ago`;
    return `${Math.floor(days / 30)}mo ago`;
  },
};

export const daysOverdue = (dueDate: string | null | undefined) => {
  if (!dueDate) return 0;
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000);
};

export const getDueStatus = (inv: any) => {
  if (inv.paymentStatus === "Paid") return "Paid";
  if (inv.paymentStatus === "Written Off") return "Written Off";
  const d = daysOverdue(inv.dueDate);
  if (d > 0) return "Overdue";
  if (d === 0) return "Due Today";
  if (d >= -7) return "Due Soon";
  return "Not Due";
};

export const getAgingBucket = (inv: any) => {
  const d = daysOverdue(inv.dueDate);
  if (d <= 0) return "Current";
  if (d <= 30) return "1-30";
  if (d <= 60) return "31-60";
  if (d <= 90) return "61-90";
  return "90+";
};

export const today = () => new Date().toISOString().slice(0, 10);
export const daysFromNow = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};
