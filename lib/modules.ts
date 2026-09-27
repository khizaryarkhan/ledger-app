/**
 * Per-org module assignment — which product areas an organisation has
 * access to. Manufacturing (BOM, production, job work, receiving, shipping,
 * lot traceability) is the first non-core module: assigned by a platform
 * admin, not self-service, since it's a vertical the org has bought into
 * rather than a preference they toggle. See CLAUDE.md "Modules & per-org
 * feature gating" for the full pattern.
 *
 * Client-safe (no `db`/server imports) — used by nav, the reports hub, and
 * the admin modules card. Server-side enforcement (`requireModule`) lives in
 * lib/modules-server.ts so it never gets pulled into a client bundle.
 */

export const MODULE_KEYS = ["receivables", "payables", "studio", "accounting", "manufacturing", "resources"] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export const MODULES: Record<ModuleKey, { label: string; core: boolean; description: string }> = {
  receivables:   { label: "Receivables",           core: true,  description: "Collections board, invoices, customer escalations" },
  payables:      { label: "Payables",               core: true,  description: "Bills, purchase orders, supplier payments" },
  studio:        { label: "Data Studio",            core: true,  description: "Bulk QBO/Xero import, export, update, delete" },
  accounting:    { label: "Native Accounting",       core: true,  description: "General ledger, journal, native financial statements" },
  manufacturing: { label: "Manufacturing & Production", core: false, description: "Bill of materials, production builds, job work, receiving, shipping, lot traceability" },
  resources:     { label: "Resource Management",    core: false, description: "Schedule people and equipment against projects and production orders" },
};

export function isModuleKey(v: unknown): v is ModuleKey {
  return typeof v === "string" && (MODULE_KEYS as readonly string[]).includes(v);
}

export function hasModule(enabledModules: unknown, key: ModuleKey): boolean {
  return Array.isArray(enabledModules) && enabledModules.includes(key);
}

// ── Who owns a URL ──────────────────────────────────────────────────────────
//
// The admin portal's module checkboxes used to be honoured for manufacturing
// and resources only; the four "core" modules were drawn unconditionally, so
// unticking Accounting or Studio for an org changed nothing anywhere. These
// two tables are the single answer to "which module does this page / API
// route belong to?" — the sidebar, the page guard (components/module-gate.tsx)
// and the server (requireOrg in lib/api.ts) all read them, so the three can
// never disagree.
//
// A URL is gated only when ONE module owns it outright. Much of the app is
// deliberately shared — Customers, Suppliers, Projects, Products, tax rates,
// currencies, the document detail page, PO/SO screens and the reports hub are
// reached from several modules (see CLAUDE.md "shared master data") — and
// gating those by URL prefix would break the module that borrows them. So an
// entry with `owner: null` is an explicit "shared, never gated", and it must
// sit ABOVE the prefix it carves out of: first match wins.
//
// manufacturing (/supply-chain pages, /api/production and /api/inventory
// except the shared items/skus/supplier-skus master data) and resources
// (/resources pages, /api/resources) ARE fully listed below, same as every
// other module — every one of their routes already called requireModule()
// independently before they were registered here, so registering them changed
// no runtime behaviour, only closed a registry gap (a bookmarked/typed URL to
// e.g. /supply-chain used to render with no gate at all).
// tests/module-gating.test.ts's reverse-completeness check guards against this
// class of gap recurring: every real page/API route must be either registered
// here (owned or explicit `owner: null`) or named in that test's own allowlist
// with a reason.

export type PathRule = { path: string; owner: ModuleKey | null; exact?: boolean };

export function matches(pathname: string, r: PathRule): boolean {
  if (pathname === r.path) return true;
  return !r.exact && pathname.startsWith(r.path + "/");
}

/** The first rule (in order) whose path matches pathname, or null if none does. */
export function findRule(rules: readonly PathRule[], pathname: string): PathRule | null {
  for (const r of rules) if (matches(pathname, r)) return r;
  return null;
}

function ownerOf(rules: readonly PathRule[], pathname: string): ModuleKey | null {
  return findRule(rules, pathname)?.owner ?? null;
}

const ACCOUNTING_REPORTS = [
  "trial-balance", "profit-loss", "balance-sheet", "general-ledger", "cash-flow",
  "tax-liability", "fx-exposure", "aged-receivables", "aged-payables",
];

