import { db } from "@/db";
import { apApprovalTokens, apBills, apBillComments, organisations, users } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// POST /api/approver/[token]/submit
export async function POST(req: Request, { params }: { params: { token: string } }) {
  // 10 submission attempts per IP per 10 minutes
  const rl = await rateLimit(`approver-submit:${clientIp(req)}`, 10, 600);
  if (!rl.ok) return Response.json({ error: "Too many requests" }, { status: 429 });
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

  // Resolve all bill IDs in this batch
  const billIds: string[] = (tokenRow.billIds && (tokenRow.billIds as string[]).length > 0)
    ? (tokenRow.billIds as string[])
    : (tokenRow.billId ? [tokenRow.billId] : []);

  const now = new Date();
  const newStatus = action === "approve" ? "Approved" : "Rejected";
  const newWorkflow = action === "approve" ? "Approved" : "Rejected";

  // Mark token decided
  await db.update(apApprovalTokens)
    .set({ status: newStatus, decision: comment || null, submittedAt: now })
    .where(eq(apApprovalTokens.id, tokenRow.id));

  // Update ALL bills in the batch
  if (billIds.length > 0) {
    await db.update(apBills)
      .set({
        workflowStatus: newWorkflow,
        ...(action === "approve" ? { approvedAt: now } : {}),
        updatedAt: now,
      })
      .where(inArray(apBills.id, billIds));
  }

  // Load bill summary for email + comment
  const bills = billIds.length > 0
    ? await db.select({ billNumber: apBills.billNumber, total: apBills.total, currency: apBills.currency })
        .from(apBills).where(inArray(apBills.id, billIds))
    : [];

  const approverLabel = tokenRow.approverName ?? tokenRow.approverEmail;
  const isBatch = bills.length > 1;

  // Log approver comment on each bill
  const commentBody = action === "approve"
    ? `Bill approved by ${approverLabel}${comment ? `\n\n"${comment}"` : ""}`
    : `Bill rejected by ${approverLabel}\n\nReason: ${comment}`;

  await Promise.all(billIds.map(billId =>
    db.insert(apBillComments).values({
      orgId: tokenRow.orgId,
      billId,
      body: commentBody,
      authorName: approverLabel,
      channel: "approver",
    }).catch(() => {})
  ));

  // Notify the internal user who sent the request — fire and forget
  try {
    const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName })
      .from(organisations).where(eq(organisations.id, tokenRow.orgId)).limit(1);
    const orgName = org?.displayName || org?.name || "Finance Team";

    let notifyEmail: string | null = null;
    if (tokenRow.sentByUserId) {
      const [sender] = await db.select({ email: users.email })
        .from(users).where(eq(users.id, tokenRow.sentByUserId)).limit(1);
      notifyEmail = sender?.email ?? null;
    }
    if (!notifyEmail) notifyEmail = tokenRow.approverEmail;

    const ccy = bills[0]?.currency ?? "USD";
    const sym = ccy === "GBP" ? "£" : ccy === "EUR" ? "€" : "$";
    const fmtAmt = (n: number) => `${sym}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const totalAmt = bills.reduce((s, b) => s + (b.total ?? 0), 0);

    const safeComment = comment.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const accentColor = action === "approve" ? "#059669" : "#dc2626";
    const statusLabel = action === "approve" ? "Approved ✓" : "Rejected ✗";

    const billSummary = isBatch
      ? `${bills.length} bills (${fmtAmt(totalAmt)} total)`
      : `${bills[0]?.billNumber ?? "Bill"} (${fmtAmt(bills[0]?.total ?? 0)})`;

    const htmlBody = `
      <div style="font-family:sans-serif;color:#1c1917;max-width:520px;margin:0 auto">
        <div style="background:${accentColor};padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;font-size:16px;margin:0">${isBatch ? "Batch " : ""}Bill ${statusLabel}</h2>
        </div>
        <div style="background:#fafaf9;border:1px solid #e7e5e4;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
          <p style="margin:0 0 12px;font-size:14px">
            <strong>${approverLabel}</strong> has ${action === "approve" ? "approved" : "rejected"}
            <strong>${billSummary}</strong>.
          </p>
          ${safeComment ? `<blockquote style="font-size:13px;background:#f5f5f4;border-left:3px solid #a8a29e;padding:10px 14px;margin:0;border-radius:0 4px 4px 0">${safeComment}</blockquote>` : ""}
        </div>
      </div>
    `;

    await sendEmail(tokenRow.orgId, {
      to: notifyEmail,
      subject: `${isBatch ? `${bills.length} Bills` : `Bill ${bills[0]?.billNumber ?? ""}`} ${action === "approve" ? "Approved" : "Rejected"} — ${orgName}`,
      body: htmlBody,
    });
  } catch { /* non-critical */ }

  return Response.json({ success: true, status: newStatus });
}
