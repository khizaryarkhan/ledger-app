// Fixture data for the preview harness. Shapes mirror src/api/types.ts — if a
// screen changes what it reads, change it here and the preview keeps working.
// Numbers are deliberately realistic (mixed currencies, long customer names,
// broken promises, disputes) so layout is exercised, not just happy-path.

const d = (o) => { const x = new Date(Date.now() + o * 86400000); return x.toISOString().slice(0, 10); };
const t = (h) => new Date(Date.now() - h * 3600000).toISOString();

export const USER = { id: "u1", email: "aidan@edcengineers.com", name: "Aidan Kelly" };
export const ORGS = [
  { id: "o1", name: "EDC Engineering Design Consultants" },
  { id: "o2", name: "EDC Structural (Cork)" },
];

const inv = (n, cust, proj, ccy, bal, days, stage, extra = {}) => ({
  id: `i${n}`, invoiceNumber: `D26${String(n).padStart(3, "0")}`,
  customerId: `c${n % 5}`, customerName: cust, projectName: proj,
  currency: ccy, total: bal * 1.18, balance: bal,
  dueDate: d(-days), daysOverdue: days,
  stage, stageLabel: stage, paymentStatus: "Unpaid",
  promiseDate: null, promiseBroken: false, disputeReason: null,
  hasOpenDispute: false, escalatedTo: null, isCreditMemo: false, isOpen: true,
  ...extra,
});

export const INVOICES = [
  inv(1, "John Paul Construction Dublin", "Parkwest D & E", "EUR", 358830, 78, "Reminder Sent"),
  inv(2, "Glenveagh Homes Ltd", "Ford Podium 2", "EUR", 76252, 171, "Escalated",
      { escalatedTo: "Richard C.", stage: "Escalated", stageLabel: "Escalated" }),
  inv(3, "LDA", "Dyke Road Residential", "EUR", 20910, 151, "Committed",
      { promiseDate: d(6), stage: "Committed", stageLabel: "Committed" }),
  inv(4, "Amhola Capital Limited", "Gorey Nursing Homes", "EUR", 14945, 65, "Disputed",
      { hasOpenDispute: true, disputeReason: "Wrong Amount", stage: "Disputed", stageLabel: "Disputed" }),
  inv(5, "Visionbuilt", null, "GBP", 3910, 64, "Committed",
      { promiseDate: d(-9), promiseBroken: true, stage: "Committed", stageLabel: "Committed" }),
  inv(6, "Mowlam Tralee Nursing Home Redesign", "Phase 2", "EUR", 6089, 12, "New"),
  inv(7, "Rolestown Amhola Nursing Homes", null, "EUR", 6396, 3, "Reminder Sent"),
];

export const SUMMARY = {
  rep: { id: "r1", name: "Aidan Kelly", tier: "Rep", managerId: null },
  scoped: true,
  totals: { totalAR: 487332, overdueAR: 402211, overdueCount: 6, openCount: 7, unappliedCredits: 1240 },
  aging: { current: 85121, d30: 6089, d60: 21341, d90: 379820, d90plus: 0, total: 487332 },
  stages: [
    { label: "New", count: 1 }, { label: "Reminder Sent", count: 2 },
    { label: "Committed", count: 2 }, { label: "Disputed", count: 1 }, { label: "Escalated", count: 1 },
  ],
  stageOptions: [
    { key: "New", label: "New", isClosed: false },
    { key: "Reminder Sent", label: "Reminder Sent", isClosed: false },
    { key: "Promised", label: "Committed", isClosed: false },
    { key: "Disputed", label: "Disputed", isClosed: false },
    { key: "Escalated", label: "Escalated", isClosed: false },
    { key: "Closed", label: "Closed", isClosed: true },
  ],
};

