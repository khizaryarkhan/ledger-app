import { db } from "@/db";
import { users, customers, contacts, projects, invoices, communications, tasks } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, count } from "drizzle-orm";

const today = () => new Date().toISOString().slice(0, 10);
const daysFrom = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export async function POST() {
  // Seed is a demo-data utility — block it completely in production to
  // prevent accidental data insertion into live databases.
  if (process.env.NODE_ENV === "production") {
    return bad("Seed endpoint is disabled in production", 403);
  }

  const { error, session, orgId, role } = await requireOrg();
  if (error) return error;

  // Role check must use the value returned by requireOrg() — the JWT claim
  // may differ from what is stored in the DB. "Admin" is not a valid role
  // name; accepted values are "company_admin" and "super_admin".
  if (role !== "company_admin" && role !== "super_admin") {
    return bad("Only company admins can seed demo data", 403);
  }

  if (!orgId) return bad("No active organisation", 400);

  const userId = (session!.user as any).id;

  // Insert customers
  const custRows = await db.insert(customers).values([
    { orgId, name: "Atlas Logistics Ltd", code: "ATL001", country: "Ireland", currency: "EUR", paymentTerms: 30, taxNumber: "IE1234567T", riskRating: "Low", status: "Active", creditLimit: 250000, accountOwnerId: userId, collectionOwnerId: userId, notes: "Long-standing customer, pays consistently on time." },
    { orgId, name: "Northwind Industries", code: "NWI002", country: "United Kingdom", currency: "GBP", paymentTerms: 45, taxNumber: "GB987654321", riskRating: "Medium", status: "Active", creditLimit: 500000, accountOwnerId: userId, collectionOwnerId: userId, notes: "Recently slow on payments, monitor closely." },
    { orgId, name: "Helios Tech Group", code: "HTG003", country: "Germany", currency: "EUR", paymentTerms: 30, taxNumber: "DE445566778", riskRating: "Low", status: "Active", creditLimit: 750000, accountOwnerId: userId, collectionOwnerId: userId },
    { orgId, name: "Coastal Marine Services", code: "CMS004", country: "Ireland", currency: "EUR", paymentTerms: 30, taxNumber: "IE2233445T", riskRating: "High", status: "Active", creditLimit: 100000, accountOwnerId: userId, collectionOwnerId: userId, notes: "Disputed invoice from Q3 still unresolved." },
    { orgId, name: "Verdant Agri Co-op", code: "VAC005", country: "Ireland", currency: "EUR", paymentTerms: 60, taxNumber: "IE9988776T", riskRating: "Medium", status: "Active", creditLimit: 180000, accountOwnerId: userId, collectionOwnerId: userId },
    { orgId, name: "Quantum Dynamics SA", code: "QDS006", country: "France", currency: "EUR", paymentTerms: 30, taxNumber: "FR12345678901", riskRating: "Low", status: "Active", creditLimit: 350000, accountOwnerId: userId, collectionOwnerId: userId },
    { orgId, name: "Bryson Holdings", code: "BRY007", country: "Ireland", currency: "EUR", paymentTerms: 30, taxNumber: "IE5544332T", riskRating: "High", status: "On Hold", creditLimit: 75000, accountOwnerId: userId, collectionOwnerId: userId, notes: "Account on hold pending dispute resolution." },
    { orgId, name: "Solstice Media Group", code: "SMG008", country: "United Kingdom", currency: "GBP", paymentTerms: 30, taxNumber: "GB112233445", riskRating: "Low", status: "Active", creditLimit: 200000, accountOwnerId: userId, collectionOwnerId: userId },
  ]).returning();

  const c = (code: string) => custRows.find(x => x.code === code)!.id;

  // Contacts
  await db.insert(contacts).values([
    { orgId, customerId: c("ATL001"), name: "Eoin Walsh", title: "AP Manager", email: "e.walsh@atlaslogistics.ie", phone: "+353 1 555 0101", type: "Billing", isPrimary: true, isEscalation: false, receivesAuto: true },
    { orgId, customerId: c("ATL001"), name: "Niamh Kelly", title: "CFO", email: "n.kelly@atlaslogistics.ie", phone: "+353 1 555 0102", type: "Escalation", isPrimary: false, isEscalation: true, receivesAuto: false },
    { orgId, customerId: c("NWI002"), name: "Margaret Whitfield", title: "Accounts Payable", email: "m.whitfield@northwind.co.uk", phone: "+44 20 7946 0102", type: "Billing", isPrimary: true, receivesAuto: true },
    { orgId, customerId: c("NWI002"), name: "David Pemberton", title: "Finance Director", email: "d.pemberton@northwind.co.uk", phone: "+44 20 7946 0103", type: "Escalation", isEscalation: true, receivesAuto: false },
    { orgId, customerId: c("HTG003"), name: "Klaus Reinhardt", title: "Buchhalter", email: "k.reinhardt@heliostech.de", phone: "+49 30 1234 5678", type: "Billing", isPrimary: true, receivesAuto: true },
    { orgId, customerId: c("CMS004"), name: "Brendan Hayes", title: "Operations Manager", email: "b.hayes@coastalmarine.ie", phone: "+353 21 555 0301", type: "Billing", isPrimary: true, receivesAuto: true },
    { orgId, customerId: c("VAC005"), name: "Liam Brennan", title: "Treasurer", email: "l.brennan@verdantagri.ie", phone: "+353 56 555 0401", type: "Billing", isPrimary: true, receivesAuto: true },
    { orgId, customerId: c("QDS006"), name: "Camille Laurent", title: "Responsable Comptabilité", email: "c.laurent@quantumdyn.fr", phone: "+33 1 42 86 8200", type: "Billing", isPrimary: true, receivesAuto: true },
    { orgId, customerId: c("BRY007"), name: "Patrick Bryson", title: "Owner", email: "p.bryson@brysonholdings.ie", phone: "+353 1 555 0701", type: "Billing", isPrimary: true, receivesAuto: false },
    { orgId, customerId: c("SMG008"), name: "Olivia Standish", title: "Finance Lead", email: "o.standish@solsticemedia.co.uk", phone: "+44 20 7946 0801", type: "Billing", isPrimary: true, receivesAuto: true },
  ]);

  // Projects
  const projRows = await db.insert(projects).values([
    { orgId, customerId: c("ATL001"), name: "Fleet Modernisation 2025", code: "ATL-FM25", ownerId: userId, status: "Active" },
    { orgId, customerId: c("ATL001"), name: "Warehouse Integration", code: "ATL-WH", ownerId: userId, status: "Active" },
    { orgId, customerId: c("NWI002"), name: "Supply Chain Platform", code: "NWI-SCP", ownerId: userId, status: "Active" },
    { orgId, customerId: c("HTG003"), name: "Cloud Migration Phase II", code: "HTG-CM2", ownerId: userId, status: "Active" },
    { orgId, customerId: c("HTG003"), name: "Security Audit", code: "HTG-SEC", ownerId: userId, status: "Completed" },
    { orgId, customerId: c("CMS004"), name: "Vessel Inspection Q3", code: "CMS-VI3", ownerId: userId, status: "Active" },
    { orgId, customerId: c("VAC005"), name: "Harvest Logistics", code: "VAC-HL", ownerId: userId, status: "Active" },
    { orgId, customerId: c("QDS006"), name: "Data Centre Expansion", code: "QDS-DC", ownerId: userId, status: "Active" },
    { orgId, customerId: c("SMG008"), name: "Brand Refresh Campaign", code: "SMG-BR", ownerId: userId, status: "Active" },
  ]).returning();

  const p = (code: string) => projRows.find(x => x.code === code)?.id;

  // Invoices
  const invRows = await db.insert(invoices).values([
    { orgId, invoiceNumber: "INV-2025-1042", customerId: c("ATL001"), projectId: p("ATL-FM25"), invoiceDate: daysFrom(-15), dueDate: daysFrom(15), currency: "EUR", amount: 18500, taxAmount: 4255, total: 22755, paid: 0, paymentTerms: 30, paymentStatus: "Unpaid", collectionStage: "Reminder Scheduled", collectionOwnerId: userId, poNumber: "PO-AT-8821" },
    { orgId, invoiceNumber: "INV-2025-1043", customerId: c("ATL001"), projectId: p("ATL-WH"), invoiceDate: daysFrom(-45), dueDate: daysFrom(-15), currency: "EUR", amount: 32000, taxAmount: 7360, total: 39360, paid: 0, paymentTerms: 30, paymentStatus: "Unpaid", collectionStage: "Reminder Sent", collectionOwnerId: userId, poNumber: "PO-AT-8845", lastFollowupDate: daysFrom(-3) },
    { orgId, invoiceNumber: "INV-2025-1051", customerId: c("NWI002"), projectId: p("NWI-SCP"), invoiceDate: daysFrom(-72), dueDate: daysFrom(-27), currency: "GBP", amount: 47800, taxAmount: 9560, total: 57360, paid: 0, paymentTerms: 45, paymentStatus: "Unpaid", collectionStage: "Awaiting Reply", collectionOwnerId: userId, poNumber: "PO-NW-2201", notes: "Customer indicated review delay.", lastFollowupDate: daysFrom(-7) },
    { orgId, invoiceNumber: "INV-2025-1052", customerId: c("NWI002"), projectId: p("NWI-SCP"), invoiceDate: daysFrom(-95), dueDate: daysFrom(-50), currency: "GBP", amount: 28400, taxAmount: 5680, total: 34080, paid: 0, paymentTerms: 45, paymentStatus: "Unpaid", collectionStage: "Promise to Pay", collectionOwnerId: userId, poNumber: "PO-NW-2215", lastFollowupDate: daysFrom(-5), promiseDate: daysFrom(7) },
    { orgId, invoiceNumber: "INV-2025-1067", customerId: c("HTG003"), projectId: p("HTG-CM2"), invoiceDate: daysFrom(-25), dueDate: daysFrom(5), currency: "EUR", amount: 65000, taxAmount: 12350, total: 77350, paid: 0, paymentTerms: 30, paymentStatus: "Unpaid", collectionStage: "New", collectionOwnerId: userId, poNumber: "PO-HT-5512" },
    { orgId, invoiceNumber: "INV-2025-1058", customerId: c("HTG003"), projectId: p("HTG-SEC"), invoiceDate: daysFrom(-40), dueDate: daysFrom(-10), currency: "EUR", amount: 12500, taxAmount: 2375, total: 14875, paid: 14875, paymentTerms: 30, paymentStatus: "Paid", collectionStage: "Closed", collectionOwnerId: userId, poNumber: "PO-HT-5498" },
    { orgId, invoiceNumber: "INV-2025-1071", customerId: c("CMS004"), projectId: p("CMS-VI3"), invoiceDate: daysFrom(-60), dueDate: daysFrom(-30), currency: "EUR", amount: 8400, taxAmount: 1932, total: 10332, paid: 0, paymentTerms: 30, paymentStatus: "Unpaid", collectionStage: "Disputed", collectionOwnerId: userId, poNumber: "PO-CM-1101", notes: "Customer disputes scope of work.", disputeReason: "Scope disagreement on inspection deliverables", disputeDate: daysFrom(-20) },
    { orgId, invoiceNumber: "INV-2025-1075", customerId: c("VAC005"), projectId: p("VAC-HL"), invoiceDate: daysFrom(-10), dueDate: daysFrom(50), currency: "EUR", amount: 22000, taxAmount: 5060, total: 27060, paid: 0, paymentTerms: 60, paymentStatus: "Unpaid", collectionStage: "New", collectionOwnerId: userId, poNumber: "PO-VA-3301" },
    { orgId, invoiceNumber: "INV-2025-1080", customerId: c("QDS006"), projectId: p("QDS-DC"), invoiceDate: daysFrom(-22), dueDate: daysFrom(8), currency: "EUR", amount: 95000, taxAmount: 19000, total: 114000, paid: 0, paymentTerms: 30, paymentStatus: "Unpaid", collectionStage: "Reminder Scheduled", collectionOwnerId: userId, poNumber: "PO-QD-7701" },
    { orgId, invoiceNumber: "INV-2025-1081", customerId: c("QDS006"), projectId: p("QDS-DC"), invoiceDate: daysFrom(-50), dueDate: daysFrom(-20), currency: "EUR", amount: 47500, taxAmount: 9500, total: 57000, paid: 25000, paymentTerms: 30, paymentStatus: "Partially Paid", collectionStage: "Awaiting Reply", collectionOwnerId: userId, poNumber: "PO-QD-7715", notes: "Partial payment received.", lastFollowupDate: daysFrom(-4) },
    { orgId, invoiceNumber: "INV-2025-1090", customerId: c("BRY007"), projectId: null, invoiceDate: daysFrom(-80), dueDate: daysFrom(-50), currency: "EUR", amount: 15600, taxAmount: 3588, total: 19188, paid: 0, paymentTerms: 30, paymentStatus: "Unpaid", collectionStage: "Escalated", collectionOwnerId: userId, notes: "Account on hold." },
    { orgId, invoiceNumber: "INV-2025-1095", customerId: c("SMG008"), projectId: p("SMG-BR"), invoiceDate: daysFrom(-18), dueDate: daysFrom(12), currency: "GBP", amount: 18900, taxAmount: 3780, total: 22680, paid: 0, paymentTerms: 30, paymentStatus: "Unpaid", collectionStage: "New", collectionOwnerId: userId, poNumber: "PO-SM-9901" },
    { orgId, invoiceNumber: "INV-2025-1099", customerId: c("SMG008"), projectId: p("SMG-BR"), invoiceDate: daysFrom(-55), dueDate: daysFrom(-25), currency: "GBP", amount: 14200, taxAmount: 2840, total: 17040, paid: 0, paymentTerms: 30, paymentStatus: "Unpaid", collectionStage: "Reminder Sent", collectionOwnerId: userId, poNumber: "PO-SM-9912", lastFollowupDate: daysFrom(-2) },
    { orgId, invoiceNumber: "INV-2025-1110", customerId: c("NWI002"), projectId: p("NWI-SCP"), invoiceDate: daysFrom(-5), dueDate: daysFrom(40), currency: "GBP", amount: 36500, taxAmount: 7300, total: 43800, paid: 0, paymentTerms: 45, paymentStatus: "Unpaid", collectionStage: "New", collectionOwnerId: userId, poNumber: "PO-NW-2230" },
  ]).returning();

  const inv = (num: string) => invRows.find(x => x.invoiceNumber === num)?.id;

  // Tasks
  await db.insert(tasks).values([
    { orgId, invoiceId: inv("INV-2025-1071"), customerId: c("CMS004"), title: "Review dispute documentation", description: "Pull surveyor reports for vessel inspection job", assigneeId: userId, dueDate: daysFrom(2), priority: "High", labels: ["Dispute"] },
    { orgId, invoiceId: inv("INV-2025-1052"), customerId: c("NWI002"), title: "Confirm payment receipt", description: "Check bank statement Friday for Northwind payment", assigneeId: userId, dueDate: daysFrom(7), priority: "Medium", labels: ["Promise to Pay"] },
    { orgId, invoiceId: inv("INV-2025-1090"), customerId: c("BRY007"), title: "Escalate to legal team", description: "Bryson Holdings - account on hold for 80+ days", assigneeId: userId, dueDate: daysFrom(1), priority: "Urgent", labels: ["Legal", "Escalation"] },
    { orgId, invoiceId: inv("INV-2025-1080"), customerId: c("QDS006"), title: "Pre-due call to Quantum Dynamics", description: "High value invoice — courtesy call before due date", assigneeId: userId, dueDate: daysFrom(5), priority: "Medium", labels: ["High Value"] },
  ]);

  return ok({ message: "Demo data loaded", customers: custRows.length, invoices: invRows.length });
}
