import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// An invoice has exactly ONE creation path: the document form at
// /accounting/new/Invoice -> postDocument, which writes the ledger entry and
// bridges the row into `invoices`. A second form that inserts straight into
// `invoices` creates a receivable with no journal entry (off-ledger), and gives
// the user two different "New invoice" screens depending on where they clicked.

const ROOT = process.cwd();
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(join(ROOT, dir))) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const rel = join(dir, name);
    if (statSync(join(ROOT, rel)).isDirectory()) sourceFiles(rel, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(rel);
  }
  return out;
}

describe("single invoice creation path", () => {
  it("/api/invoices is read-only", () => {
    expect(read("app/api/invoices/route.ts")).not.toMatch(/export\s+async\s+function\s+POST/);
  });

  it("the data provider has no addInvoice", () => {
    expect(read("components/data-provider.tsx")).not.toMatch(/\baddInvoice\b/);
  });

  // Not matched on purpose: shipping-console's InvoiceDrawer (invoice FROM
  // shipments, posts via invoiceFromShipments) and admin's CreateInvoice
  // (Stripe billing invoice for our own customers) are different documents.
  it("no second AR invoice-creation modal or drawer exists", () => {
    const offenders = [...sourceFiles("components"), ...sourceFiles("app")].filter((f) =>
      /(function|const)\s+(InvoiceModal|NewInvoiceModal|NewInvoiceDrawer)\b/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("the Invoices page and the Create menu open the same form", () => {
    expect(read("app/(app)/invoices/page.tsx")).toContain('"/accounting/new/Invoice"');
    expect(read("components/create-menu.tsx")).toContain('"/accounting/new/Invoice"');
  });
});
