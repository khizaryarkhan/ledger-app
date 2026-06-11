"use client";

import { fmt } from "@/lib/format";

/**
 * Renders a compact currency breakdown: "PKR 1,499,999 · USD 25,000"
 * Sorted largest-first. Pass a Record<currencyCode, amount>.
 */
export function CurrencyPills({
  breakdown,
  className,
  separator = " · ",
  stacked = false,
}: {
  breakdown: Record<string, number>;
  className?: string;
  separator?: string;
  stacked?: boolean;
}) {
  const entries = Object.entries(breakdown)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1]);

  if (entries.length === 0) return <span className={className}>—</span>;

  if (stacked) {
    return (
      <span className={`flex flex-col gap-0.5 ${className ?? ""}`}>
        {entries.map(([c, v]) => (
          <span key={c}>{fmt.money(v, c)}</span>
        ))}
      </span>
    );
  }

  return (
    <span className={className}>
      {entries.map(([c, v], i) => (
        <span key={c}>
          {i > 0 && <span className="opacity-40">{separator}</span>}
          {fmt.money(v, c)}
        </span>
      ))}
    </span>
  );
}

/** Build a currency breakdown map from an array of { amount, currency } items. */
export function buildBreakdown(
  items: { amount: number; currency: string }[]
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const { amount, currency } of items) {
    if (!currency || amount === 0) continue;
    out[currency] = (out[currency] || 0) + amount;
  }
  return out;
}
