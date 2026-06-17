import { db } from "@/db";
import { apApprovalTokens, apBills, apBillComments, organisations } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";

// POST /api/approver/[token]/submit
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const [tokenRow] = await db.select().from(apApprovalTokens)
    .where(eq(apApprovalTokens.token, params.token))
    .limit(1);

  if (!tokenRow) return Response.json({ error: "Invalid link" }, { status: 410 });
  if (tokenRow.expiresAt < new Date()) return Response.json({ error: "This link has expired." }, { status: 410 });
  if (tokenRow.status !== "Pending") return Response.json({ error: "This bill has already been decided." }, { status: 409 });

  const body = await req.json().catch(() => ({}));
  const action = body.action; // "approve" | "reject"
  if (!["approve", "reject"].includes(action)) {
    return Response.json({ error: "action must be approve or reject" }, { status: 400 });
  }
  const comment = (body.comment ?? "").toString().trim().slice(0, 2000);
  if (action === "reject" && !comment) {
    return Response.json({ error: "A reason is required when rejecting." }, { status: 400 });
  }

  const now = new Date();
  const newStatus = action === "approve" ? "Approved" : "Rejected";
  const newWorkflow = action === "approve" ? "Approved" : "Rejected";

  // Mark token
  await db.update(apApprovalTokens)
    .set({ status: newStatus, decision: comment || null, submittedAt: now })
    .where(eq(apApprovalTokens.id, tokenRow.id));

  // Update bill
  await db.update(apBills)
    .set({
      workflowStatus: newWorkflow,
      ...(action === "approve" ? { approvedAt: now } : {}),
      updatedAt: now,
    })
    .where(eq(apBills.id, tokenRow.billId));

  // Log approver comment
  const [bill] = await db.select({ billNumber: apBills.billNumber, total: apBills.total, currency: apBills.currency })
    .from(apBills).where(eq(apBills.id, tokenRow.billId)).limit(1);

  const approverLabel = tokenRow.approverName ?? tokenRow.approverEmail;
  const commentBody = action === "approve"
    ? `Bill approved by ${approverLabel}${comment ? `\n\n"${comment}"` : ""}`
    : `Bill rejected by ${approverLabel}\n\nReason: ${comment}`;

  await db.insert(apBillComments).values({
    orgId: tokenRow.orgId,
    billId: tokenRow.billId,
    body: commentBody,
    authorName: approverLabel,
    channel: "approver",
  }).catch(() => {});

  // Notify org (if email transport available) — fire and forget
  try {
    const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName })
      .from(organisations).where(eq(organisations.id, tokenRow.orgId)).limit(1);
    const orgName = org?.displayName || org?.name || "Finance Team";
    const billLabel = bill?.billNumber ?? tokenRow.billId.slice(0, 8);
    const symbol = bill?.currency === "GBP" ? "£" : bill?.currency === "EUR" ? "€" : "$";
    const amtStr = bill ? `${symbol}${bill.total.toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}` : "";

    const htmlBody = `
      <div style="font-family:sans-serif;color:#1c1917;max-width:520px;margin:0 auto">
        <div style="background:${action === "approve" ? "#059669" : "#dc2626"};padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;font-size:16px;margin:0">
            Bill ${action === "approve" ? "Approved ✓" : "Rejected ✗"}
          </h2>
        </div>
        <div style="background:#fafaf9;border:1px solid #e7e5e4;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
          <p style="margin:0 0 12px;font-size:14px">
            <strong>${approverLabel}</strong> has ${action === "approve" ? "approved" : "rejected"} bill <strong>${billLabel}</strong>${amtStr ? ` (${amtStr})` : ""}.
          </p>
          ${comment ? `<p style="font-size:13px;background:#f5f5f4;border-left:3px solid #a8a29e;padding:10px 14px;margin:0;border-radius:0 4px 4px 0">${comment.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</p>` : ""}
        </div>
      </div>
    `;

    await sendEmail(tokenRow.orgId, {
      to: tokenRow.approverEmail,
      subject: `Bill ${action === "approve" ? "Approved" : "Rejected"}: ${billLabel} — ${orgName}`,
      body: htmlBody,
    });
  } catch { /* non-critical */ }

  return Response.json({ success: true, status: newStatus });
}
