import { db } from "@/db";
import { apApprovalTokens, apBills, apBillLines, apSuppliers, organisations, apBillComments } from "@/db/schema";
import { eq, and, asc, inArray } from "drizzle-orm";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// GET /api/approver/[token]
export async function GET(req: Request, { params }: { params: { token: string } }) {
  // Rate-limit by IP: 60 lookups per minute — prevents token enumeration
  const rl = await rateLimit(`approver-get:${clientIp(req)}`, 60, 60);
  if (!rl.ok) return Response.json({ error: "Too many requests" }, { status: 429 });
  const [tokenRow] = await db.select().from(apApprovalTokens)
    .where(eq(apApprovalTokens.token, params.token))
    .limit(1);

  if (!tokenRow) return Response.json({ error: "Invalid link" }, { status: 410 });
  if (tokenRow.expiresAt < new Date()) return Response.json({ error: "This approval link has expired." }, { status: 410 });
  if (tokenRow.status !== "Pending") {
    return Response.json({
      error: null,
      alreadyDecided: true,
      status: tokenRow.status,
      decision: tokenRow.decision,
      submittedAt: tokenRow.submittedAt,
    });
  }

  // Resolve which bill IDs to show — prefer billIds[] array, fall back to single billId
  const billIds: string[] = (tokenRow.billIds && (tokenRow.billIds as string[]).length > 0)
    ? (tokenRow.billIds as string[])
    : (tokenRow.billId ? [tokenRow.billId] : []);

  if (billIds.length === 0) return Response.json({ error: "No bills found for this token" }, { status: 404 });

  // Load all bills in the batch
  const bills = await db.select().from(apBills)
    .where(and(inArray(apBills.id, billIds), eq(apBills.orgId, tokenRow.orgId)));

  if (bills.length === 0) return Response.json({ error: "Bills not found" }, { status: 404 });

  // Load lines for all bills
  const lines = await db.select().from(apBillLines)
    .where(inArray(apBillLines.billId, billIds))
    .orderBy(asc(apBillLines.billId), asc(apBillLines.lineNumber));

  // Load unique suppliers
  const supplierIds = [...new Set(bills.map(b => b.supplierId).filter(Boolean))] as string[];
  const suppliers = supplierIds.length > 0
    ? await db.select().from(apSuppliers).where(inArray(apSuppliers.id, supplierIds))
    : [];
  const supplierById = Object.fromEntries(suppliers.map(s => [s.id, s]));

  const [org] = await db.select({
    name: organisations.name,
    displayName: organisations.displayName,
    logoUrl: organisations.logoUrl,
  }).from(organisations).where(eq(organisations.id, tokenRow.orgId)).limit(1);

  // Comments visible to approver — all bills in the batch, exclude internal
  const comments = await db.select().from(apBillComments)
    .where(and(inArray(apBillComments.billId, billIds), eq(apBillComments.orgId, tokenRow.orgId)))
    .orderBy(asc(apBillComments.createdAt));
  const visibleComments = comments.filter(c => c.channel !== "internal");

  return Response.json({
    org: {
      name: org?.displayName || org?.name || "Finance Team",
      logoUrl: org?.logoUrl ?? null,
    },
    token: {
      approverEmail: tokenRow.approverEmail,
      approverName: tokenRow.approverName,
    },
    bills: bills.map(bill => ({
      id: bill.id,
      billNumber: bill.billNumber,
      billDate: bill.billDate,
      dueDate: bill.dueDate,
      currency: bill.currency,
      subtotal: bill.subtotal,
      taxTotal: bill.taxTotal,
      total: bill.total,
      balance: bill.balance,
      privateNote: bill.privateNote,
      workflowStatus: bill.workflowStatus,
      supplier: bill.supplierId ? (supplierById[bill.supplierId] ? { name: supplierById[bill.supplierId].name, email: supplierById[bill.supplierId].email } : null) : null,
      lines: lines.filter(l => l.billId === bill.id),
    })),
    comments: visibleComments,
  });
}
