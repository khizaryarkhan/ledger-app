import { db } from "@/db";
import { apBills, apApprovalTokens, apBillComments, organisations } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";
import { randomBytes } from "crypto";

// POST /api/payables/bills/[id]/send-for-approval
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const [bill] = await db.select().from(apBills)
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)))
    .limit(1);
  if (!bill) return bad("Bill not found", 404);

  const body = await req.json().catch(() => ({}));
  const approverEmail = (body.approverEmail ?? "").toString().trim().toLowerCase();
  if (!approverEmail || !approverEmail.includes("@")) return bad("Valid approver email required");
  const message = (body.message ?? "").toString().trim().slice(0, 2000);
  const customSubject = (body.subject ?? "").toString().trim().slice(0, 200);
  const includePortal = body.includePortal !== false;

  // Fetch org for branding
  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName })
    .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  const orgName = org?.displayName || org?.name || "Your Finance Team";

  // Generate token (expires 7 days)
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(apApprovalTokens).values({
    orgId: orgId!,
    billId: params.id,
    token,
    approverEmail,
    sentByUserId: (session?.user as any)?.id ?? null,
    status: "Pending",
    expiresAt,
  });

  // Update bill: cache approver email + sent timestamp + status
  await db.update(apBills)
    .set({
      approverEmail,
      lastApprovalSentAt: new Date(),
      workflowStatus: "Pending Approval",
      updatedAt: new Date(),
    })
    .where(and(eq(apBills.id, params.id), eq(apBills.orgId, orgId!)));

  // Build portal URL — prefer explicit NEXTAUTH_URL, fall back to Vercel deployment URL
  const rawBase = process.env.NEXTAUTH_URL
    ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null)
    ?? "https://app.foodready.ai";
  const baseUrl = rawBase.replace(/\/$/, "");
  const portalUrl = `${baseUrl}/approver/${token}`;

  // Send email
  const billLabel = bill.billNumber ?? `Bill ${params.id.slice(0, 8)}`;
  const senderName = (session?.user as any)?.name ?? orgName;
  const emailSubject = customSubject || `[Action Required] Approve ${billLabel} — ${orgName}`;

  const sym = bill.currency === "GBP" ? "£" : bill.currency === "EUR" ? "€" : "$";
  const amtStr = `${sym}${(bill.total ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dueDateStr = bill.dueDate
    ? new Date(bill.dueDate + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : null;
  const safeMessage = message.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const htmlBody = `
    <div style="font-family:sans-serif;color:#1c1917;max-width:600px;margin:0 auto">
      <div style="background:#7c3aed;padding:24px 28px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;font-size:18px;margin:0">Bill Approval Request</h1>
        <p style="color:#ddd6fe;font-size:13px;margin:8px 0 0">${orgName}</p>
      </div>
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-top:none;padding:24px 28px;border-radius:0 0 8px 8px">
        ${safeMessage ? `<p style="font-size:14px;margin:0 0 20px;white-space:pre-wrap">${safeMessage}</p>` : ""}
        <table style="width:100%;border-collapse:collapse;margin-bottom:20px;font-size:13px">
          <tr><td style="padding:6px 0;color:#78716c;width:120px">Bill Number</td><td style="padding:6px 0;font-weight:600">${billLabel}</td></tr>
          ${dueDateStr ? `<tr><td style="padding:6px 0;color:#78716c">Due Date</td><td style="padding:6px 0">${dueDateStr}</td></tr>` : ""}
          <tr><td style="padding:6px 0;color:#78716c">Amount</td><td style="padding:6px 0;font-weight:700;font-size:16px">${amtStr}</td></tr>
        </table>
        ${includePortal ? `
        <div style="text-align:center;margin:24px 0">
          <a href="${portalUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:15px;font-weight:600">
            Review &amp; Approve Bill →
          </a>
        </div>
        <p style="font-size:12px;color:#a8a29e;text-align:center;margin:0">
          This link expires in 7 days. Sent by ${senderName} via ${orgName}.
        </p>` : `
        <p style="font-size:12px;color:#a8a29e;margin:0">
          Sent by ${senderName} via ${orgName}.
        </p>`}
      </div>
    </div>
  `;

  try {
    await sendEmail(orgId!, {
      to: approverEmail,
      subject: emailSubject,
      body: htmlBody,
    });
  } catch (e: any) {
    console.error("Approval email send failed:", e);
    return bad("Bill updated but email failed to send: " + (e.message ?? "unknown error"), 500);
  }

  // Log comment
  const actorName = (session?.user as any)?.name ?? "Team";
  await db.insert(apBillComments).values({
    orgId: orgId!,
    billId: params.id,
    body: `Approval request sent to ${approverEmail}`,
    authorName: actorName,
    channel: "system",
  }).catch(() => {});

  return ok({ sent: true, approverEmail, portalUrl });
}