export const TODAY = {
  scoped: true, actionable: 4,
  sections: [
    { key: "broken", title: "Broken commitments", blurb: "Promised a date and missed it", tone: "danger",
      count: 1, value: 3910, invoices: [INVOICES[4]] },
    { key: "disputes", title: "Open disputes", blurb: "Blocked until resolved", tone: "dispute",
      count: 1, value: 14945, invoices: [INVOICES[3]] },
    { key: "due", title: "Promises due this week", blurb: "Confirm before the date passes", tone: "promise",
      count: 1, value: 20910, invoices: [INVOICES[2]] },
    { key: "escalated", title: "Escalated", blurb: "With an owner, awaiting outcome", tone: "warn",
      count: 1, value: 76252, invoices: [INVOICES[1]] },
  ],
};

export const ALERTS = {
  since: t(72), actionable: 3,
  alerts: [
    { id: "a1", kind: "broken", tone: "danger", title: "Visionbuilt missed a promised date",
      body: "Promised 9 days ago — no payment received.", at: t(2), actionable: true,
      invoiceId: "i5", invoiceNumber: "D26005", customerName: "Visionbuilt", currency: "GBP", balance: 3910 },
    { id: "a2", kind: "dispute", tone: "dispute", title: "Dispute raised — Wrong Amount",
      body: "Amhola Capital queried the total on D26004.", at: t(9), actionable: true,
      invoiceId: "i4", invoiceNumber: "D26004", customerName: "Amhola Capital Limited", currency: "EUR", balance: 14945 },
    { id: "a3", kind: "reply", tone: "promise", title: "Customer replied",
      body: "\"We'll process this in Friday's payment run.\"", at: t(26), actionable: true,
      invoiceId: "i1", invoiceNumber: "D26001", customerName: "John Paul Construction Dublin", currency: "EUR", balance: 358830 },
    { id: "a4", kind: "escalation", tone: "warn", title: "Escalated to Richard C.",
      body: "Final Account Agreement.", at: t(50), actionable: false,
      invoiceId: "i2", invoiceNumber: "D26002", customerName: "Glenveagh Homes Ltd", currency: "EUR", balance: 76252 },
  ],
};

export const DETAIL = {
  invoice: {
    ...INVOICES[3], customerEmail: "accounts@amhola.ie", hasPdf: true, paid: 0,
    invoiceDate: d(-95), poNumber: "PO-4471", notes: "Legacy debtor — RC chasing.",
    escalatedToName: null, escalatedToEmail: null,
  },
  contacts: [
    { id: "ct1", name: "Maria Byrne", email: "accounts@amhola.ie", phone: "+353 1 555 0142", isPrimary: true },
    { id: "ct2", name: "Sean O'Neill", email: "sean@amhola.ie", phone: null, isPrimary: false },
  ],
  promises: [
    { id: "p1", promiseDate: d(-20), amount: 7000, source: "Rep", note: "Part payment agreed on call.",
      status: "Broken", createdAt: t(600) },
  ],
  disputes: [
    { id: "ds1", category: "Wrong Amount", reason: "Retention not deducted", source: "Customer Portal",
      status: "Open", outcome: null, resolution: null, createdAt: t(200) },
  ],
  activity: [
    { id: "ac1", direction: "Inbound", channel: "Email", subject: "RE: Invoice D26004",
      body: "The amount doesn't match our order — retention should be 5%.", sentAt: t(200),
      sender: "accounts@amhola.ie", authorName: null },
    { id: "ac2", direction: "Outbound", channel: "Email", subject: "Invoice D26004 — payment request",
      body: "Please find attached a statement of your open invoices.", sentAt: t(320),
      sender: "aidan@edcengineers.com", authorName: "Aidan Kelly" },
    { id: "ac3", direction: "Outbound", channel: "Call", subject: "Called accounts",
      body: "Spoke to Maria — will review with QS and revert.", sentAt: t(500), sender: null, authorName: "Aidan Kelly" },
  ],
};

export const ESCALATIONS = {
  total: 76252, count: 1,
  invoices: [{
    id: "i2", invoiceNumber: "D26002", customerName: "Glenveagh Homes Ltd", projectName: "Ford Podium 2",
    currency: "EUR", balance: 76252, dueDate: d(-171), daysOverdue: 171,
    escalationType: "Final Account Agreement", escalatedToName: "Richard C.", escalatedAt: t(400),
  }],
};

