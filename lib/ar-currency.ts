// Totals of open receivables / payables, kept apart by currency. Pure — no db.
//
// The Executive Overview used to add every invoice's balance into one number
// and label it with the org's home currency: EDC's €2.86m EUR and £31,949 GBP
// came out as one "EUR" figure. Adding pounds to euros is not a total of
// anything, and the app keeps no rates for mirrored QuickBooks/Xero invoices to
// convert with honestly. So each currency is totalled on its own, and the
// headline figure is the HOME currency only, with the others listed beside it.

export type OpenItem = { currency: string | null | undefined; balance: number; dueDate: string | null | undefined };
export type CurrencyTotal = { currency: string; total: number; overdue: number; openCount: number };

const r2 = (n: number) => Math.round(n * 100) / 100;

/**
 * `today` is compared as a YYYY-MM-DD string (a date is a date). A blank
 * currency is the home currency — that is what a native or legacy row means.
 * Home comes first; the rest are ordered by size so the biggest exposure leads.
 */
export function totalsByCurrency(items: readonly OpenItem[], home: string, today: string): CurrencyTotal[] {
  const by = new Map<string, CurrencyTotal>();
  for (const it of items) {
    const ccy = (it.currency || home).toUpperCase();
    const t = by.get(ccy) ?? { currency: ccy, total: 0, overdue: 0, openCount: 0 };
    t.total += it.balance;
    t.openCount++;
    if (it.dueDate && it.dueDate < today) t.overdue += it.balance;
    by.set(ccy, t);
  }
  const rows = [...by.values()].map((t) => ({ ...t, total: r2(t.total), overdue: r2(t.overdue) }));
  const h = home.toUpperCase();
  return rows.sort((a, b) => (a.currency === h ? -1 : b.currency === h ? 1 : Math.abs(b.total) - Math.abs(a.total)));
}

/** The home-currency row, or zeros when nothing is open in it. */
export function homeTotal(rows: readonly CurrencyTotal[], home: string): CurrencyTotal {
  return rows.find((r) => r.currency === home.toUpperCase()) ?? { currency: home.toUpperCase(), total: 0, overdue: 0, openCount: 0 };
}

/**
 * The figure to lead with. Home currency if anything is open in it; otherwise,
 * when everything open is in ONE currency, that currency — ACC's org currency
 * is EUR but every invoice is USD, and a headline of €0 with $240k "elsewhere"
 * would read as "nothing is owed". With several non-home currencies there is no
 * honest single figure, so it stays home (zero) and the rest are listed.
 * Never a sum across currencies, whichever branch is taken.
 */
export function headlineTotal(rows: readonly CurrencyTotal[], home: string): CurrencyTotal {
  const h = rows.find((r) => r.currency === home.toUpperCase());
  if (h) return h;
  if (rows.length === 1) return rows[0];
  return homeTotal(rows, home);
}
