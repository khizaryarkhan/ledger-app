"use client";

/**
 * One form for every native transaction under "New". Its behaviour is driven by
 * CFG[type]: line-item documents (Invoice/Bill/Credit note/…), money movements
 * (Receive payment/Pay bill), transfers and deposits. All double-entry rules
 * live server-side in lib/accounting/documents — this just collects the fields.
 */

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Check, Loader, AlertTriangle, X, FileText, ChevronRight } from "lucide-react";
import { CURRENCIES } from "@/lib/accounting/currencies";
import { QuickAdd, type QuickAddKind } from "@/components/quick-add";
import { PartyDrawer } from "@/components/party-drawer";
import { NewItemDrawer } from "@/components/products-register";
import { isTracked, kindOf } from "@/lib/inventory/item-kinds";
import { orderOptions, salesOrderOptions, perSupplierUnit, ratePerOrderUnit, type OrderOption } from "@/lib/inventory/order-options";
import { sourcingViolations, SOURCING_ENFORCED_TYPES, allowsAnySupplier } from "@/lib/inventory/sourcing";
import { calcLineTax, type TaxCodeRates } from "@/lib/accounting/tax-engine";

// Finished Product / Work in Progress lots are always system-generated at
// commit time — never a user-editable field here (see the "Receive to lot"
// row below and lib/inventory/valuation.ts's resolveLotNo).
const isFPWIP = (it: any) => ["FinishedProduct", "WorkInProgress"].includes(kindOf(it?.productType).kind);
import { CalcInput, CellSelect, Field, QtyUnitField, Section, SelectField, cell, control, fieldLabel, tableHead, th as thCls } from "@/components/form-kit";
import { localToday, ymd, fmt } from "@/lib/format";

export type DocType =
  | "Invoice" | "SalesReceipt" | "CreditNote" | "RefundReceipt"
  | "Bill" | "Expense" | "VendorCredit"
  | "Payment" | "BillPayment" | "Deposit" | "Transfer"
  | "Estimate" | "PurchaseOrder" | "SalesOrder";

type Cfg = {
  title: string;
  mode: "lineItems" | "payment" | "transfer" | "deposit";
  side?: "sales" | "purchase";
  party?: "Customer" | "Vendor";
  partyLabel?: string;
  tax?: boolean;
  // Line entry model: sales use items, purchases use both a category account and
  // items, deposits use accounts. (Journal has its own dedicated form.)
  lineMode?: "item" | "account" | "both";
  bank?: string;            // label for the bank field (present = show it)
  trade?: "estimates" | "purchase-orders" | "sales-orders"; // non-posting: save to /api/trade-documents
  dateLabel2?: string;      // second date field label (expiry / delivery)
  terms?: boolean;          // show payment terms + due date (Invoice/Bill)
  refLabel?: string;        // show a reference field with this label
  submit: string;
  blurb: string;
};

