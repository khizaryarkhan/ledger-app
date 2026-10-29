import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// The Invoices page is the reference list. Its page-level chrome — search, the
// date period, row selection and Export Excel — lives in components/list-chrome.tsx
// and lib/list-period.ts so every list can have it without a fresh copy. These
// guards keep the migrated lists on the shared pieces and stop a new private
// copy of the period helpers from appearing.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const rel = join(dir, name).replace(/\\/g, "/");
    if (statSync(join(ROOT, rel)).isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("lists share the Invoices page chrome", () => {
  for (const file of [
    "app/(app)/invoices/page.tsx",
    "components/trade-doc-list.tsx",
    "app/(app)/payables/bills/page.tsx",
    "app/(app)/payables/payment-runs/page.tsx",
    "app/(app)/payables/purchase-orders/page.tsx",
    "app/(app)/payables/supplier-queries/page.tsx",
  ]) {
    it(`${file} uses the shared search, period, selection and export`, () => {
      const src = read(file);
      for (const piece of ["ListSearch", "ListPeriodFilter", "useRowSelection", "ListExportButton", "usePeriodFilter"]) {
        expect(src, `${file} should use ${piece}`).toContain(piece);
      }
    });
  }

  it("Estimates, Purchase Orders and Sales Orders keep every row action they had", () => {
    const src = read("components/trade-doc-list.tsx");
    for (const action of ["setConfirming(r)", "setModal(r)", "invoiceFull(r.id)", "del(r.id", "/api/print/pdf", "/print/trade/", "Track", "Fulfil in Shipping"]) {
      expect(src, `lost the "${action}" action`).toContain(action);
    }
  });
});

describe("no new private copy of the period helpers", () => {
  // Each of these still has its own copy and is waiting to be moved onto
  // lib/list-period.ts (the Payables lists have all been moved). Remove an entry when its file is migrated; an entry that
  // no longer matches fails, so the list cannot go stale.
  const KNOWN_COPIES = [
    "app/(app)/reports/page.tsx", // different shape: also returns the prior period for comparison
  ];
  const copies = [...sourceFiles("app"), ...sourceFiles("components")].filter((f) => /function getPeriodRange\s*\(/.test(read(f)));

  it("only the known files define getPeriodRange", () => {
    expect(copies.filter((f) => !KNOWN_COPIES.includes(f))).toEqual([]);
  });

  it("every known copy is still there (migrate it, then delete its entry)", () => {
    expect(KNOWN_COPIES.filter((f) => !copies.includes(f))).toEqual([]);
  });
});