export const CUSTOMERS = [
  { id: "c1", name: "John Paul Construction Dublin", code: "JPC", currency: "EUR", balance: 358830, overdue: 358830, openCount: 2, oldestDays: 78 },
  { id: "c2", name: "Glenveagh Homes Ltd", code: "GLV", currency: "EUR", balance: 118151, overdue: 96552, openCount: 4, oldestDays: 171 },
  { id: "c3", name: "LDA", code: null, currency: "EUR", balance: 252849, overdue: 171612, openCount: 6, oldestDays: 151 },
  { id: "c4", name: "Amhola Capital Limited", code: "AMH", currency: "EUR", balance: 14945, overdue: 14945, openCount: 4, oldestDays: 65 },
  { id: "c5", name: "Visionbuilt", code: "VSB", currency: "GBP", balance: 3910, overdue: 3910, openCount: 2, oldestDays: 64 },
];

export const OPEN_POS = [{
  id: "po1", docNumber: "PO-4471", partyId: "s1", partyLabel: "Kearney Steel Ltd",
  currency: "EUR", exchangeRate: 1, issueDate: d(-14), expiryDate: d(3),
  lines: [
    { lineId: "pl1", itemId: "it1", itemName: "Rebar 12mm", baseUom: "kg", orderUom: "bundle",
      packLevel: "Bundle", unitsPerOrderUnit: 50, rate: 1.42, orderedBaseQty: 2500, receivedQty: 1000,
      remainingQty: 1500, unitCostBase: 1.42 },
    { lineId: "pl2", itemId: "it2", itemName: "Structural mesh A393", baseUom: "sheet", orderUom: null,
      packLevel: null, unitsPerOrderUnit: null, rate: 38.5, orderedBaseQty: 120, receivedQty: 0,
      remainingQty: 120, unitCostBase: 38.5 },
  ],
}];

export const OPEN_SOS = [{
  id: "so1", docNumber: "SO-2210", partyId: "c1", partyLabel: "John Paul Construction Dublin",
  currency: "EUR", exchangeRate: 1, issueDate: d(-8), expiryDate: d(5),
  lines: [
    { lineId: "sl1", itemId: "it9", itemName: "Precast panel — Type B", baseUom: "ea",
      orderedBaseQty: 40, shippedQty: 12, remainingQty: 28, saleRateBase: 880, taxRateId: null },
  ],
}];

export const ITEMS = [
  { id: "it1", name: "Rebar 12mm", code: "RB12", baseUom: "kg", productType: "RawMaterial", status: "Active", unitCost: 1.42, onHandQty: 8400 },
  { id: "it2", name: "Structural mesh A393", code: "MSH", baseUom: "sheet", productType: "RawMaterial", status: "Active", unitCost: 38.5, onHandQty: 210 },
  { id: "it9", name: "Precast panel — Type B", code: "PPB", baseUom: "ea", productType: "FinishedProduct", status: "Active", unitCost: 610, onHandQty: 56 },
];

export const BOMS = [
  { id: "b1", name: "Precast panel — Type B", code: "BOM-PPB", outputItemId: "it9",
    outputItemName: "Precast panel — Type B", status: "Active", batchType: "Output",
    batchSize: "1", inputCount: 2, outputCount: 1 },
];

export const BOM_DETAIL = {
  bom: { ...BOMS[0], notes: "Cure 28 days.", processingStep: "Cast & cure", expYield: "98" },
  inputs: [
    { id: "bl1", itemId: "it1", qty: "42", uom: "kg", role: "input",
      item: { id: "it1", name: "Rebar 12mm", code: "RB12", productType: "RawMaterial", baseUom: "kg" } },
    { id: "bl2", itemId: "it2", qty: "3", uom: "sheet", role: "input",
      item: { id: "it2", name: "Structural mesh A393", code: "MSH", productType: "RawMaterial", baseUom: "sheet" } },
  ],
  outputs: [
    { id: "bl3", itemId: "it9", qty: "1", uom: "ea", role: "output",
      item: { id: "it9", name: "Precast panel — Type B", code: "PPB", productType: "FinishedProduct", baseUom: "ea" } },
  ],
};