const TERMS: { key: string; label: string; days: number | null }[] = [
  { key: "receipt", label: "Due on receipt", days: 0 },
  { key: "net7", label: "Net 7", days: 7 },
  { key: "net15", label: "Net 15", days: 15 },
  { key: "net30", label: "Net 30", days: 30 },
  { key: "net60", label: "Net 60", days: 60 },
  { key: "custom", label: "Custom", days: null },
];
function addDays(dateStr: string, days: number) {
  const d = new Date(dateStr + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

const CFG: Record<DocType, Cfg> = {
  Invoice:       { title: "Invoice",         mode: "lineItems", side: "sales",     party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", terms: true, refLabel: "Customer PO", submit: "Save invoice",        blurb: "Bill a customer. Posts Dr Accounts Receivable, Cr Income and Sales Tax." },
  SalesReceipt:  { title: "Sales receipt",   mode: "lineItems", side: "sales",     party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", bank: "Deposit to",  submit: "Save sales receipt",  blurb: "A sale paid at the point of sale. Posts Dr Bank, Cr Income and Sales Tax." },
  CreditNote:    { title: "Credit note",     mode: "lineItems", side: "sales",     party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", submit: "Save credit note",    blurb: "Reduce what a customer owes. Posts Dr Income and Sales Tax, Cr Accounts Receivable." },
  RefundReceipt: { title: "Refund receipt",  mode: "lineItems", side: "sales",     party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", bank: "Refund from", submit: "Save refund",         blurb: "Refund a customer in cash. Posts Dr Income and Sales Tax, Cr Bank." },
  Bill:          { title: "Bill",            mode: "lineItems", side: "purchase",  party: "Vendor",   partyLabel: "Supplier", tax: true, lineMode: "both", terms: true, refLabel: "Supplier ref", submit: "Save bill",           blurb: "A supplier bill to pay later. Posts Dr Expense and Input Tax, Cr Accounts Payable." },
  Expense:       { title: "Expense",         mode: "lineItems", side: "purchase",  party: "Vendor",   partyLabel: "Supplier", tax: true, lineMode: "both", bank: "Paid from", refLabel: "Reference",  submit: "Save expense",        blurb: "A cost paid directly. Posts Dr Expense and Input Tax, Cr Bank." },
  VendorCredit:  { title: "Supplier credit", mode: "lineItems", side: "purchase",  party: "Vendor",   partyLabel: "Supplier", tax: true, lineMode: "both", submit: "Save supplier credit", blurb: "A credit from a supplier. Posts Dr Accounts Payable, Cr Expense and Input Tax." },
  Payment:       { title: "Receive payment", mode: "payment",   party: "Customer", partyLabel: "Customer", bank: "Deposit to", refLabel: "Reference no.", submit: "Save payment",        blurb: "Record money received from a customer. Posts Dr Bank, Cr Accounts Receivable." },
  BillPayment:   { title: "Pay bill",        mode: "payment",   party: "Vendor",   partyLabel: "Supplier", bank: "Paid from",  refLabel: "Reference no.", submit: "Save payment",        blurb: "Pay a supplier. Posts Dr Accounts Payable, Cr Bank." },
  Deposit:       { title: "Bank deposit",    mode: "deposit",   lineMode: "account", bank: "Deposit to", submit: "Save deposit",        blurb: "Money into a bank account. Posts Dr Bank, Cr the source accounts." },
  Transfer:      { title: "Transfer",        mode: "transfer",  submit: "Save transfer",       blurb: "Move money between two accounts. Posts Dr the destination, Cr the source." },
  Estimate:      { title: "Estimate",        mode: "lineItems", side: "sales",    party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", trade: "estimates",       dateLabel2: "Valid until",  submit: "Save estimate",       blurb: "A quote for a customer — no ledger impact until you convert it to an invoice." },
  PurchaseOrder: { title: "Purchase order",  mode: "lineItems", side: "purchase", party: "Vendor",   partyLabel: "Supplier", tax: true, lineMode: "both", trade: "purchase-orders", dateLabel2: "Delivery date", submit: "Save purchase order", blurb: "An order to a supplier — no ledger impact until you convert it to a bill." },
  SalesOrder:    { title: "Sales order",     mode: "lineItems", side: "sales",    party: "Customer", partyLabel: "Customer", tax: true, lineMode: "both", trade: "sales-orders",    dateLabel2: "Delivery date", submit: "Save sales order",    blurb: "A confirmed customer order — no ledger impact until you ship & invoice it." },
};

type Line = {
  itemId: string; accountId: string; accountOverride?: boolean; description: string; qty: string; rate: string; amount: string; taxRateId: string;
  // Native tax engine (Phase 3c) — mutually exclusive with taxRateId; picking
  // one clears the other so a line is never ambiguous between the legacy flat
  // rate and a tax code. See withTax() in lib/accounting/documents.ts.
  taxCodeId?: string;
  classId: string; locationId: string; lotNo?: string; expiryDate?: string; orderUom?: string; packLevel?: string; unitsPerOrderUnit?: number; supplierSkuId?: string; skuId?: string;
  /** Which section a line sits in on a split (PO / Bill) form. Absent = infer from itemId. */
  kind?: "item" | "account";
  // The price as entered, per a unit that may differ from the order unit
  // ("5 cartons at 2.00 per metre"). `rate` is derived from it — always per
  // ORDER unit, so qty × rate = amount everywhere downstream.
  priceLevel?: string; priceUom?: string; unitsPerPriceUnit?: number; priceInput?: string;
};

const emptyLine = (kind?: "item" | "account"): Line => ({ itemId: "", accountId: "", description: "", qty: "", rate: "", amount: "", taxRateId: "", classId: "", locationId: "", ...(kind ? { kind } : {}) });
const lineKind = (l: Line): "item" | "account" => l.kind ?? (l.itemId ? "item" : "account");
/**
 * Purchase Order and Bill split lines into ITEMS (ordered and priced in the
 * supplier's packaging from Products & Services) and ACCOUNTS (plain Chart of
 * Accounts amounts). Every other document keeps the single mixed table.
 */
const SPLIT_TYPES = new Set<DocType>(["PurchaseOrder", "Bill"]);
const fmtQty = (n: number) => fmt.qty(n);

/** A foldable section with a one-line summary, for the Items / Accounts split. */
function FoldSection({ title, hint, summary, open, onToggle, children }: { title: string; hint?: string; summary?: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-stone-800/80 bg-stone-900/40 overflow-hidden">
      <button type="button" onClick={onToggle} className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-stone-900/70 border-b border-stone-800/60">
        <ChevronRight size={14} className={`text-stone-500 transition-transform ${open ? "rotate-90" : ""}`} />
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-stone-300">{title}</span>
        {hint && <span className="text-[11px] text-stone-500">· {hint}</span>}
        {summary && <span className="ml-auto text-[12px] text-stone-500 tabular-nums">{summary}</span>}
      </button>
      {open && children}
    </div>
  );
}

/** How a supplier SKU is named in the picker: ours first, then theirs. */
const skuLabel = (s: any) => s.skuName || s.supplierProductName || s.supplierSku || [s.innerPackType, s.outerPackType].filter(Boolean).join(" / ") || "Default";

/** "1 carton = 12 roll = 600 m" — the SKU's packaging from Products & Services, read back. */
function packConfigText(link: any, baseUom: string): string {
  const per = perSupplierUnit(link.supplierUom || null, baseUom || null, link.conversionFactor) ?? 0;
  const inner = Number(link.innerUnitPackSize) || 0, outer = Number(link.unitsInOuterPack) || 0;
  const q = (n: number) => fmt.qty(n);
  if (inner > 0 && outer > 0 && link.innerPackType && link.outerPackType) {
    return `1 ${link.outerPackType} = ${q(outer)} ${link.innerPackType}${per ? ` = ${q(outer * inner * per)} ${baseUom}` : ""}`;
  }
  if (inner > 0 && link.innerPackType) return `1 ${link.innerPackType} = ${q(inner)} ${link.supplierUom || baseUom}${per && link.supplierUom !== baseUom ? ` = ${q(inner * per)} ${baseUom}` : ""}`;
  if (link.supplierUom && link.supplierUom !== baseUom && per) return `1 ${link.supplierUom} = ${q(per)} ${baseUom}`;
  return "";
}
/** A unit's short name for the Qty / Rate pickers: "m", "roll", "carton". */
const unitName = (o: OrderOption, baseU: string) => (o.packLevel === "base" ? (o.orderUom || baseU || "unit") : (o.orderUom || o.packLevel));
const todayStr = () => localToday();
const num = (s: string) => Number(s) || 0;
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function NewDocumentForm({ type, editId: editIdProp, readOnly, actions, afterContent }: {
  type: DocType;
  /** Open directly into edit-loading for this entry, bypassing the ?edit= URL
   *  param — used when this form is embedded (not navigated to) by another
   *  page, e.g. the transaction detail view's read-only rendering. */
  editId?: string;
  /** Render the SAME form every field was entered on, but inert — the exact
   *  QBO/QBD pattern of "opening a transaction shows its original form."
   *  Disables every control via one wrapping <fieldset disabled> rather than
   *  threading a flag through each input, and swaps the footer to a single
   *  Close button. */
  readOnly?: boolean;
  /** Extra buttons shown in the header next to Close (Download PDF / Print /
   *  Edit / Reverse / Delete) — kept out of this component so it stays
   *  unaware of ledger-specific actions; the caller owns those handlers. */
  actions?: ReactNode;
  /** Extra content shown below the form fields, inside the same scrollable
   *  body — e.g. a "Related transactions" panel. Rendered outside the
   *  disabled fieldset, so any links inside it stay clickable in readOnly
   *  mode. */
  afterContent?: ReactNode;
}) {
  const cfg = CFG[type];
  const router = useRouter();
  const [accounts, setAccounts] = useState<any[]>([]);
  const [items, setItems] = useState<any[]>([]);
  const [itemPacks, setItemPacks] = useState<Record<string, { baseUom: string | null; supplierSkus: any[]; skus: any[] }>>({});
  // Item links of the supplier this document is addressed to (purchase side
  // only). null = not loaded / no supplier picked yet.
  const [supplierLinks, setSupplierLinks] = useState<any[] | null>(null);
  // The escape hatch: show every item regardless of kind or supplier link.
  const [showAllItems, setShowAllItems] = useState(false);
  const [taxes, setTaxes] = useState<any[]>([]);
  // Native tax engine (Phase 3c/3d) — only populated for a native (non-synced)
  // org; empty array for a synced one, so the picker below simply shows no
  // "Tax codes" group and nothing changes for them. `taxComponents` is the
  // full component list (rate, sequence) so the live totals preview can
  // actually compute a native code's tax instead of showing zero.
  const [taxCodes, setTaxCodes] = useState<{ id: string; name: string; treatment: string; compound: boolean; components: { componentId: string; sequence: number }[] }[]>([]);
  const [taxComponents, setTaxComponents] = useState<{ id: string; rate: string }[]>([]);
  // Document-level pricing mode (Phase 3d) — whether line amounts already
  // include tax. Defaults to "exclusive", matching every document posted
  // before this existed; only changes behaviour when a user deliberately
  // switches it.
  const [pricing, setPricing] = useState<"exclusive" | "inclusive">("exclusive");
  const [dims, setDims] = useState<any[]>([]);
  const [parties, setParties] = useState<any[]>([]);
  const [home, setHome] = useState("");
  const [mcEnabled, setMcEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(todayStr());
  const [expiryDate, setExpiryDate] = useState("");
  const [termsKey, setTermsKey] = useState("net30");
  const [dueDate, setDueDate] = useState(addDays(todayStr(), 30));
  const [reference, setReference] = useState("");
  const [docNumber, setDocNumber] = useState("");
  const [memo, setMemo] = useState("");
  // Credit note / refund / vendor credit: did goods actually move? A credit can
  // be a price allowance with nothing returned, so stock moves only if ticked.
  const [goodsReturned, setGoodsReturned] = useState(false);
  const isReturnable = type === "CreditNote" || type === "RefundReceipt" || type === "VendorCredit";
  const [partyId, setPartyId] = useState("");
  // A project is a customer-grouping entity (projects.customerId is a
  // required FK), so the picker only makes sense for Customer-party,
  // postDocument-backed types (Invoice/SalesReceipt/CreditNote/RefundReceipt)
  // — trade_documents (Estimate/SalesOrder) has no project_id column at all,
  // so showing the field there would silently discard the selection. Rather
  // than a second field, a project is offered right inside the Customer
  // dropdown as an indented child option under its own customer (QBO's
  // Customer:Job shape) — one fewer field and one fewer click than a
  // separate Customer + Project pair, and there is never any ambiguity about
  // which customer a selected project belongs to.
  const supportsProject = cfg.party === "Customer" && !cfg.trade && cfg.mode === "lineItems";
  const [projectId, setProjectId] = useState("");
  const [allProjects, setAllProjects] = useState<any[]>([]);
  const projectsByCustomer = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const p of allProjects) (m[p.customerId] ??= []).push(p);
    return m;
  }, [allProjects]);
  const [bankAccountId, setBankAccountId] = useState("");
  const [toBankAccountId, setToBankAccountId] = useState("");
  const [amount, setAmount] = useState("");
  // The document's OWN control-account line (A/R, A/P or Bank/Asset) — ONE
  // line for the whole total, so ONE class/location, set here rather than
  // derived from the revenue/expense lines above it. Shown on every document
  // type (not just lineItems/deposit) since every type posts a control line.
  const [controlClassId, setControlClassId] = useState("");
  const [controlLocationId, setControlLocationId] = useState("");
  const [openDocs, setOpenDocs] = useState<any[] | null>(null);
  const [alloc, setAlloc] = useState<Record<string, string>>({});
  // Bill only — the "Add from purchase order or goods receipt" panel (QBO's
  // "Add to Bill"). null = not loaded / no supplier picked yet.
  const [billSuggestions, setBillSuggestions] = useState<{ purchaseOrders: any[]; goodsReceipts: any[] } | null>(null);
  const [addingSuggestion, setAddingSuggestion] = useState<string | null>(null);
  const [suggestionErr, setSuggestionErr] = useState("");
  // PurchaseOrder only — optional link to the Sales Order this purchase is
  // for, so it shows up on that order's Production Tracker.
  const [salesOrderId, setSalesOrderId] = useState("");
  const [openSalesOrders, setOpenSalesOrders] = useState<any[]>([]);
  const [credits, setCredits] = useState<any[] | null>(null);
  const [creditAlloc, setCreditAlloc] = useState<Record<string, string>>({});
  const [paymentMethod, setPaymentMethod] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [currency, setCurrency] = useState("");
  const [rate, setRate] = useState("1");
  const split = SPLIT_TYPES.has(type);
  const [lines, setLines] = useState<Line[]>(split ? [emptyLine("item")] : [emptyLine(), emptyLine()]);
  const [itemsOpen, setItemsOpen] = useState(true);
  const [acctsOpen, setAcctsOpen] = useState(false);
  const [availablePayments, setAvailablePayments] = useState<any[]>([]);
  const [sweptPaymentIds, setSweptPaymentIds] = useState<string[]>([]);

  const [posting, setPosting] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState<{ docNumber?: string; txnNo?: number } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  // Inline "+ Add new" from a dropdown → quick-create drawer.
  // "customer"/"supplier"/"item" are NOT QuickAddKind values — they open the
  // real PartyDrawer/NewItemDrawer directly (see the render block below),
  // never the generic QuickAdd component. QuickAddKind covers only the kinds
  // with no richer standalone drawer elsewhere (accounts, tax, class, location).
  type AddKind = QuickAddKind | "customer" | "supplier" | "item";
  const [quickAdd, setQuickAdd] = useState<{ kind: AddKind; lineIndex?: number; field?: "bank" | "toBank" } | null>(null);

  // Reopen-to-edit: /accounting/new/<Type>?edit=<entryId> loads the stored form
  // payload and switches Save to an in-place update.
  useEffect(() => {
    const eid = editIdProp ?? (typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("edit"));
    if (!eid) return;
    setEditId(eid);
    fetch(`/api/documents/${type}/${eid}`).then(r => r.json()).then(d => {
      const p = d?.payload; if (!p) return;
      setDate(p.date ?? todayStr());
      setDocNumber(p.docNumber ?? "");
      setMemo(p.memo ?? "");
      setGoodsReturned(!!p.goodsReturned);
      setPartyId(p.partyId ?? "");
      setProjectId(p.projectId ?? "");
      setControlClassId(p.controlClassId ?? "");
      setControlLocationId(p.controlLocationId ?? "");
      setBankAccountId(p.bankAccountId ?? "");
      if (p.currency) setCurrency(p.currency);
      if (p.exchangeRate) setRate(String(p.exchangeRate));
      if (p.dueDate) { setDueDate(p.dueDate); setTermsKey("custom"); }
      setReference(p.reference ?? "");
      if (cfg.mode === "payment") {
        // Payment edit: reallocate / correct amount. Load the party's open items
        // and credits AS IF this payment weren't applied (excludeContext), then
        // prefill the current allocations so they can be adjusted.
        setAmount(p.amount != null ? String(p.amount) : "");
        setAmountTouched(true);
        if (p.paymentMethod) setPaymentMethod(p.paymentMethod);
        const a: Record<string, string> = {}; (p.allocations || []).forEach((x: any) => { a[x.targetId] = String(x.amount); }); setAlloc(a);
        const ca: Record<string, string> = {}; (p.creditApplications || []).forEach((x: any) => { ca[x.sourceId] = String(x.amount); }); setCreditAlloc(ca);
        const sideq = cfg.party === "Vendor" ? "vendor" : "customer";
        if (p.partyId) {
          fetch(`/api/transactions/open?side=${sideq}&partyId=${p.partyId}&excludeContext=${eid}`).then(r => r.json()).then(x => setOpenDocs(Array.isArray(x) ? x : [])).catch(() => setOpenDocs([]));
          fetch(`/api/transactions/credits?side=${sideq}&partyId=${p.partyId}&excludeContext=${eid}`).then(r => r.json()).then(x => setCredits(Array.isArray(x) ? x : [])).catch(() => setCredits([]));
        }
      } else if (Array.isArray(p.lines) && p.lines.length) {
        setLines(p.lines.map((l: any) => ({
          itemId: l.itemId ?? "", accountId: l.accountId ?? "", accountOverride: !!l.accountOverride, description: l.description ?? "",
          qty: l.qty != null ? String(l.qty) : "", rate: l.rate != null ? String(l.rate) : "",
          amount: l.amount != null ? String(l.amount) : "", taxRateId: l.taxRateId ?? "", classId: l.classId ?? "", locationId: l.locationId ?? "",
          lotNo: l.lotNo ?? undefined, expiryDate: l.expiryDate ?? undefined,
          // The order unit MUST come back with the line: without it, a
          // reopened "5 cartons" would re-post as 5 base units.
          orderUom: l.orderUom ?? undefined, packLevel: l.packLevel ?? undefined,
          unitsPerOrderUnit: l.unitsPerOrderUnit != null ? Number(l.unitsPerOrderUnit) : undefined,
          supplierSkuId: l.supplierSkuId ?? undefined,
          priceLevel: l.priceLevel ?? undefined, priceUom: l.priceUom ?? undefined,
          unitsPerPriceUnit: l.unitsPerPriceUnit != null ? Number(l.unitsPerPriceUnit) : undefined,
          priceInput: l.priceInput != null ? String(l.priceInput) : (l.rate != null ? String(l.rate) : undefined),
          kind: l.itemId ? "item" : "account",
        })));
        if (p.lines.some((l: any) => !l.itemId)) setAcctsOpen(true);
      }
    }).catch(() => {});
  }, [type, editIdProp]);

  useEffect(() => {
    if (cfg.mode !== "deposit") return;
    fetch("/api/documents/payments/available-for-deposit").then(r => r.json())
      .then(d => setAvailablePayments(Array.isArray(d?.payments) ? d.payments : [])).catch(() => setAvailablePayments([]));
  }, [cfg.mode]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const partyUrl = cfg.party === "Vendor" ? "/api/parties/suppliers?native=1" : "/api/parties/customers?native=1";
        const [a, i, t, dm, p, num, so, taxSetup, proj] = await Promise.all([
          fetch("/api/accounting/accounts").then(r => r.json()).catch(() => []),
          fetch("/api/accounting/items").then(r => r.json()).catch(() => []),
          fetch("/api/accounting/tax-rates").then(r => r.json()).catch(() => []),
          fetch("/api/accounting/dimensions").then(r => r.json()).catch(() => []),
          cfg.party ? fetch(partyUrl).then(r => r.json()).catch(() => []) : Promise.resolve([]),
          fetch(`/api/numbering?peek=${type}`).then(r => r.json()).catch(() => null),
          type === "PurchaseOrder" ? fetch("/api/trade-documents/sales-orders").then(r => r.json()).catch(() => []) : Promise.resolve([]),
          cfg.tax ? fetch("/api/accounting/tax-codes").then(r => (r.ok ? r.json() : null)).catch(() => null) : Promise.resolve(null),
          // Every project for the org, fetched once — cheap enough even at
          // thousands of rows (name + customerId only matter here) and lets
          // the whole Customer:Project tree render without a round trip per
          // customer selected. Vendor-side forms never need it.
          supportsProject ? fetch("/api/projects").then(r => r.json()).catch(() => []) : Promise.resolve([]),
        ]);
        setAccounts(Array.isArray(a) ? a.filter((x: any) => x.status !== "Inactive") : []);
        setItems(Array.isArray(i) ? i.filter((x: any) => x.status !== "Inactive") : []);
        setTaxes(Array.isArray(t) ? t.filter((x: any) => x.status !== "Inactive") : []);
        // Synced org → taxSetup.synced is true → no native tax codes offered;
        // same rule the admin screen itself uses (components/tax-codes.tsx).
        setTaxCodes(taxSetup && !taxSetup.synced && Array.isArray(taxSetup.codes) ? taxSetup.codes.filter((c: any) => c.status !== "Inactive") : []);
        setTaxComponents(taxSetup && Array.isArray(taxSetup.components) ? taxSetup.components : []);
        setDims(Array.isArray(dm) ? dm.filter((x: any) => x.status !== "Inactive") : []);
        setParties(Array.isArray(p) ? p : []);
        setAllProjects(Array.isArray(proj) ? proj.filter((x: any) => x.status !== "Inactive") : []);
        setOpenSalesOrders(Array.isArray(so) ? so.filter((x: any) => x.status !== "Closed") : []);
        const editing = typeof window !== "undefined" && new URLSearchParams(window.location.search).get("edit");
        if (num?.docNumber && !editing) setDocNumber(num.docNumber);
        fetch("/api/org/settings").then(r => r.json()).then(o => {
          const h = o?.currency || ""; setHome(h); setMcEnabled(!!o?.multicurrencyEnabled);
          setCurrency(c => c || h);
        }).catch(() => {});
      } finally { setLoading(false); }
    })();
    // eslint-disable-next-line
  }, [type]);

  // Purchasing is scoped to the supplier the document is addressed to. Its item
  // links drive BOTH which items the picker offers and which pack configurations
  // each line may order by — fetched once per supplier rather than per item, so
  // no other supplier's configuration is ever in hand to be offered by mistake.
  useEffect(() => {
    if (cfg.side !== "purchase" || !partyId) { setSupplierLinks(null); return; }
    let live = true;
    fetch(`/api/inventory/supplier-skus?supplierId=${encodeURIComponent(partyId)}`)
      .then(r => r.json())
      .then(d => { if (live) setSupplierLinks(Array.isArray(d) ? d : []); })
      .catch(() => { if (live) setSupplierLinks([]); });
    return () => { live = false; };
  }, [partyId, cfg.side]);

  // Keep due date in sync with terms + issue date (unless Custom).
  function applyTerms(key: string, baseDate: string) {
    setTermsKey(key);
    const t = TERMS.find(x => x.key === key);
    if (t && t.days != null) setDueDate(addDays(baseDate, t.days));
  }
  const classes = useMemo(() => dims.filter(d => d.dimensionType === "Class"), [dims]);
  const locations = useMemo(() => dims.filter(d => d.dimensionType === "Location"), [dims]);
  // Deposit ("Sources") shares this exact same line table — a bank deposit's
  // source lines are just as classifiable in QBO as any other account line —
  // so it belongs here alongside lineItems mode, not excluded by it.
  const showDims = (cfg.mode === "lineItems" || cfg.mode === "deposit") && (classes.length > 0 || locations.length > 0);
  // The control-account picker (above) is independent of mode — a Payment or
  // Transfer has no revenue/expense lines at all, but it still posts a
  // control-account line that can be classified.
  const showHeaderDims = classes.length > 0 || locations.length > 0;

  // Account partitions
  const isControl = (a: any) => a.type === "Accounts Receivable" || a.type === "Accounts Payable" || a.subtype === "SalesTaxPayable";
  const banks = useMemo(() => accounts.filter(a => a.type === "Bank" || a.type === "Credit Card"), [accounts]);
  const lineAccounts = useMemo(() => {
    if (cfg.side === "sales") {
      const inc = accounts.filter(a => a.classification === "Revenue" || a.type === "Income" || a.type === "Other Income");
      return inc.length ? inc : accounts.filter(a => !isControl(a) && a.type !== "Bank");
    }
    if (cfg.side === "purchase") {
      const exp = accounts.filter(a => a.classification === "Expense" || ["Expense", "Cost of Goods Sold", "Other Expense", "Fixed Asset", "Other Current Asset", "Other Asset"].includes(a.type));
      return exp.length ? exp : accounts.filter(a => !isControl(a) && a.type !== "Bank");
    }
    // deposit: any non-control, non-bank source (income/other)
    return accounts.filter(a => !isControl(a));
  }, [accounts, cfg.side]);

  // `projectForId`, when given, is the project the combined Customer:Project
  // dropdown resolved `id` to (the option the user actually picked was the
  // project's own, indented, entry) — set directly instead of the usual
  // "switching customer clears the project" reset below, so picking a
  // project in one action lands on both the right customer AND the right
  // project, never a customer with the project silently dropped a tick later.
  function onParty(id: string, projectForId?: string) {
    if (id === "__add__") { setQuickAdd({ kind: cfg.party === "Vendor" ? "supplier" : "customer" }); return; }
    // Every pack choice on the document describes the OUTGOING supplier's
    // packaging, so switching supplier invalidates all of them. Drop back to
    // base UoM rather than carry a foreign conversion factor into the order.
    // Done here rather than in the fetch effect so that loading a saved
    // document (which sets partyId once, from its own data) keeps its lines.
    if (cfg.side === "purchase" && id !== partyId) {
      setLines(ls => ls.map(l => {
        if (!l.supplierSkuId) return l;
        const baseU = items.find(x => x.id === l.itemId)?.baseUom || "";
        // The entered price was per the old supplier's unit; restate it per
        // base unit so the line keeps the same money, not the same number.
        const p = Number(l.priceInput), uppu = l.unitsPerPriceUnit || 1;
        return { ...l, supplierSkuId: "", packLevel: "base", unitsPerOrderUnit: 1, orderUom: baseU,
          priceLevel: "base", priceUom: baseU, unitsPerPriceUnit: 1,
          priceInput: l.priceInput && isFinite(p) ? String(Math.round((p / uppu) * 1e6) / 1e6) : l.priceInput };
      }));
    }
    setPartyId(id);
    // A project belongs to exactly one customer — switching customer always
    // drops any previously-picked project rather than leaving a selection
    // from a DIFFERENT customer silently attached to this document, UNLESS
    // the caller already resolved a specific project for this exact customer
    // (picking a project's own option in the combined dropdown).
    if (supportsProject) setProjectId(projectForId ?? "");
    if (mcEnabled) {
      const p = parties.find(x => x.id === id);
      // A party with a currency already set is LOCKED to it — the field below
      // renders read-only in that case, so this is the only place it changes.
      // A party with none yet just gets the home currency as an editable
      // starting point; posting a transaction in a different currency is what
      // actually assigns the party's currency (server-side, see documents.ts).
      const c = (p?.currency || home);
      setCurrency(c);
      if (c === home) setRate("1");
    }
    if (cfg.mode === "payment" && id) {
      setOpenDocs(null); setAlloc({}); setCredits(null); setCreditAlloc({});
      const side = cfg.party === "Vendor" ? "vendor" : "customer";
      fetch(`/api/transactions/open?side=${side}&partyId=${id}`).then(r => r.json())
        .then(d => setOpenDocs(Array.isArray(d) ? d : [])).catch(() => setOpenDocs([]));
      fetch(`/api/transactions/credits?side=${side}&partyId=${id}`).then(r => r.json())
        .then(d => setCredits(Array.isArray(d) ? d : [])).catch(() => setCredits([]));
    } else { setOpenDocs(null); setAlloc({}); setCredits(null); setCreditAlloc({}); }
    if (type === "Bill" && id) {
      setBillSuggestions(null); setSuggestionErr("");
      fetch(`/api/accounting/bill-suggestions?supplierId=${id}`).then(r => r.json())
        .then(d => setBillSuggestions(d && typeof d === "object" && !Array.isArray(d) ? d : { purchaseOrders: [], goodsReceipts: [] }))
        .catch(() => setBillSuggestions({ purchaseOrders: [], goodsReceipts: [] }));
    } else if (type === "Bill") {
      setBillSuggestions(null);
    }
  }
  // "Add" on a suggested Purchase Order — converts its billable (non-stocked)
  // open lines into a Bill right away, through the same convertTradeDoc path
  // the PO's own "Convert to Bill" button uses. This creates its OWN bill from
  // the PO's own supplier/currency/lines, not from whatever is typed into the
  // current draft — the panel's own hint says so.
  async function addPoToBill(po: any) {
    setAddingSuggestion(po.id); setSuggestionErr("");
    try {
      const r = await fetch(`/api/trade-documents/PurchaseOrder/${po.id}/convert`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lines: po.lines }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Could not create a bill from this purchase order.");
      setDone({ docNumber: d.docNumber, txnNo: d.txnNo });
    } catch (e: any) {
      setSuggestionErr(e?.message || "Could not create a bill from this purchase order.");
    } finally {
      setAddingSuggestion(null);
    }
  }
  // "Add" on a suggested Goods Receipt — bills its unbilled remainder through
  // billFromReceipts (Dr GR/IR / Cr Accounts Payable), the same path the
  // Receiving console's own "Bill" action uses. Kept separate from the Items
  // table above: a receipt's lines post to GR/IR clearing, not an expense/item
  // account, so it cannot share the generic Bill line shape.
  async function addReceiptToBill(gr: any) {
    setAddingSuggestion(gr.id); setSuggestionErr("");
    try {
      const r = await fetch(`/api/inventory/receiving/bill`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ receiptIds: [gr.id], billDate: date }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d?.error || "Could not create a bill from this receipt.");
      setDone({ docNumber: d.docNumber, txnNo: d.txnNo });
    } catch (e: any) {
      setSuggestionErr(e?.message || "Could not create a bill from this receipt.");
    } finally {
      setAddingSuggestion(null);
    }
  }
  // The combined Customer:Project dropdown's onChange — a `project:<id>`
  // value resolves to its OWN customer before calling onParty, so a project
  // can be picked in one action without first hand-picking its parent
  // customer (that's the "understood — who's the parent" the client meant).
  const PROJECT_PREFIX = "project:";
  function onPartyOrProject(raw: string) {
    if (!raw.startsWith(PROJECT_PREFIX)) { onParty(raw); return; }
    const projectId_ = raw.slice(PROJECT_PREFIX.length);
    const proj = allProjects.find(p => p.id === projectId_);
    if (!proj) return; // stale option (shouldn't happen — list and selection come from the same state)
    onParty(proj.customerId, proj.id);
  }
  const sumVals = (o: Record<string, string>) => Math.round(Object.values(o).reduce((s, v) => s + num(v), 0) * 100) / 100;
  const allocApplied = sumVals(alloc);
  const creditApplied = sumVals(creditAlloc);
  const customerBalance = Math.round((openDocs ?? []).reduce((s, d) => s + d.openFx, 0) * 100) / 100;
  const availableCredit = Math.round((credits ?? []).reduce((s, d) => s + d.open, 0) * 100) / 100;
  const allSelected = !!openDocs && openDocs.length > 0 && openDocs.every(d => num(alloc[d.id]) > 0);
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Keep "Amount received" (cash) synced to invoices − credits, unless the user
  // typed their own figure. Cash needed = what's applied minus credits used.
  function syncCash(invSum: number, credSum: number) {
    if (amountTouched) return;
    const cash = round2(invSum - credSum);
    setAmount(cash > 0 ? String(cash) : "");
  }
  function setAllocSynced(next: Record<string, string>) { setAlloc(next); syncCash(sumVals(next), creditApplied); }
  function setCreditSynced(next: Record<string, string>) { setCreditAlloc(next); syncCash(allocApplied, sumVals(next)); }
  function toggleRow(d: any) { setAllocSynced({ ...alloc, [d.id]: num(alloc[d.id]) > 0 ? "" : String(d.openFx) }); }
  function toggleAll() { const next: Record<string, string> = {}; for (const d of openDocs ?? []) next[d.id] = allSelected ? "" : String(d.openFx); setAllocSynced(next); }
  function toggleCredit(c: any) {
    if (num(creditAlloc[c.id]) > 0) { setCreditSynced({ ...creditAlloc, [c.id]: "" }); return; }
    // Fill only up to what's still being settled after other credits — never
    // apply more credit than the invoices being paid.
    const remainingToSettle = round2(allocApplied - creditApplied);
    const fill = round2(Math.min(c.open, Math.max(0, remainingToSettle)));
    setCreditSynced({ ...creditAlloc, [c.id]: fill > 0 ? String(fill) : "" });
  }
  function clearPayment() { setAmountTouched(false); setAlloc({}); setCreditAlloc({}); setAmount(""); }

  const foreign = mcEnabled && currency !== "" && currency !== home;
  // Once a party has a currency, every transaction for them is locked to it
  // (matches QBO — a customer/supplier's currency is set once, from its first
  // transaction, and can't be overridden document-by-document after that).
  const selectedParty = useMemo(() => parties.find(p => p.id === partyId), [parties, partyId]);

  /**
   * What the line picker offers. Two narrowings, both escapable:
   *  - kind — a purchase document offers buyable items, a sales document
   *    sellable ones. item-kinds.ts already declares both; nothing read them.
   *  - supplier — on a purchase document, the items this supplier is linked to.
   * Neither is a safety property: selling off scrap raw material and one-off
   * buys are both real. A picker that silently hides the item leaves no way to
   * discover why, so "Show all items" is always one click away.
   */
  const visibleItems = useMemo(() => {
    if (showAllItems || !cfg.side) return items;
    const wantsBuy = cfg.side === "purchase";
    let list = items.filter(it => (wantsBuy ? kindOf(it.productType).buyable : kindOf(it.productType).sellable));
    if (wantsBuy && supplierLinks) {
      // An "any supplier" item belongs in every supplier's list by definition —
      // hiding it would make the escape hatch useless exactly where it is meant
      // to be used.
      const linked = new Set(supplierLinks.map((l: any) => l.itemId));
      list = list.filter(it => linked.has(it.id) || allowsAnySupplier(it.sourcingPolicy));
    }
    return list;
  }, [items, showAllItems, cfg.side, supplierLinks]);
  const hiddenItemCount = items.length - visibleItems.length;
  const partyLockedCurrency: string | null = mcEnabled && selectedParty?.currency ? selectedParty.currency : null;

  // A Bank/Credit Card account can carry its own currency (Chart of Accounts
  // setting) purely as a default — picking it pre-fills the transaction
  // currency, but never overrides an already-locked party currency.
  function onBankAccount(id: string) {
    setBankAccountId(id);
    if (mcEnabled && !partyLockedCurrency) {
      const acct = accounts.find(a => a.id === id);
      if (acct?.currency) { setCurrency(acct.currency); if (acct.currency === home) setRate("1"); }
    }
  }

  function setLine(i: number, patch: Partial<Line>) {
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  }
  // The account an item posts through. Mirrors the authoritative rule in
  // lib/accounting/documents.ts (accountFor) — the server derives this from the
  // item and ignores whatever account we send, so the form must show the same
  // answer rather than letting the user pick a different one.
  function itemAccountId(it: any): string {
    if (!it) return "";
    if (cfg.side === "purchase") {
      return (isTracked(it.productType) ? it.assetAccountId : it.expenseAccountId) || "";
    }
    return it.incomeAccountId || "";
  }
  /**
   * A supplier quotes in THEIR currency. Defaulting that figure onto a document
   * denominated in another one would silently misstate the line, so the price
   * only applies when the two agree — otherwise the buyer enters the converted
   * figure themselves and knows they did.
   */
  function supplierRate(opt: OrderOption | null | undefined): number | null {
    if (!opt || opt.unitPrice == null) return null;
    return (opt.currency || home) === (currency || home) ? opt.unitPrice : null;
  }
  /** This supplier's own pack/price choices for one item, or [] if none. */
  function optionsFor(it: any): OrderOption[] {
    return orderOptions(it?.baseUom ?? null, (supplierLinks ?? []).filter((s: any) => s.itemId === it?.id), partyId);
  }

  // ── Split-form (PO / Bill) item lines ─────────────────────────────────────
  /** This supplier's SKUs (links) for one item. */
  function linksFor(itemId: string): any[] { return (supplierLinks ?? []).filter((s: any) => s.itemId === itemId); }
  /** The units a line can be ordered or priced in: the base unit plus the chosen SKU's levels. */
  function unitOpts(l: Line): OrderOption[] {
    const it = items.find(x => x.id === l.itemId);
    const link = l.supplierSkuId ? linksFor(l.itemId).find((x: any) => x.id === l.supplierSkuId) : null;
    return orderOptions(it?.baseUom ?? null, link ? [link] : [], partyId);
  }
  /**
   * Re-derive a split line's rate and amount from what the buyer entered.
   * rate = price converted from the PRICE unit to the ORDER unit (both via the
   * base unit), amount = qty × rate. Computed from the entered price directly
   * rather than from a rounded rate, so "5 cartons at 2.00/m" is exactly 6,000.
   */
  function recalc(i: number, patch: Partial<Line>) {
    setLines(ls => ls.map((l, idx) => {
      if (idx !== i) return l;
      const m = { ...l, ...patch };
      const upo = m.unitsPerOrderUnit || 1, uppu = m.unitsPerPriceUnit || upo;
      const p = Number(m.priceInput);
      if (m.priceInput != null && m.priceInput !== "" && isFinite(p)) {
        const r = ratePerOrderUnit(p, upo, uppu);
        m.rate = String(Math.round(r * 1e6) / 1e6);
        const q = num(m.qty);
        m.amount = q ? String(Math.round(q * p * upo / uppu * 100) / 100) : "";
      } else { m.rate = ""; m.amount = ""; }
      return m;
    }));
  }
  /**
   * Put a supplier SKU on a line: order and price in the level the supplier
   * QUOTES in (a price captured "per bottle" opens as "per bottle"), with that
   * price filled in. No SKU → the item's base unit and its purchase cost.
   */
  function setLineSku(i: number, it: any, linkId: string | null) {
    const link = linkId ? linksFor(it.id).find((x: any) => x.id === linkId) ?? null : null;
    const opts = orderOptions(it.baseUom ?? null, link ? [link] : [], partyId);
    const unitLevel = !link ? "base"
      : link.priceBasis === "inner" ? "inner" : link.priceBasis === "outer" ? "outer"
      : (opts.some(o => o.packLevel === "supplier") ? "supplier" : "base");
    const o = opts.find(x => x.packLevel === unitLevel) ?? opts[0];
    const quoted = supplierRate(o);
    const fallback = !link && it.unitCost != null && it.unitCost !== "" ? Number(it.unitCost) : null;
    const price = quoted ?? fallback;
    recalc(i, {
      supplierSkuId: link?.id ?? "", orderUom: o.orderUom, packLevel: o.packLevel, unitsPerOrderUnit: o.unitsPerOrderUnit,
      priceLevel: o.packLevel, priceUom: o.orderUom, unitsPerPriceUnit: o.unitsPerOrderUnit,
      priceInput: price != null && isFinite(price) ? String(Math.round(price * 1e6) / 1e6) : "",
    });
  }
  function onSku(i: number, linkId: string) {
    const it = items.find(x => x.id === lines[i].itemId);
    if (it) setLineSku(i, it, linkId || null);
  }
  function onQtyUnit(i: number, level: string) {
    const o = unitOpts(lines[i]).find(x => x.packLevel === level);
    if (o) recalc(i, { orderUom: o.orderUom, packLevel: o.packLevel, unitsPerOrderUnit: o.unitsPerOrderUnit });
  }
  /** Changing what the price is PER restates it in the new unit — the same money. */
  function onPriceUnit(i: number, level: string) {
    const l = lines[i];
    const o = unitOpts(l).find(x => x.packLevel === level);
    if (!o) return;
    const p = Number(l.priceInput), old = l.unitsPerPriceUnit || l.unitsPerOrderUnit || 1;
    const next = l.priceInput && isFinite(p) ? String(Math.round(p * o.unitsPerOrderUnit / old * 1e6) / 1e6) : l.priceInput;
    recalc(i, { priceLevel: o.packLevel, priceUom: o.orderUom, unitsPerPriceUnit: o.unitsPerOrderUnit, priceInput: next });
  }

  function applyItem(i: number, it: any) {
    if (split) {
      const acct = itemAccountId(it);
      setLine(i, { itemId: it.id, kind: "item", accountId: acct || lines[i].accountId, taxRateId: (cfg.side === "purchase" ? (it.purchaseTaxRateId || it.taxRateId) : it.taxRateId) || lines[i].taxRateId, description: it.name || lines[i].description, lotNo: "" });
      // The supplier's preferred SKU for this item, else their first.
      const ls = linksFor(it.id);
      setLineSku(i, it, (ls.find((x: any) => x.isPreferred) ?? ls[0])?.id ?? null);
      if (it.lotTracked && !isFPWIP(it) && !cfg.trade) {
        fetch(`/api/inventory/lot-suggestion`).then(r => r.json()).then(s => { if (s?.code) setLine(i, { lotNo: s.code }); }).catch(() => {});
      }
      return;
    }
    const acct = itemAccountId(it);
    // What this supplier charges beats the item-level unit cost, which is one
    // figure shared across every vendor and so cannot be right for more than
    // one of them. Falls back to it when the link carries no price.
    const quoted = cfg.side === "purchase" ? supplierRate(optionsFor(it)[0]) : null;
    const rate = quoted ?? (cfg.side === "purchase" ? (it.unitCost ?? "") : (it.unitPrice ?? ""));
    setLine(i, { itemId: it.id, accountId: acct || lines[i].accountId, rate: rate === null ? "" : String(rate ?? ""), taxRateId: (cfg.side === "purchase" ? (it.purchaseTaxRateId || it.taxRateId) : it.taxRateId) || lines[i].taxRateId, description: it.name || lines[i].description, orderUom: it.baseUom || "", packLevel: "base", unitsPerOrderUnit: 1, supplierSkuId: "", lotNo: "" });
    recompute(i, { rate: String(rate ?? "") });
    // Pre-fill a suggested lot code for Stock Item / Raw Material purchases —
    // FP/WIP items never get an editable suggestion (see isFPWIP above).
    if (cfg.side === "purchase" && it.lotTracked && !isFPWIP(it)) {
      fetch(`/api/inventory/lot-suggestion`).then(r => r.json()).then(s => { if (s?.code) setLine(i, { lotNo: s.code }); }).catch(() => {});
    }
  }
  // On a purchase order, load the item's packaging so the line can be ordered
  // by base / supplier UoM / inner / outer pack.
  async function loadPacks(itemId: string) {
    if (itemPacks[itemId]) return;
    const d = await fetch(`/api/inventory/items/${itemId}`).then(r => r.json()).catch(() => null);
    if (d?.item) setItemPacks(p => ({ ...p, [itemId]: { baseUom: d.item.baseUom ?? null, supplierSkus: d.supplierSkus ?? [], skus: d.skus ?? [] } }));
  }
  function onItem(i: number, itemId: string) {
    if (itemId === "__add__") { setQuickAdd({ kind: "item", lineIndex: i }); return; }
    const it = items.find(x => x.id === itemId);
    if (!it) { setLine(i, { itemId: "" }); return; }
    applyItem(i, it);
    if (cfg.trade === "purchase-orders" || cfg.trade === "sales-orders") loadPacks(itemId);
  }

  // Native tax engine (Phase 3c) — one combined picker offering both the
  // legacy flat apTaxRates list and native tax_codes, prefixed so a single
  // <select> value disambiguates them. Picking either clears the other field,
  // so a line is never ambiguous between the two (lib/accounting/documents.ts's
  // withTax() treats taxCodeId as authoritative when both are somehow set).
  const taxSelectValue = (l: Line) => (l.taxCodeId ? `code:${l.taxCodeId}` : l.taxRateId ? `rate:${l.taxRateId}` : "");
  function onTaxChange(i: number, raw: string) {
    if (raw === ADD) { setQuickAdd({ kind: "tax", lineIndex: i }); return; }
    if (raw.startsWith("code:")) { setLine(i, { taxCodeId: raw.slice(5), taxRateId: "" }); return; }
    if (raw.startsWith("rate:")) { setLine(i, { taxRateId: raw.slice(5), taxCodeId: "" }); return; }
    setLine(i, { taxRateId: "", taxCodeId: "" });
  }
  function onOrderLevel(i: number, opt: OrderOption) {
    // On a sales order the pack option is a finished-product SKU (item_skus) —
    // that IS the stock SKU. On a purchase order it's a supplier SKU (ordering
    // communication only); SI stock stays base UoM (skuId null).
    const stockSkuId = cfg.side === "sales" ? (opt.supplierSkuId ?? "") : "";
    setLine(i, { orderUom: opt.orderUom, packLevel: opt.packLevel, unitsPerOrderUnit: opt.unitsPerOrderUnit, supplierSkuId: opt.supplierSkuId ?? "", skuId: stockSkuId });
    // The rate is per ORDER unit, so switching from kg to a 25kg bag must
    // reprice the line or the order reads as 25kg bought at the price of one.
    const quoted = supplierRate(opt);
    if (quoted != null) { setLine(i, { rate: String(quoted) }); recompute(i, { rate: String(quoted) }); }
  }

  // Resolve a completed quick-add into the right list + selection.
  function onQuickCreated(row: any) {
    const q = quickAdd; if (!q) return;
    if (q.kind === "customer" || q.kind === "supplier") {
      setParties(p => [row, ...p]); setPartyId(row.id);
      if (supportsProject) setProjectId(""); // same rule onParty follows — a brand-new customer has no projects yet
      if (mcEnabled) { const c = row.currency || home; setCurrency(c); if (c === home) setRate("1"); }
      if (cfg.mode === "payment") {
        const sideq = cfg.party === "Vendor" ? "vendor" : "customer";
        fetch(`/api/transactions/open?side=${sideq}&partyId=${row.id}`).then(r => r.json()).then(d => setOpenDocs(Array.isArray(d) ? d : [])).catch(() => setOpenDocs([]));
        fetch(`/api/transactions/credits?side=${sideq}&partyId=${row.id}`).then(r => r.json()).then(d => setCredits(Array.isArray(d) ? d : [])).catch(() => setCredits([]));
      }
    } else if (q.kind === "item") {
      setItems(i => [row, ...i]); if (q.lineIndex != null) applyItem(q.lineIndex, row);
    } else if (q.kind.startsWith("account")) {
      setAccounts(a => [row, ...a]);
      if (q.field === "bank") setBankAccountId(row.id);
      else if (q.field === "toBank") setToBankAccountId(row.id);
      else if (q.lineIndex != null) setLine(q.lineIndex, { accountId: row.id });
    } else if (q.kind === "tax") {
      setTaxes(t => [row, ...t]); if (q.lineIndex != null) setLine(q.lineIndex, { taxRateId: row.id });
    } else if (q.kind === "class") {
      setDims(d => [row, ...d]);
      if (q.lineIndex != null) setLine(q.lineIndex, { classId: row.id });
      else setControlClassId(row.id); // header "+ Add new class…" (the control-account picker)
    } else if (q.kind === "location") {
      setDims(d => [row, ...d]);
      if (q.lineIndex != null) setLine(q.lineIndex, { locationId: row.id });
      else setControlLocationId(row.id); // header "+ Add new location…"
    }
    setQuickAdd(null);
  }
  const ADD = "__add__";
  function recompute(i: number, patch: Partial<Line>) {
    setLines(ls => ls.map((l, idx) => {
      if (idx !== i) return l;
      const merged = { ...l, ...patch };
      const q = num(merged.qty), r = num(merged.rate);
      if (q && r) merged.amount = (Math.round(q * r * 100) / 100).toString();
      return merged;
    }));
  }

  const taxPct = (id: string) => Number(taxes.find(t => t.id === id)?.rate) || 0;
  // Native tax codes, resolved into the shape calcLineTax expects — a client-
  // side approximation of lib/accounting/tax-engine-server.ts's resolveTaxCodes:
  // it ignores a component's effective-dating (always "current", since this is
  // a document being composed today) and account ids (not needed for a total
  // preview). The server remains authoritative at post time; this is only for
  // an accurate running total while composing.
  const taxCodeRates = useMemo(() => {
    const componentById = new Map(taxComponents.map(c => [c.id, c]));
    const out = new Map<string, TaxCodeRates>();
    for (const code of taxCodes) {
      out.set(code.id, {
        id: code.id, name: code.name, treatment: (code.treatment as any) ?? "standard", compound: code.compound,
        components: code.components.map(l => {
          const c = componentById.get(l.componentId);
          return { componentId: l.componentId, name: c ? (c as any).name ?? "" : "", rate: c ? Number(c.rate) : 0, sequence: l.sequence, salesAccountId: null, purchaseAccountId: null };
        }),
      });
    }
    return out;
  }, [taxCodes, taxComponents]);
  // One line's tax, honouring taxCodeId (native) over taxRateId (legacy flat)
  // and the document's inclusive/exclusive pricing toggle — the exact same
  // precedence and math lib/accounting/documents.ts's withTax() applies.
  const lineTax = (l: Line) => {
    if (l.taxCodeId) return calcLineTax(num(l.amount), pricing, taxCodeRates.get(l.taxCodeId) ?? null, cfg.side === "sales").taxTotal;
    const pct = taxPct(l.taxRateId);
    if (!pct) return 0;
    const amt = num(l.amount);
    return pricing === "inclusive" ? Math.round((amt - amt / (1 + pct / 100)) * 100) / 100 : Math.round(amt * pct / 100) / 1;
  };
  const totals = useMemo(() => {
    if (cfg.mode === "lineItems") {
      const gross = lines.reduce((s, l) => s + num(l.amount), 0);
      const tax = lines.reduce((s, l) => s + lineTax(l), 0);
      const net = pricing === "inclusive" ? gross - tax : gross;
      return { net: Math.round(net * 100) / 100, tax: Math.round(tax * 100) / 100, total: Math.round((pricing === "inclusive" ? gross : net + tax) * 100) / 100 };
    }
    if (cfg.mode === "deposit") {
      const net = lines.reduce((s, l) => s + num(l.amount), 0);
      return { net: Math.round(net * 100) / 100, tax: 0, total: Math.round(net * 100) / 100 };
    }
    const a = num(amount);
    return { net: a, tax: 0, total: a };
  }, [lines, amount, cfg.mode, taxes, pricing, taxCodeRates]);

  async function submit() {
    setPosting(true); setErr("");
    try {
      const party = parties.find(p => p.id === partyId);
      const payload: any = { date, docNumber: docNumber.trim() || undefined, memo: memo.trim() || undefined };
      if (isReturnable) payload.goodsReturned = goodsReturned;
      if (foreign) { payload.currency = currency; payload.exchangeRate = num(rate); }
      if (cfg.party) { payload.partyType = cfg.party; payload.partyId = partyId || undefined; payload.partyLabel = party?.name || undefined; }
      if (supportsProject) payload.projectId = projectId || undefined;
      if (showHeaderDims) { payload.controlClassId = controlClassId || undefined; payload.controlLocationId = controlLocationId || undefined; }
      if (cfg.bank) payload.bankAccountId = bankAccountId || undefined;
      if (cfg.mode === "transfer") { payload.bankAccountId = bankAccountId || undefined; payload.toBankAccountId = toBankAccountId || undefined; payload.amount = num(amount); }
      if (cfg.mode === "payment") {
        payload.amount = num(amount);
        const allocations = Object.entries(alloc).map(([targetId, v]) => ({ targetId, amount: num(v) })).filter(a => a.amount > 0);
        if (allocations.length) payload.allocations = allocations;
        const creditApplications = Object.entries(creditAlloc)
          .map(([sourceId, v]) => ({ sourceId, sourceType: (credits ?? []).find(c => c.id === sourceId)?.sourceType, amount: num(v) }))
          .filter(a => a.amount > 0);
        if (creditApplications.length) payload.creditApplications = creditApplications;
        if (paymentMethod) payload.paymentMethod = paymentMethod;   // structured, not folded into memo
      }
      if (cfg.mode === "lineItems") {
        // Item lines need Qty × Rate; account (COA) lines just need an amount.
        for (const l of lines) {
          const used = l.itemId || l.accountId || num(l.amount);
          if (!used) continue;
          if (l.itemId) {
            if (!num(l.qty) || l.rate.trim() === "") { setErr("Product/service lines need a quantity and a rate."); setPosting(false); return; }
            // Estimate/PurchaseOrder/SalesOrder have no ledger impact — nothing
            // posts until conversion, which resolves the item's account fresh at
            // that point (lib/accounting/trade-documents.ts). Requiring one here
            // blocked ordering an item before its accounting setup was finished,
            // for a document that was never going to touch that account anyway.
            if (!cfg.trade && !l.accountId) {
              const nm = items.find(x => x.id === l.itemId)?.name || "This item";
              setErr(`${nm} has no ${cfg.side === "sales" ? "income" : "expense"} account set — add one in Products & Services before using it here.`);
              setPosting(false); return;
            }
          } else if (isItemOnlySales) {
            // These five no longer offer a Chart-of-Accounts line at all — a
            // bare account-only line here means stale form state, not a user
            // choice, so it's refused rather than silently posted or dropped.
            setErr("Each line needs a product or service — this document can't post to a Chart of Accounts line directly."); setPosting(false); return;
          } else if (!l.accountId || num(l.amount) === 0) {
            setErr("Each line needs an account (or a product/service) and an amount."); setPosting(false); return;
          }
        }
        // Sourcing policy, checked here purely so the buyer hears it before
        // pressing Post rather than after. The real control is server-side in
        // lib/inventory/sourcing-server.ts — this list is whatever the browser
        // happens to hold, and "Show all items" can put an unlinked item on a
        // line quite deliberately.
        if (SOURCING_ENFORCED_TYPES.has(type)) {
          const itemMap = new Map(items.map((i: any) => [i.id, i]));
          const linked = new Set((supplierLinks ?? []).map((l: any) => l.itemId));
          const v = sourcingViolations(lines, itemMap, linked, selectedParty?.name);
          if (v.length) { setErr(v.length === 1 ? v[0].message : `${v.length} items are not linked to this supplier: ${v.map(x => x.itemName).join(", ")}.`); setPosting(false); return; }
        }
      }
      if (cfg.terms) payload.dueDate = dueDate || undefined;
      if (cfg.tax) payload.pricing = pricing;
      if (cfg.refLabel && reference.trim()) payload.reference = reference.trim();
      if (cfg.mode === "deposit" && sweptPaymentIds.length) payload.sweptPaymentIds = sweptPaymentIds;
      if (cfg.mode === "lineItems" || cfg.mode === "deposit") {
        payload.lines = lines
          // A trade document's item line may have no resolved account yet —
          // it isn't dropped for that (see the validation above). Same for the
          // four posting item-only sales types: if an item's own account ever
          // came back empty, the line must still reach the server to get the
          // clear refusal in accountFor() rather than silently vanish here.
          .filter(l => (l.accountId || ((cfg.trade || isItemOnlySales) && l.itemId)) && num(l.amount) !== 0)
          .map(l => ({ accountId: l.accountId || null, accountOverride: !!l.accountOverride, itemId: l.itemId || null, description: l.description.trim() || null, qty: num(l.qty) || null, rate: num(l.rate) || null, amount: num(l.amount), taxRateId: l.taxRateId || null, taxCodeId: l.taxCodeId || null, classId: l.classId || null, locationId: l.locationId || null, lotNo: l.lotNo || null, expiryDate: l.expiryDate || null, orderUom: l.orderUom || null, packLevel: l.packLevel || null, unitsPerOrderUnit: l.unitsPerOrderUnit ?? 1, supplierSkuId: l.supplierSkuId || null, skuId: l.skuId || null,
            priceLevel: l.priceLevel || null, priceUom: l.priceUom || null, unitsPerPriceUnit: l.unitsPerPriceUnit ?? null, priceInput: l.priceInput != null && l.priceInput !== "" ? num(l.priceInput) : null }));
      }

      let url = `/api/documents/${type}`;
      let method = "POST";
      if (editId) { url = `/api/documents/${type}/${editId}`; method = "PUT"; }
      else if (cfg.trade) {
        url = `/api/trade-documents/${cfg.trade}`; payload.issueDate = date; payload.expiryDate = expiryDate || undefined;
        if (type === "PurchaseOrder") payload.salesOrderId = salesOrderId || undefined;
      }

      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const d = await res.json();
      if (!res.ok) { setErr(d.error || "Failed to save"); return; }
      setDone({ docNumber: d.docNumber, txnNo: d.txnNo });
    } finally { setPosting(false); }
  }

  function reset() {
    setDone(null); setErr(""); setMemo(""); setPartyId(""); setBankAccountId(""); setToBankAccountId(""); setAmount(""); setOpenDocs(null); setAlloc({}); setCredits(null); setCreditAlloc({}); setPaymentMethod(""); setAmountTouched(false);
    setBillSuggestions(null); setAddingSuggestion(null); setSuggestionErr("");
    setLines(split ? [emptyLine("item")] : [emptyLine(), emptyLine()]); setAcctsOpen(false); setDate(todayStr()); setExpiryDate(""); setCurrency(home); setRate("1");
    setReference(""); setTermsKey("net30"); setDueDate(addDays(todayStr(), 30));
    fetch(`/api/numbering?peek=${type}`).then(r => r.json()).then(n => n?.docNumber && setDocNumber(n.docNumber)).catch(() => {});
  }

  const input = control;        // boxed field control (form-kit)
  const label = fieldLabel;     // micro uppercase label (form-kit)

  if (done) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <div className="rounded-lg bg-stone-900 border border-stone-800 p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-500/15 flex items-center justify-center mx-auto mb-4"><Check size={24} className="text-emerald-400" /></div>
          <h2 className="text-[18px] font-semibold text-white">{cfg.title} posted</h2>
          <p className="text-[13px] text-stone-400 mt-1">
            {done.docNumber && <span className="font-mono">{done.docNumber}</span>}
            {done.txnNo != null && <span className="text-stone-600"> · TXN-{String(done.txnNo).padStart(6, "0")}</span>}
            {" "}for <span className="text-stone-200 font-medium">{money(totals.total)}</span> {currency || home}
          </p>
          <div className="flex items-center justify-center gap-3 mt-6">
            <button onClick={reset} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-medium">New {cfg.title.toLowerCase()}</button>
            <Link href={cfg.trade ? `/accounting/trade/${cfg.trade}` : "/accounting/journal"} className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[13px]">{cfg.trade ? `View ${cfg.title.toLowerCase()}s` : "View in ledger"}</Link>
          </div>
        </div>
      </div>
    );
  }

  const partyRequired = !!cfg.party && cfg.mode !== "deposit";
  const close = () => router.back();
  const cur = currency || home;
  // Sales-document refactor, Phase 2 (2026-10-21): these five post (or, for
  // Estimate, will post on conversion) entirely from the item's own account
  // mapping — never a hand-picked Chart of Accounts line. Unlike isOrderDoc
  // below, this does NOT require items.length > 0: an org with no items yet
  // still gets the item column (its "+ Add new item…" option works with zero
  // items), never a fallback account column — lib/accounting/documents.ts and
  // trade-documents.ts refuse a line with no item for these types regardless.
  const isItemOnlySales = (["Invoice", "Estimate", "SalesReceipt", "CreditNote", "RefundReceipt"] as DocType[]).includes(type);
  // Which line columns to show (see the item/account model in CFG).
  const showItemCol = ((cfg.lineMode === "item" || cfg.lineMode === "both") && items.length > 0) || isItemOnlySales;
  // A Purchase Order is item-based and non-accounting → one row per item, no
  // account column (the posting account is resolved when it becomes a Bill).
  const isOrderDoc = (cfg.trade === "purchase-orders" || cfg.trade === "sales-orders") && items.length > 0;
  const showAccountCol = (isOrderDoc || isItemOnlySales) ? false : ((cfg.lineMode === "account" || cfg.lineMode === "both") || (cfg.lineMode === "item" && items.length === 0));
  const accountHeader = cfg.side === "sales" ? "Income account" : cfg.side === "purchase" ? "Category / account" : "Account";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close} />
      <div className="relative h-full w-full sm:w-[95vw] max-w-[1320px] bg-stone-950 border-l border-stone-800 shadow-2xl ring-1 ring-black/40 flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 px-6 py-3.5 border-b border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/70 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-emerald-500/15 ring-1 ring-emerald-500/20 flex items-center justify-center shrink-0"><FileText size={17} className="text-emerald-400" /></div>
            <div className="min-w-0">
              <h1 className="text-[18px] font-semibold text-stone-100 leading-tight truncate">{editId ? (readOnly ? "View" : "Edit") : "New"} {cfg.title.toLowerCase()}</h1>
              <p className="text-[11px] text-stone-500 truncate">{cfg.blurb}</p>
            </div>
          </div>
          <div className="flex items-center gap-5 shrink-0">
            <div className="text-right hidden sm:block">
              <div className="text-[10px] uppercase tracking-wider text-stone-500">Total</div>
              <div className="text-[18px] font-semibold text-white tabular-nums leading-tight">{money(totals.total)} <span className="text-[12px] text-stone-500 font-normal">{cur}</span></div>
            </div>
            {actions}
            <button onClick={close} className="text-stone-500 hover:text-stone-200 hover:bg-stone-800 p-1.5 rounded-lg transition" title="Close"><X size={20} /></button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
        {loading ? (
          <div className="py-10 text-center text-stone-500 text-[13px] inline-flex items-center gap-2"><Loader size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <>
          <fieldset disabled={!!readOnly} style={{ display: "contents" }}>
          <div className="space-y-6 max-w-[1200px]">
            {err && <div className="text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2 inline-flex items-center gap-2"><AlertTriangle size={13} /> {err}</div>}

          {/* Document header — aligned grid, grouped by who / details */}
          <div className="rounded-lg border border-stone-800/80 bg-stone-900/40 p-4 sm:p-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-4">
              {cfg.party && (
                <Field label={cfg.partyLabel} required={partyRequired} className="col-span-2"
                  hint={supportsProject ? "Pick a project directly if this document is for one" : undefined}>
                  <SelectField value={projectId ? `${PROJECT_PREFIX}${projectId}` : partyId} onChange={e => onPartyOrProject(e.target.value)}>
                    <option value="">Select {cfg.partyLabel?.toLowerCase()}…</option>
                    {supportsProject ? (
                      parties.map(p => (
                        <Fragment key={p.id}>
                          <option value={p.id}>{p.name}{p.currency && p.currency !== home ? ` · ${p.currency}` : ""}</option>
                          {(projectsByCustomer[p.id] ?? []).map(pr => (
                            <option key={pr.id} value={`${PROJECT_PREFIX}${pr.id}`}>{"    ↳ "}{pr.code ? `${pr.code} · ` : ""}{pr.name}</option>
                          ))}
                        </Fragment>
                      ))
                    ) : (
                      parties.map(p => <option key={p.id} value={p.id}>{p.name}{p.currency && p.currency !== home ? ` · ${p.currency}` : ""}</option>)
                    )}
                    <option value={ADD}>+ Add new {cfg.partyLabel?.toLowerCase()}…</option>
                  </SelectField>
                </Field>
              )}
              {cfg.bank && (
                <Field label={cfg.bank} required className="col-span-2">
                  <SelectField value={bankAccountId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "account-bank", field: "bank" }) : onBankAccount(e.target.value)}>
                    <option value="">Select account…</option>
                    {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                    <option value={ADD}>+ Add new bank account…</option>
                  </SelectField>
                </Field>
              )}
              {cfg.mode === "transfer" && (
                <>
                  <Field label="From" required className="col-span-2">
                    <SelectField value={bankAccountId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "account-bank", field: "bank" }) : setBankAccountId(e.target.value)}>
                      <option value="">Select account…</option>
                      {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      <option value={ADD}>+ Add new bank account…</option>
                    </SelectField>
                  </Field>
                  <Field label="To" required className="col-span-2">
                    <SelectField value={toBankAccountId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "account-bank", field: "toBank" }) : setToBankAccountId(e.target.value)}>
                      <option value="">Select account…</option>
                      {banks.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                      <option value={ADD}>+ Add new bank account…</option>
                    </SelectField>
                  </Field>
                </>
              )}
              <Field label={`${cfg.title} no.`}>
                <input value={docNumber} onChange={e => setDocNumber(e.target.value)} placeholder="Auto" className={`${input} font-mono`} />
              </Field>
              <Field label="Date" required>
                <input type="date" value={date} onChange={e => { setDate(e.target.value); if (cfg.terms) applyTerms(termsKey, e.target.value); }} className={input} />
              </Field>
              {cfg.terms && (
                <>
                  <Field label="Terms">
                    <SelectField value={termsKey} onChange={e => applyTerms(e.target.value, date)}>
                      {TERMS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
                    </SelectField>
                  </Field>
                  <Field label="Due date">
                    <input type="date" value={dueDate} onChange={e => { setDueDate(e.target.value); setTermsKey("custom"); }} className={input} />
                  </Field>
                </>
              )}
              {cfg.refLabel && (
                <Field label={cfg.refLabel}>
                  <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Optional" className={input} />
                </Field>
              )}
              {cfg.dateLabel2 && (
                <Field label={cfg.dateLabel2}>
                  <input type="date" value={expiryDate} onChange={e => setExpiryDate(e.target.value)} className={input} />
                </Field>
              )}
              {type === "PurchaseOrder" && (
                <Field label="For Sales Order" hint="Optional — links this purchase to a customer order's Production Tracker">
                  <SelectField value={salesOrderId} onChange={e => setSalesOrderId(e.target.value)}>
                    <option value="">None</option>
                    {openSalesOrders.map((o: any) => <option key={o.id} value={o.id}>{o.docNumber} — {o.partyLabel}</option>)}
                  </SelectField>
                </Field>
              )}
              {mcEnabled && (
                <Field label="Currency" hint={partyLockedCurrency ? "Fixed by this party's currency" : undefined}>
                  {partyLockedCurrency ? (
                    <div className={`${input} bg-stone-800/60 text-stone-300 cursor-not-allowed`}>{partyLockedCurrency}{partyLockedCurrency === home ? " (home)" : ""}</div>
                  ) : (
                    <SelectField value={currency} onChange={e => { setCurrency(e.target.value); if (e.target.value === home) setRate("1"); }}>
                      {home && !CURRENCIES.some(c => c.code === home) && <option value={home}>{home} (home)</option>}
                      {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code}{c.code === home ? " (home)" : ""}</option>)}
                    </SelectField>
                  )}
                </Field>
              )}
              {foreign && (
                <Field label="Exchange rate" required hint={`1 ${currency} = ${rate || "?"} ${home}`}>
                  <CalcInput value={rate} onChange={setRate} className={input} />
                </Field>
              )}
              {showHeaderDims && classes.length > 0 && (
                <Field label="Class" hint="This document's own A/R, A/P or Bank line — not the revenue/expense lines below.">
                  <SelectField value={controlClassId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "class" }) : setControlClassId(e.target.value)}>
                    <option value="">—</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value={ADD}>+ Add new class…</option>
                  </SelectField>
                </Field>
              )}
              {showHeaderDims && locations.length > 0 && (
                <Field label="Location" hint="Same, for this document's own control-account line.">
                  <SelectField value={controlLocationId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "location" }) : setControlLocationId(e.target.value)}>
                    <option value="">—</option>
                    {locations.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value={ADD}>+ Add new location…</option>
                  </SelectField>
                </Field>
              )}
            </div>
          </div>

          {/* Amount (transfer) */}
          {cfg.mode === "transfer" && (
            <div className="w-52">
              <label className={label}>Amount *</label>
              <CalcInput value={amount} onChange={setAmount} className={`${input} w-full text-right tabular-nums`} />
            </div>
          )}

          {/* Receive payment / Pay bill — QBO-style */}
          {cfg.mode === "payment" && (() => {
            const noun = cfg.party === "Vendor" ? "bill" : "invoice";
            const amountToApply = allocApplied;                                  // total applied to invoices/bills
            const amountToCredit = round2(num(amount) - (allocApplied - creditApplied)); // leftover cash → new credit
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-end gap-4">
                  <div className="w-48">
                    <label className={label}>Payment method</label>
                    <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={`${input} w-full`}>
                      <option value="">Choose…</option>
                      {["Cash", "Bank transfer", "Cheque", "Card", "Direct debit", "Online", "Other"].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="w-52">
                    <label className={label}>Amount received *</label>
                    <CalcInput value={amount} onChange={v => { setAmount(v); setAmountTouched(true); }} className={`${input} w-full text-right tabular-nums text-[15px]`} />
                  </div>
                  {partyId && openDocs && (
                    <div className="ml-auto text-right">
                      <div className="text-[10px] uppercase tracking-wider text-stone-500">{cfg.party === "Vendor" ? "Supplier" : "Customer"} balance</div>
                      <div className="text-[18px] font-semibold text-stone-200 tabular-nums">{money(customerBalance)} <span className="text-[12px] text-stone-500 font-normal">{cur}</span></div>
                    </div>
                  )}
                </div>

                {!partyId ? (
                  <div className="text-[12px] text-stone-500">Select a {cfg.partyLabel?.toLowerCase()} to see their outstanding {noun}s.</div>
                ) : openDocs === null ? (
                  <div className="text-[12px] text-stone-500 inline-flex items-center gap-1"><Loader size={12} className="animate-spin" /> Loading outstanding {noun}s…</div>
                ) : openDocs.length === 0 ? (
                  <div className="text-[12px] text-stone-500">No outstanding {noun}s — this records as an unapplied {cfg.party === "Vendor" ? "payment" : "credit"} on account.</div>
                ) : (
                  <div className="rounded-lg border border-stone-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-stone-800 bg-stone-950/40">
                      <span className="text-[12px] font-semibold text-stone-300">Outstanding transactions</span>
                      <button type="button" onClick={clearPayment} className="text-[11px] text-stone-500 hover:text-stone-300">Clear payment</button>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] min-w-[640px]">
                        <thead>
                          <tr className={tableHead}>
                            <th className="px-3 py-2 w-8"><input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-emerald-600" /></th>
                            <th className="text-left px-3 py-2">Description</th>
                            <th className="text-left px-3 py-2">Due date</th>
                            <th className="text-right px-3 py-2">Original amount</th>
                            <th className="text-right px-3 py-2">Open balance</th>
                            <th className="text-right px-3 py-2 w-32">Payment</th>
                          </tr>
                        </thead>
                        <tbody>
                          {openDocs.map(d => {
                            const overdue = d.dueDate && d.dueDate < todayStr();
                            const checked = num(alloc[d.id]) > 0;
                            return (
                              <tr key={d.id} className="border-b border-stone-800/50">
                                <td className="px-3 py-2"><input type="checkbox" checked={checked} onChange={() => toggleRow(d)} className="accent-emerald-600" /></td>
                                <td className="px-3 py-2"><span className="text-stone-200 font-medium">{d.docNumber}</span> <span className="text-[11px] text-stone-500">({d.date})</span></td>
                                <td className={`px-3 py-2 ${overdue ? "text-rose-400" : "text-stone-400"}`}>{d.dueDate || "—"}{overdue ? " ⚠" : ""}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-stone-400">{money(d.totalFx)}</td>
                                <td className="px-3 py-2 text-right tabular-nums text-stone-300">{money(d.openFx)}</td>
                                <td className="px-3 py-2 text-right">
                                  <CalcInput value={alloc[d.id] ?? ""} onChange={v => setAllocSynced({ ...alloc, [d.id]: v })} className={`${input} w-28 text-right tabular-nums py-1.5`} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Credits — draw down the party's unapplied payments / credit notes */}
                {partyId && credits && credits.length > 0 && (
                  <div className="rounded-lg border border-stone-800 overflow-hidden">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-stone-800 bg-stone-950/40">
                      <span className="text-[12px] font-semibold text-stone-300">Credits</span>
                      <span className="text-[11px] text-stone-500">{money(availableCredit)} {cur} available</span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] min-w-[640px]">
                        <thead>
                          <tr className={tableHead}>
                            <th className="px-3 py-2 w-8"></th>
                            <th className="text-left px-3 py-2">Description</th>
                            <th className="text-left px-3 py-2">Date</th>
                            <th className="text-right px-3 py-2">Original amount</th>
                            <th className="text-right px-3 py-2">Open balance</th>
                            <th className="text-right px-3 py-2 w-32">Applied</th>
                          </tr>
                        </thead>
                        <tbody>
                          {credits.map(c => (
                            <tr key={c.id} className="border-b border-stone-800/50">
                              <td className="px-3 py-2"><input type="checkbox" checked={num(creditAlloc[c.id]) > 0} onChange={() => toggleCredit(c)} className="accent-emerald-600" /></td>
                              <td className="px-3 py-2"><span className="text-stone-200">{c.label}</span> <span className="text-[11px] text-stone-500 font-mono">{c.docNumber}</span></td>
                              <td className="px-3 py-2 text-stone-400">{c.date}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-stone-400">{money(c.total)}</td>
                              <td className="px-3 py-2 text-right tabular-nums text-stone-300">{money(c.open)}</td>
                              <td className="px-3 py-2 text-right">
                                <CalcInput value={creditAlloc[c.id] ?? ""} onChange={v => setCreditSynced({ ...creditAlloc, [c.id]: v })} className={`${input} w-28 text-right tabular-nums py-1.5`} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Totals */}
                {partyId && (openDocs?.length || (credits?.length ?? 0)) ? (
                  <div className="flex flex-col items-end gap-1 text-[13px]">
                    <div className="flex justify-between gap-10 w-72"><span className="text-stone-400">Amount to apply</span><span className="tabular-nums text-stone-200">{money(amountToApply)}</span></div>
                    {creditApplied > 0 && <div className="flex justify-between gap-10 w-72"><span className="text-stone-400">…funded by credits</span><span className="tabular-nums text-stone-400">{money(creditApplied)}</span></div>}
                    <div className="flex justify-between gap-10 w-72"><span className="text-stone-400">Amount to credit</span><span className={`tabular-nums ${amountToCredit < -0.005 ? "text-rose-400" : "text-stone-200"}`}>{money(amountToCredit)}</span></div>
                    {amountToCredit < -0.005 && <div className="text-[11px] text-rose-400">Applied more than received — increase amount received or reduce the payments.</div>}
                    {amountToCredit > 0.005 && <div className="text-[11px] text-stone-500">The unapplied {money(amountToCredit)} will be kept as a {cfg.party === "Vendor" ? "supplier" : "customer"} credit on account.</div>}
                  </div>
                ) : null}
              </div>
            );
          })()}

          {/* Add from Purchase Order / Goods Receipt — QBO's "Add to Bill"
              panel. Each suggestion creates its OWN bill immediately, from
              that source document's own supplier/currency/lines — not from
              whatever is typed into this draft (the hint below says so). A PO
              line for a stocked item is never offered here; it is billed from
              its Goods Receipt instead, which is why both lists appear here
              side by side. */}
          {type === "Bill" && partyId && billSuggestions && (billSuggestions.purchaseOrders.length > 0 || billSuggestions.goodsReceipts.length > 0) && (
            <div className="rounded-lg border border-stone-800 overflow-hidden">
              <div className="px-3 py-2 border-b border-stone-800 bg-stone-950/40">
                <span className="text-[12px] font-semibold text-stone-300">Add from purchase order or goods receipt</span>
                <p className="text-[11px] text-stone-500 mt-0.5">Add creates its own bill right away, from that document's own supplier and lines.</p>
              </div>
              {suggestionErr && <div className="px-3 py-2 text-[12px] text-rose-400 bg-rose-950/30 border-b border-stone-800">{suggestionErr}</div>}
              <div className="divide-y divide-stone-800/60">
                {billSuggestions.purchaseOrders.map(po => (
                  <div key={po.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[13px] text-stone-200 font-medium">Purchase Order {po.docNumber || "—"}</div>
                      <div className="text-[11px] text-stone-500">
                        {po.issueDate} · {po.lineCount} line{po.lineCount === 1 ? "" : "s"} · {money(po.balance)} {po.currency || cur}
                        {po.hasStockedRemaining ? " · some lines need receiving first" : ""}
                      </div>
                    </div>
                    <button type="button" disabled={addingSuggestion === po.id} onClick={() => addPoToBill(po)}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[12px] font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
                      {addingSuggestion === po.id && <Loader size={12} className="animate-spin" />} Add
                    </button>
                  </div>
                ))}
                {billSuggestions.goodsReceipts.map(gr => (
                  <div key={gr.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <div className="text-[13px] text-stone-200 font-medium">Goods Receipt {gr.receiptNo || "—"}</div>
                      <div className="text-[11px] text-stone-500">{gr.receiptDate} · {money(gr.balance)} {gr.currency || cur} unbilled</div>
                    </div>
                    <button type="button" disabled={addingSuggestion === gr.id} onClick={() => addReceiptToBill(gr)}
                      className="shrink-0 px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[12px] font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
                      {addingSuggestion === gr.id && <Loader size={12} className="animate-spin" />} Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Purchase Order / Bill: ITEMS and ACCOUNTS as two sections. An item
              line is ordered and priced in the supplier's own packaging, as
              defined in Products & Services; an account line is a plain
              Chart-of-Accounts amount (freight, a service, a one-off). */}
          {split && cfg.mode === "lineItems" && (() => {
            const itemIdx = lines.map((l, i) => ({ l, i })).filter(x => lineKind(x.l) === "item");
            const acctIdx = lines.map((l, i) => ({ l, i })).filter(x => lineKind(x.l) === "account");
            const sumOf = (xs: { l: Line }[]) => money(Math.round(xs.reduce((s, x) => s + num(x.l.amount), 0) * 100) / 100);
            const delBtn = (i: number) => (
              <button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} title="Remove line" className="p-1 rounded-md text-stone-600 opacity-0 group-hover:opacity-100 hover:bg-stone-800 hover:text-rose-400 transition"><Trash2 size={14} /></button>
            );
            const taxCell = (l: Line, i: number) => (
              <td className="px-1.5 py-1 align-top">
                <CellSelect value={taxSelectValue(l)} onChange={e => onTaxChange(i, e.target.value)}>
                  <option value="">No tax</option>
                  {taxCodes.length > 0 && (
                    <optgroup label="Tax codes">
                      {taxCodes.map(c => <option key={c.id} value={`code:${c.id}`}>{c.name}</option>)}
                    </optgroup>
                  )}
                  <optgroup label={taxCodes.length > 0 ? "Tax rates (legacy)" : "Tax rates"}>
                    {taxes.map(t => <option key={t.id} value={`rate:${t.id}`}>{t.name} ({Number(t.rate)}%)</option>)}
                  </optgroup>
                  <option value={ADD}>+ Add new tax rate…</option>
                </CellSelect>
              </td>
            );
            const dimCells = (l: Line, i: number) => (<>
              {showDims && classes.length > 0 && (
                <td className="px-1.5 py-1 align-top">
                  <CellSelect value={l.classId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "class", lineIndex: i }) : setLine(i, { classId: e.target.value })}>
                    <option value="">—</option>
                    {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value={ADD}>+ Add new class…</option>
                  </CellSelect>
                </td>
              )}
              {showDims && locations.length > 0 && (
                <td className="px-1.5 py-1 align-top">
                  <CellSelect value={l.locationId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "location", lineIndex: i }) : setLine(i, { locationId: e.target.value })}>
                    <option value="">—</option>
                    {locations.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    <option value={ADD}>+ Add new location…</option>
                  </CellSelect>
                </td>
              )}
            </>);
            const dimHeads = (<>
              {showDims && classes.length > 0 && <th className={`${thCls} w-32`}>Class</th>}
              {showDims && locations.length > 0 && <th className={`${thCls} w-32`}>Location</th>}
            </>);
            return (
              <div className="space-y-3">
                {/* ── ITEMS ───────────────────────────────────────────────── */}
                <FoldSection title="Items" open={itemsOpen} onToggle={() => setItemsOpen(o => !o)}
                  summary={`${itemIdx.filter(x => x.l.itemId).length} line${itemIdx.filter(x => x.l.itemId).length === 1 ? "" : "s"} · ${sumOf(itemIdx)}`}>
                  <div className="overflow-x-auto">
                    {/* Item gets a guaranteed width: every other column is fixed, so
                        without a minimum it is the one squeezed to nothing. */}
                    <table className="w-full text-[13px] min-w-[1160px]">
                      <thead>
                        <tr className="border-b border-stone-800 bg-stone-900/60">
                          <th className={`${thCls} w-8 !text-center`}>#</th>
                          <th className={`${thCls} min-w-[200px]`}>Item</th>
                          <th className={`${thCls} w-40`}>SKU</th>
                          <th className={`${thCls} w-40`}>Pack configuration</th>
                          <th className={`${thCls} w-44`}>Qty</th>
                          <th className={`${thCls} w-48`}>Rate</th>
                          <th className={`${thCls} !text-right w-24`}>Amount</th>
                          {cfg.tax && <th className={`${thCls} w-28`}>Tax</th>}
                          {dimHeads}
                          <th className="w-9"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {itemIdx.map(({ l, i }, n) => {
                          const it = l.itemId ? items.find(x => x.id === l.itemId) : null;
                          const baseU = it?.baseUom || "";
                          const links = l.itemId ? linksFor(l.itemId) : [];
                          const link = links.find((x: any) => x.id === l.supplierSkuId) ?? null;
                          const opts = l.itemId ? unitOpts(l) : [];
                          const unitChoices = opts.map(o => ({ value: o.packLevel, label: unitName(o, baseU) }));
                          const priceChoices = opts.map(o => ({ value: o.packLevel, label: `per ${unitName(o, baseU)}` }));
                          const showLot = !cfg.trade && !!it?.lotTracked;
                          return (
                            <Fragment key={i}>
                              <tr className={`group transition-colors hover:bg-stone-900/50 ${showLot ? "" : "border-b border-stone-800/50"}`}>
                                <td className="px-2 py-2 text-center text-stone-600 text-[11px] tabular-nums align-top">{n + 1}</td>
                                <td className="px-1.5 py-1 align-top">
                                  <CellSelect value={l.itemId} onChange={e => onItem(i, e.target.value)}>
                                    <option value="">Select item…</option>
                                    {/* An item already on the line stays selectable even when the
                                        narrowing would hide it — reopening must not blank a line. */}
                                    {(visibleItems.some(x => x.id === l.itemId) || !l.itemId
                                      ? visibleItems
                                      : [...visibleItems, items.find(x => x.id === l.itemId)].filter(Boolean)
                                    ).map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
                                    <option value={ADD}>+ Add new item…</option>
                                  </CellSelect>
                                  {l.itemId && <input value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Description" className={`${cell} !h-7 !text-[12px] text-stone-400 mt-0.5`} />}
                                </td>
                                <td className="px-1.5 py-1 align-top">
                                  {!l.itemId ? <div className="px-2 py-1.5 text-stone-600">—</div>
                                    : links.length === 0
                                      ? <div className="px-2 py-1.5 text-[12px] text-stone-500" title="This supplier has no SKU for the item, so it is ordered in the item's base unit.">No SKU · base unit</div>
                                      : (
                                        <CellSelect value={l.supplierSkuId ?? ""} onChange={e => onSku(i, e.target.value)} aria-label="Supplier SKU">
                                          {links.map((s: any) => <option key={s.id} value={s.id}>{skuLabel(s)}{s.isPreferred && links.length > 1 ? " ★" : ""}</option>)}
                                        </CellSelect>
                                      )}
                                </td>
                                <td className="px-2.5 py-2 align-top text-[12px] text-stone-400">{link ? (packConfigText(link, baseU) || "—") : (l.itemId ? (baseU || "—") : "—")}</td>
                                <td className="px-1.5 py-1 align-top">
                                  {l.itemId
                                    ? <QtyUnitField variant="cell" qty={l.qty} onQty={v => recalc(i, { qty: v })} unit={l.packLevel || "base"} onUnit={v => onQtyUnit(i, v)} options={unitChoices} unitPlaceholder={null} qtyWidth="w-16" qtyLabel="Quantity" unitLabel="Order in" />
                                    : <div className="px-2 py-1.5 text-stone-600">—</div>}
                                  {l.itemId && (l.unitsPerOrderUnit ?? 1) !== 1 && num(l.qty) > 0 && <div className="px-2 pt-0.5 text-[11px] text-stone-500 tabular-nums">= {fmtQty(num(l.qty) * (l.unitsPerOrderUnit ?? 1))} {baseU}</div>}
                                </td>
                                <td className="px-1.5 py-1 align-top">
                                  {l.itemId
                                    ? <QtyUnitField variant="cell" qty={l.priceInput ?? ""} onQty={v => recalc(i, { priceInput: v })} unit={l.priceLevel || "base"} onUnit={v => onPriceUnit(i, v)} options={priceChoices} unitPlaceholder={null} qtyPlaceholder="0.00" qtyWidth="w-20" qtyLabel="Rate" unitLabel="Rate per" />
                                    : <div className="px-2 py-1.5 text-stone-600">—</div>}
                                  {l.itemId && l.priceLevel && l.priceLevel !== l.packLevel && num(l.rate) > 0 && <div className="px-2 pt-0.5 text-[11px] text-stone-500 tabular-nums">= {money(num(l.rate))} per {l.orderUom || baseU}</div>}
                                </td>
                                <td className="px-2.5 py-2 align-top text-right tabular-nums font-medium text-stone-200">{num(l.amount) ? money(num(l.amount)) : <span className="text-stone-600">—</span>}</td>
                                {cfg.tax && taxCell(l, i)}
                                {dimCells(l, i)}
                                <td className="px-1 py-1 text-center align-top">{itemIdx.length > 1 && delBtn(i)}</td>
                              </tr>
                              {showLot && (
                                <tr className="border-b border-stone-800/50">
                                  <td></td>
                                  <td colSpan={20} className="px-2 pb-2 pt-0">
                                    <div className="flex items-center gap-2 flex-wrap text-[11px] text-stone-500">
                                      <span className="uppercase tracking-wide text-emerald-500/70 font-medium">Receive to lot</span>
                                      {isFPWIP(it) ? (
                                        <input value="assigned automatically" disabled className={`${cell} !w-40 opacity-60`} />
                                      ) : (
                                        <input value={l.lotNo ?? ""} onChange={e => setLine(i, { lotNo: e.target.value })} placeholder="Lot / batch no." className={`${cell} !w-40`} />
                                      )}
                                      <span className="text-stone-600">expiry</span>
                                      <input type="date" value={l.expiryDate ?? ""} onChange={e => setLine(i, { expiryDate: e.target.value })} className={`${cell} !w-40`} />
                                      <span className="text-stone-600">— creates a FIFO cost lot for {it?.name}</span>
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="border-t border-stone-800/70 px-2 py-1.5 flex items-center justify-between gap-3">
                    <button onClick={() => setLines(ls => [...ls, emptyLine("item")])} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-stone-400 hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-stone-800/60 transition">
                      <Plus size={13} /> Add item
                    </button>
                    {(hiddenItemCount > 0 || showAllItems) && (
                      <div className="text-[11px] text-stone-500 pr-1">
                        {showAllItems
                          ? <>Showing all {items.length} items. </>
                          : <>Showing {visibleItems.length} of {items.length} items{selectedParty ? <> for {selectedParty.name}</> : null}. </>}
                        <button onClick={() => setShowAllItems(v => !v)} className="font-medium text-stone-400 hover:text-emerald-400 underline underline-offset-2 transition">
                          {showAllItems ? "Show linked only" : "Show all items"}
                        </button>
                      </div>
                    )}
                  </div>
                </FoldSection>

                {/* ── ACCOUNTS (Chart of Accounts) ────────────────────────── */}
                <FoldSection title="Accounts" hint="Chart of Accounts" open={acctsOpen} onToggle={() => setAcctsOpen(o => !o)}
                  summary={acctIdx.length ? `${acctIdx.length} line${acctIdx.length === 1 ? "" : "s"} · ${sumOf(acctIdx)}` : "None"}>
                  {acctIdx.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-[13px] min-w-[720px]">
                        <thead>
                          <tr className="border-b border-stone-800 bg-stone-900/60">
                            <th className={`${thCls} w-8 !text-center`}>#</th>
                            <th className={`${thCls} w-72`}>Account</th>
                            <th className={thCls}>Description</th>
                            <th className={`${thCls} !text-right w-32`}>Amount</th>
                            {cfg.tax && <th className={`${thCls} w-32`}>Tax</th>}
                            {dimHeads}
                            <th className="w-9"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {acctIdx.map(({ l, i }, n) => (
                            <tr key={i} className="group border-b border-stone-800/50 hover:bg-stone-900/50">
                              <td className="px-2 py-2 text-center text-stone-600 text-[11px] tabular-nums">{n + 1}</td>
                              <td className="px-1.5 py-1">
                                <CellSelect value={l.accountId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "account-expense", lineIndex: i }) : setLine(i, { accountId: e.target.value })}>
                                  <option value="">Select account…</option>
                                  {lineAccounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>)}
                                  <option value={ADD}>+ Add new account…</option>
                                </CellSelect>
                              </td>
                              <td className="px-1.5 py-1"><input value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="—" className={cell} /></td>
                              <td className="px-1.5 py-1"><CalcInput value={l.amount} onChange={v => setLine(i, { amount: v })} className={`${cell} text-right tabular-nums font-medium`} /></td>
                              {cfg.tax && taxCell(l, i)}
                              {dimCells(l, i)}
                              <td className="px-1 py-1 text-center">{delBtn(i)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className={`${acctIdx.length ? "border-t border-stone-800/70" : ""} px-2 py-1.5`}>
                    <button onClick={() => { setLines(ls => [...ls, emptyLine("account")]); setAcctsOpen(true); }} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-stone-400 hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-stone-800/60 transition">
                      <Plus size={13} /> Add account line
                    </button>
                  </div>
                </FoldSection>
              </div>
            );
          })()}

          {/* Line items / deposit lines */}
          {!split && (cfg.mode === "lineItems" || cfg.mode === "deposit") && (
            <Section title={cfg.mode === "deposit" ? "Sources" : "Line items"}
              right={cfg.tax && (
                <label className="flex items-center gap-1.5 text-[11px] text-stone-400 cursor-pointer" title="Whether the amounts typed on each line already include tax.">
                  Amounts are
                  <SelectField inset value={pricing} onChange={e => setPricing(e.target.value as "exclusive" | "inclusive")} className="!h-7 !text-[11px] !py-0 w-auto">
                    <option value="exclusive">Exclusive of tax</option>
                    <option value="inclusive">Inclusive of tax</option>
                  </SelectField>
                </label>
              )}>

              {(cfg.lineMode === "item" || cfg.lineMode === "both") && items.length === 0 && !isItemOnlySales && (
                <p className="text-[11px] text-stone-500">
                  Enter lines by income account below. To invoice by <b className="text-stone-400">Product/Service</b> (with Qty × Rate), add items in{" "}
                  <Link href="/accounting/items" className="text-emerald-400 hover:underline">Products &amp; Services</Link> — an Item column then appears here.
                </p>
              )}
              {isItemOnlySales && items.length === 0 && (
                <p className="text-[11px] text-stone-500">
                  This document posts entirely from a product or service's own account — pick <b className="text-stone-400">+ Add new item…</b> in the Product/Service column below to create one.
                </p>
              )}
              <div className="rounded-lg border border-stone-800/80 bg-stone-900/40 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-[13px] min-w-[720px]">
                    <thead>
                      <tr className="border-b border-stone-800 bg-stone-900/60">
                        <th className={`${thCls} w-8 !text-center`}>#</th>
                        {showItemCol && <th className={thCls}>Product / Service</th>}
                        {showAccountCol && <th className={thCls}>{accountHeader}</th>}
                        <th className={thCls}>Description</th>
                        {cfg.mode === "lineItems" && <th className={`${thCls} !text-right w-16`}>Qty</th>}
                        {cfg.mode === "lineItems" && <th className={`${thCls} !text-right w-24`}>Rate</th>}
                        <th className={`${thCls} !text-right w-28`}>Amount</th>
                        {cfg.tax && <th className={`${thCls} w-32`}>Tax</th>}
                        {showDims && classes.length > 0 && <th className={`${thCls} w-32`}>Class</th>}
                        {showDims && locations.length > 0 && <th className={`${thCls} w-32`}>Location</th>}
                        <th className="w-9"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {lines.map((l, i) => {
                        const lineItem = l.itemId ? items.find(x => x.id === l.itemId) : null;
                        // Lot/batch is captured at Receiving (or on a direct Bill/Expense),
                        // never on a Purchase Order — a PO is a non-accounting order.
                        const showLot = cfg.side === "purchase" && !cfg.trade && !!lineItem?.lotTracked;
                        return (
                        <Fragment key={i}>
                        <tr className={`group transition-colors hover:bg-stone-900/50 ${showLot ? "" : "border-b border-stone-800/50"}`}>
                          <td className="px-2 py-1 text-center text-stone-600 text-[11px] tabular-nums">{i + 1}</td>
                          {showItemCol && (
                            <td className="px-1.5 py-1">
                              <CellSelect value={l.itemId} onChange={e => onItem(i, e.target.value)}>
                                <option value="">—</option>
                                {/* An item already on the line always stays selectable, even when
                                    the current narrowing would hide it — otherwise reopening a saved
                                    document silently blanks its own lines. */}
                                {(visibleItems.some(x => x.id === l.itemId) || !l.itemId
                                  ? visibleItems
                                  : [...visibleItems, items.find(x => x.id === l.itemId)].filter(Boolean)
                                ).map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
                                <option value={ADD}>+ Add new item…</option>
                              </CellSelect>
                              {isOrderDoc && l.itemId && (() => {
                                const packs = itemPacks[l.itemId];
                                const baseU = packs?.baseUom ?? lineItem?.baseUom ?? null;
                                // Purchase pack options come from the addressed supplier's own
                                // links, not from the item's full link list — the wrong vendor's
                                // configuration is never fetched, let alone offered.
                                const opts = cfg.side === "purchase"
                                  ? orderOptions(baseU, (supplierLinks ?? []).filter((s: any) => s.itemId === l.itemId), partyId)
                                  : salesOrderOptions(baseU, packs?.skus ?? []);
                                const cur = `${l.packLevel ?? "base"}|${l.supplierSkuId ?? ""}`;
                                return (
                                  <div className="mt-1">
                                    <CellSelect value={cur} onChange={e => { const o = opts.find(x => `${x.packLevel}|${x.supplierSkuId ?? ""}` === e.target.value); if (o) onOrderLevel(i, o); }} className="!h-7 !text-[11px] text-stone-400" title="Order by">
                                      {opts.map(o => <option key={`${o.packLevel}|${o.supplierSkuId ?? ""}`} value={`${o.packLevel}|${o.supplierSkuId ?? ""}`}>Order by: {o.label}</option>)}
                                    </CellSelect>
                                  </div>
                                );
                              })()}
                            </td>
                          )}
                          {showAccountCol && (() => {
                            // An item defines the account it posts through, so
                            // the account defaults to the item's and is shown
                            // locked — but it stays reviewable and can be
                            // deliberately overridden for this one line.
                            const itemAcctId = itemAccountId(lineItem);
                            // Buying a stock-tracked item MUST capitalise to its
                            // inventory asset (a FIFO lot is created against it),
                            // so that one is not overridable — the server
                            // enforces it regardless of what we send.
                            const hardLocked = !!lineItem && cfg.side === "purchase" && isTracked(lineItem.productType);
                            const showLocked = !!lineItem && !!itemAcctId && (hardLocked || !l.accountOverride);
                            if (showLocked) {
                              const acct = accounts.find((a: any) => a.id === itemAcctId);
                              return (
                                <td className="px-1.5 py-1">
                                  <div className="flex items-center gap-1">
                                    <div
                                      className={`${cell} text-stone-400 truncate cursor-default flex-1`}
                                      title={hardLocked
                                        ? `Stock item — must post to its inventory asset account, so it can't be changed here. Set it on the item "${lineItem.name}".`
                                        : `Set by the item "${lineItem.name}". Change it on the item, or override it for this line.`}
                                    >
                                      {acct ? `${acct.code ? `${acct.code} · ` : ""}${acct.name}` : "From item"}
                                    </div>
                                    {!hardLocked && (
                                      <button type="button" onClick={() => setLine(i, { accountOverride: true, accountId: l.accountId || itemAcctId })}
                                        title="Post this line to a different account"
                                        className="shrink-0 text-[10px] uppercase tracking-wide text-stone-500 hover:text-stone-300 px-1 py-0.5">
                                        Change
                                      </button>
                                    )}
                                  </div>
                                </td>
                              );
                            }
                            const overriding = !!lineItem && !!l.accountOverride;
                            return (
                              <td className="px-1.5 py-1">
                                <div className="flex items-center gap-1">
                                  <div className="flex-1 min-w-0">
                                    <CellSelect value={l.accountId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: cfg.side === "sales" ? "account-income" : "account-expense", lineIndex: i }) : setLine(i, { accountId: e.target.value })}>
                                      <option value="">Select…</option>
                                      {lineAccounts.map(a => <option key={a.id} value={a.id}>{a.code ? `${a.code} · ` : ""}{a.name}</option>)}
                                      <option value={ADD}>+ Add new account…</option>
                                    </CellSelect>
                                  </div>
                                  {overriding && (
                                    <button type="button" onClick={() => setLine(i, { accountOverride: false, accountId: itemAcctId })}
                                      title={`Overriding the item's account. Revert to "${lineItem.name}" default.`}
                                      className="shrink-0 text-[10px] uppercase tracking-wide text-amber-500 hover:text-amber-400 px-1 py-0.5">
                                      Reset
                                    </button>
                                  )}
                                </div>
                              </td>
                            );
                          })()}
                          <td className="px-1.5 py-1"><input value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="—" className={cell} /></td>
                          {cfg.mode === "lineItems" && <td className="px-1.5 py-1"><CalcInput value={l.qty} onChange={v => recompute(i, { qty: v })} className={`${cell} text-right tabular-nums`} /></td>}
                          {cfg.mode === "lineItems" && <td className="px-1.5 py-1"><CalcInput value={l.rate} onChange={v => recompute(i, { rate: v })} className={`${cell} text-right tabular-nums`} /></td>}
                          <td className="px-1.5 py-1"><CalcInput value={l.amount} onChange={v => setLine(i, { amount: v })} className={`${cell} text-right tabular-nums font-medium`} /></td>
                          {cfg.tax && (
                            <td className="px-1.5 py-1">
                              <CellSelect value={taxSelectValue(l)} onChange={e => onTaxChange(i, e.target.value)}>
                                <option value="">No tax</option>
                                {taxCodes.length > 0 && (
                                  <optgroup label="Tax codes">
                                    {taxCodes.map(c => <option key={c.id} value={`code:${c.id}`}>{c.name}</option>)}
                                  </optgroup>
                                )}
                                <optgroup label={taxCodes.length > 0 ? "Tax rates (legacy)" : "Tax rates"}>
                                  {taxes.map(t => <option key={t.id} value={`rate:${t.id}`}>{t.name} ({Number(t.rate)}%)</option>)}
                                </optgroup>
                                <option value={ADD}>+ Add new tax rate…</option>
                              </CellSelect>
                            </td>
                          )}
                          {showDims && classes.length > 0 && (
                            <td className="px-1.5 py-1">
                              <CellSelect value={l.classId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "class", lineIndex: i }) : setLine(i, { classId: e.target.value })}>
                                <option value="">—</option>
                                {classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                <option value={ADD}>+ Add new class…</option>
                              </CellSelect>
                            </td>
                          )}
                          {showDims && locations.length > 0 && (
                            <td className="px-1.5 py-1">
                              <CellSelect value={l.locationId} onChange={e => e.target.value === ADD ? setQuickAdd({ kind: "location", lineIndex: i }) : setLine(i, { locationId: e.target.value })}>
                                <option value="">—</option>
                                {locations.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                                <option value={ADD}>+ Add new location…</option>
                              </CellSelect>
                            </td>
                          )}
                          <td className="px-1 py-1 text-center">
                            {lines.length > 1 && <button onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} title="Remove line" className="p-1 rounded-md text-stone-600 opacity-0 group-hover:opacity-100 hover:bg-stone-800 hover:text-rose-400 transition"><Trash2 size={14} /></button>}
                          </td>
                        </tr>
                        {showLot && (
                          <tr className="border-b border-stone-800/50">
                            <td></td>
                            <td colSpan={20} className="px-2 pb-2 pt-0">
                              <div className="flex items-center gap-2 flex-wrap text-[11px] text-stone-500">
                                <span className="uppercase tracking-wide text-emerald-500/70 font-medium">Receive to lot</span>
                                {isFPWIP(lineItem) ? (
                                  <input value="assigned automatically" disabled className={`${cell} !w-40 opacity-60`} />
                                ) : (
                                  <input value={l.lotNo ?? ""} onChange={e => setLine(i, { lotNo: e.target.value })} placeholder="Lot / batch no." className={`${cell} !w-40`} />
                                )}
                                <span className="text-stone-600">expiry</span>
                                <input type="date" value={l.expiryDate ?? ""} onChange={e => setLine(i, { expiryDate: e.target.value })} className={`${cell} !w-40`} />
                                <span className="text-stone-600">— creates a FIFO cost lot for {lineItem?.name}</span>
                              </div>
                            </td>
                          </tr>
                        )}
                        </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-stone-800/70 px-2 py-1.5 flex items-center justify-between gap-3">
                  <button onClick={() => setLines(ls => [...ls, emptyLine()])} className="inline-flex items-center gap-1.5 text-[12px] font-medium text-stone-400 hover:text-emerald-400 px-2 py-1 rounded-md hover:bg-stone-800/60 transition">
                    <Plus size={13} /> Add line
                  </button>
                  {/* Say what is being hidden and why. A narrowed picker that
                      explains itself is a help; one that silently omits an item
                      is the user hunting for something they know exists. */}
                  {showItemCol && (hiddenItemCount > 0 || showAllItems) && (
                    <div className="text-[11px] text-stone-500 pr-1">
                      {showAllItems
                        ? <>Showing all {items.length} items. </>
                        : <>Showing {visibleItems.length} of {items.length} items
                            {cfg.side === "purchase" && selectedParty ? <> for {selectedParty.name}</> : null}. </>}
                      <button
                        onClick={() => setShowAllItems(v => !v)}
                        className="font-medium text-stone-400 hover:text-emerald-400 underline underline-offset-2 transition"
                      >{showAllItems ? "Show linked only" : "Show all items"}</button>
                    </div>
                  )}
                </div>
              </div>
            </Section>
          )}
          {cfg.mode === "deposit" && availablePayments.length > 0 && (
            <Section title="Swept payments (optional)">
              <p className="text-[11px] text-stone-500 -mt-1 mb-1">
                Link this deposit to payments it physically bundles — for traceability only, it doesn&rsquo;t change either posting.
              </p>
              <div className="rounded-lg border border-stone-800/80 bg-stone-900/40 max-h-48 overflow-y-auto divide-y divide-stone-800/50">
                {availablePayments.map(p => {
                  const checked = sweptPaymentIds.includes(p.id);
                  return (
                    <label key={p.id} className="flex items-center gap-2.5 px-3 py-2 text-[12.5px] hover:bg-stone-900/60 cursor-pointer">
                      <input type="checkbox" checked={checked}
                        onChange={() => setSweptPaymentIds(ids => checked ? ids.filter(x => x !== p.id) : [...ids, p.id])}
                        className="rounded border-stone-700 bg-stone-800 text-emerald-500 focus:ring-emerald-500/40" />
                      <span className="text-stone-300 font-medium">{p.docNumber}</span>
                      <span className="text-stone-600">{p.date}</span>
                      {p.party && <span className="text-stone-500">{p.party}</span>}
                      <span className="ml-auto tabular-nums text-stone-300">{money(p.amount)}</span>
                    </label>
                  );
                })}
              </div>
            </Section>
          )}
          {isReturnable && (
            <label className="flex items-start gap-2.5 rounded-lg border border-stone-800 px-3 py-2.5 cursor-pointer max-w-2xl">
              <input type="checkbox" checked={goodsReturned} onChange={e => setGoodsReturned(e.target.checked)} className="accent-emerald-600 mt-0.5" />
              <div>
                <div className="text-[13px] font-medium text-stone-200">{type === "VendorCredit" ? "Goods returned to the supplier" : "Goods returned by the customer"}</div>
                <p className="text-[12px] text-stone-400">
                  {type === "VendorCredit"
                    ? "Stocked items leave the lots this supplier supplied, at their cost; any difference from the credit goes to purchase price variance. Leave unticked for a price credit."
                    : "Stocked items go back into the lots they were sold from, at their cost, and the cost of sale is reversed. Leave unticked for a price credit."}
                </p>
              </div>
            </label>
          )}
          {/* Memo + totals */}
          <div className="flex flex-wrap items-start justify-between gap-5 pt-1">
            <Field label="Memo" className="flex-1 min-w-[240px]">
              <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Internal note (optional)" className={input} />
            </Field>
            {(cfg.mode === "lineItems") && (
              <div className="w-64 rounded-lg border border-stone-800/80 bg-stone-900/40 p-4 text-[13px] space-y-2">
                <div className="flex justify-between text-stone-400"><span>Subtotal</span><span className="tabular-nums text-stone-200">{money(totals.net)}</span></div>
                {cfg.tax && <div className="flex justify-between text-stone-400"><span>Tax</span><span className="tabular-nums text-stone-200">{money(totals.tax)}</span></div>}
                <div className="flex justify-between items-baseline border-t border-stone-800 pt-2 mt-1"><span className="text-stone-300 font-medium">Total</span><span className="tabular-nums text-[18px] font-semibold text-white">{money(totals.total)} <span className="text-[12px] font-normal text-stone-500">{currency || home}</span></span></div>
              </div>
            )}
            {(cfg.mode === "deposit" || cfg.mode === "payment" || cfg.mode === "transfer") && (
              <div className="w-56 rounded-lg border border-stone-800/80 bg-stone-900/40 p-4 text-[13px]">
                <div className="flex justify-between items-baseline"><span className="text-stone-300 font-medium">Total</span><span className="tabular-nums text-[18px] font-semibold text-white">{money(totals.total)} <span className="text-[12px] font-normal text-stone-500">{currency || home}</span></span></div>
              </div>
            )}
          </div>

          </div>
          </fieldset>
          {afterContent}
          </>
        )}
        </div>

        {/* Footer */}
        {!loading && (
          <div className="flex items-center justify-end gap-3 px-6 py-3 border-t border-stone-800 bg-stone-900 shrink-0">
            {readOnly ? (
              <button onClick={close} className="px-4 py-2 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-[13px] font-medium">Close</button>
            ) : (
              <>
                <button onClick={close} className="text-[13px] text-stone-400 hover:text-stone-200 px-3 py-2">Cancel</button>
                <button onClick={submit} disabled={posting} className="px-6 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[13px] font-semibold disabled:opacity-50 inline-flex items-center gap-2">
                  {posting ? <Loader size={14} className="animate-spin" /> : <Check size={15} />} {editId ? "Save changes" : cfg.submit}
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {quickAdd && (quickAdd.kind === "customer" || quickAdd.kind === "supplier") && (
        <PartyDrawer type={quickAdd.kind === "customer" ? "customers" : "suppliers"} elevated
          onClose={() => setQuickAdd(null)} onCreated={onQuickCreated} />
      )}
      {quickAdd && quickAdd.kind === "item" && (
        <NewItemDrawer initialProductType="Service" elevated simple
          onClose={() => setQuickAdd(null)} onCreated={onQuickCreated} />
      )}
      {quickAdd && quickAdd.kind !== "customer" && quickAdd.kind !== "supplier" && quickAdd.kind !== "item" && (
        <QuickAdd kind={quickAdd.kind}
          onClose={() => setQuickAdd(null)} onCreated={onQuickCreated} />
      )}
    </div>
  );
}
