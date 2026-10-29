import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

// A customer has exactly ONE create/edit form: components/party-drawer.tsx,
// saving through /api/parties/customers. Before this, the Customers pages had
// their own CustomerModal posting to /api/customers, so the fields a customer
// carried depended on which button created it — and its Country dropdown sent a
// countryId that neither the POST schema nor the PATCH allowlist accepted, so
// the choice was silently discarded.

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

describe("single customer creation path", () => {
  it("no CustomerModal exists", () => {
    const offenders = [...sourceFiles("components"), ...sourceFiles("app")].filter((f) =>
      /\bCustomerModal\b/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it("/api/customers is not a creation route", () => {
    expect(read("app/api/customers/route.ts")).not.toMatch(/export\s+async\s+function\s+POST/);
  });

  it("the data provider has no addCustomer / updateCustomer", () => {
    expect(read("components/data-provider.tsx")).not.toMatch(/\b(addCustomer|updateCustomer)\b/);
  });

  it("both Customers pages open PartyDrawer", () => {
    expect(read("app/(app)/customers/page.tsx")).toContain("PartyDrawer");
    expect(read("app/(app)/customers/[id]/page.tsx")).toContain("PartyDrawer");
  });

  it("a customer's country is persisted, not just displayed", () => {
    expect(read("app/api/parties/[type]/route.ts")).toContain("countryId");
    expect(read("app/api/parties/[type]/[id]/route.ts")).toContain("countryId");
    expect(read("components/party-drawer.tsx")).toContain("countryId");
  });

  it("any org user can create or edit a customer; suppliers/employees stay admin-only", () => {
    for (const p of ["app/api/parties/[type]/route.ts", "app/api/parties/[type]/[id]/route.ts"]) {
      expect(read(p)).toMatch(/params\.type\s*!==\s*"customers"[^\n]*company_admin|company_admin[^\n]*params\.type\s*!==\s*"customers"/);
    }
  });
});

describe("project form has no inert fields", () => {
  // The projects table has no date columns and POST/PATCH ignore these keys, so
  // an input for them reported "saved" and discarded the value.
  it("ProjectModal does not offer start / end / projected-end dates", () => {
    const forms = read("components/forms.tsx");
    for (const key of ["startDate", "endDate", "projectedEndDate"]) expect(forms).not.toContain(key);
  });
});