export const PAGE_OWNERS: readonly PathRule[] = [
  // Shared — carved out of the prefixes below.
  { path: "/payables/suppliers", owner: null },          // shared master data
  { path: "/batch/history", owner: null },               // Receivables' "Email History" runs on the batch engine
  { path: "/accounting/new/PurchaseOrder", owner: null }, // Supply Chain's documents, hosted under /accounting
  { path: "/accounting/new/SalesOrder", owner: null },

  // Studio
  { path: "/batch", owner: "studio" },

  // Payables
  { path: "/payables", owner: "payables" },

  // Accounting — the general ledger and what is built from it. Setup lists,
  // products, PO/SO, job work, the document detail page and the reports hub
  // stay shared: Supply Chain and Payables link to them.
  { path: "/accounting", owner: "accounting", exact: true },
  { path: "/accounting/dashboard", owner: "accounting" },
  { path: "/accounting/accounts", owner: "accounting" },
  { path: "/accounting/journal", owner: "accounting" },
  { path: "/accounting/opening-balances", owner: "accounting" },
  { path: "/accounting/reconcile", owner: "accounting" },
  { path: "/accounting/new", owner: "accounting" },       // native GL documents (PO/SO carved out above)
  { path: "/accounting/trade/estimates", owner: "accounting" }, // estimates commit nothing — Accounting's (CLAUDE.md IA rule)
  ...ACCOUNTING_REPORTS.map((r) => ({ path: `/accounting/reports/${r}`, owner: "accounting" as const })),

  // Receivables
  { path: "/dashboard", owner: "receivables" },
  { path: "/board", owner: "receivables" },
  { path: "/invoices", owner: "receivables" },
  { path: "/inbox", owner: "receivables" },
  { path: "/tasks", owner: "receivables" },
  { path: "/automations", owner: "receivables" },
  { path: "/responses", owner: "receivables" },
  { path: "/performance", owner: "receivables" },
  { path: "/smart-views", owner: "receivables" },
  { path: "/ar-report", owner: "receivables" },
  { path: "/reports", owner: "receivables" },

  // Supply Chain / Resources — see CLAUDE.md "Modules & per-org feature gating".
  { path: "/supply-chain", owner: "manufacturing" },
  { path: "/resources", owner: "resources" },
];

export const API_OWNERS: readonly PathRule[] = [
  // Shared — carved out of the prefixes below.
  { path: "/api/batch/jobs", owner: null },              // the job engine behind Receivables' bulk invoice send
  { path: "/api/payables/suppliers", owner: null },      // Accounting's purchases and GL reports read suppliers
  { path: "/api/inventory/items", owner: null },         // Products & Services — every org's master data, not just Supply Chain's
  { path: "/api/inventory/skus", owner: null },
  { path: "/api/inventory/supplier-skus", owner: null },

  // Studio
  { path: "/api/batch", owner: "studio" },
  { path: "/api/google-sheets", owner: "studio" },       // scheduled imports

  // Payables
  { path: "/api/payables", owner: "payables" },

  // Accounting — GL-only reads and the manual journal. Document posting
  // (/api/documents, /api/transactions, /api/trade-documents), a single
  // entry (/api/ledger/journal/[id], read by the shared document page),
  // master-data lists (/api/accounting/[entity]) and period close stay
  // shared: Supply Chain posts through them too.
  { path: "/api/ledger/journal", owner: "accounting", exact: true },
  { path: "/api/ledger/trial-balance", owner: "accounting" },
  { path: "/api/financials", owner: "accounting" },
  { path: "/api/accounting/opening-balances", owner: "accounting" },
  { path: "/api/accounting/reconcile", owner: "accounting" },
  { path: "/api/accounting/aging", owner: "accounting" },
  { path: "/api/accounting/cash-flow", owner: "accounting" },
  { path: "/api/accounting/fx-exposure", owner: "accounting" },
  { path: "/api/accounting/tax-liability", owner: "accounting" },

  // Supply Chain / Resources — every route here already called
  // requireModule() independently before it was registered; see the header
  // comment above.
  { path: "/api/production", owner: "manufacturing" },
  { path: "/api/inventory", owner: "manufacturing" },
  { path: "/api/resources", owner: "resources" },

  // Receivables — only what nothing else calls. /api/invoices, /api/customers,
  // /api/communications, /api/tasks and /api/reps are loaded by the app-wide
  // data provider on every page, whatever the module.
  { path: "/api/board", owner: "receivables" },
  { path: "/api/disputes", owner: "receivables" },
  { path: "/api/responses", owner: "receivables" },
];

/** Where each module starts — the landing page offered when a page is blocked. */
export const MODULE_HOME: Record<ModuleKey, string> = {
  receivables:   "/dashboard",
  payables:      "/payables/dashboard",
  accounting:    "/accounting/dashboard",
  manufacturing: "/supply-chain/dashboard",
  resources:     "/resources/board",
  studio:        "/batch",
};

// Header middleware.ts stamps with the real request path on every
// authenticated request — overwriting anything the client sent — so
// requireOrg() can enforce API_OWNERS without each route naming its module.
// Lives here, not in modules-server.ts, because middleware runs on the Edge.
export const APP_PATH_HEADER = "x-app-path";

/** The module that owns a page, or null when the page is shared / unowned. */
export function moduleForPage(pathname: string): ModuleKey | null {
  return ownerOf(PAGE_OWNERS, pathname);
}

/** The module that owns an API route, or null when the route is shared / unowned. */
export function moduleForApi(pathname: string): ModuleKey | null {
  return ownerOf(API_OWNERS, pathname);
}
