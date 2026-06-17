import { db } from "@/db";
import { apApprovalTokens, apBills, apBillLines, apSuppliers, organisations, apBillComments } from "@/db/schema";
import { eq, and, asc } from "drizzle-orm";

// GET /api/approver/[token]
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const [tokenRow] = await db.select().from(apApprovalTokens)
    .where(eq(apApprovalTokens.token, params.token))
    .limit(1);

  if (!tokenRow) {
    return Response.json({ error: "Invalid link" }, { status: 410 });
  }
  if (tokenRow.expiresAt < new Date()) {
    return Response.json({ error: "This approval link has expired." }, { status: 410 });
  }
  if (tokenRow.status !== "Pending") {
    return Response.json({
      error: null,
      alreadyDecided: true,
      status: tokenRow.status,
      decision: tokenRow.decision,
      submittedAt: tokenRow.submittedAt,
    });
  }

  const [bill] = await db.select().from(apBills)
    .where(eq(apBills.id, tokenRow.billId))
    .limit(1);
  if (!bill) return Response.json({ error: "Bill not found" }, { status: 404 });

  const lines = await db.select().from(apBillLines)
    .where(eq(apBillLines.billId, bill.id))
    .orderBy(asc(apBillLines.lineNumber));

  let supplier = null;
  if (bill.supplierId) {
    const [s] = await db.select().from(apSuppliers)
      .where(eq(apSuppliers.id, bill.supplierId))
      .limit(1);
    supplier = s ?? null;
  }

  const [org] = await db.select({
    name: organisations.name,
    displayName: organisations.displayName,
    logoUrl: organisations.logoUrl,
  }).from(organisations).where(eq(organisations.id, tokenRow.orgId)).limit(1);

  // Comments visible to approver (system + approver + email channels only — not internal)
  const comments = await db.select().from(apBillComments)
    .where(and(eq(apBillComments.billId, bill.id), eq(apBillComments.orgId, tokenRow.orgId)))
    .orderBy(asc(apBillComments.createdAt));

  const visibleComments = comments.filter((c) => c.channel !== "internal");

  return Response.json({
    org: {
      name: org?.displayName || org?.name || "Finance Team",
      logoUrl: org?.logoUrl ?? null,
    },
    token: tokenRow,
    bill: {
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
    },
    supplier: supplier ? { name: supplier.name, email: supplier.email } : null,
    lines,
    comments: visibleComments,
  });
}
