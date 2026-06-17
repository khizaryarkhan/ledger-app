import { db } from "@/db";
import { apBills, apApprovalTokens, apBillComments, apSuppliers, organisations } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";
import { getAppUrl } from "@/lib/portal";
import { randomBytes } from "crypto";

// POST /api/payables/bills/[id]/send-for-approval
// Body may include billIds[] for multi-bill batch; [id] is always included.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const { error, orgId, session } = await requireOrg();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const approverEmail = (body.approverEmail ?? "").toString().trim().toLowerCase();
  if (!approverEmail || !approverEmail.includes("@")) return bad("Valid approver email required");

  // Collect all bill IDs — always include the route [id], merge with any billIds[] from body
  const extraIds: string[] = Array.isArray(body.billIds) ? body.billIds : [];
  const allIds = Array.from(new Set([params.id, ...extraIds]));

  // Load all bills, verify they belong to this org
  const bills = await db.select({
    id: apBills.id,
    billNumber: apBills.billNumber,
    dueDate: apBills.dueDate,
    currency: apBills.currency,
    total: apBills.total,
    balance: apBills.balance,
    supplierId: apBills.supplierId,
    workflowStatus: apBills.workflowStatus,
  })
    .from(apBills)
    .where(and(inArray(apBills.id, allIds), eq(apBills.orgId, orgId!)));

  if (bills.length === 0) return bad("No bills found", 404);

  const message = (body.message ?? "").toString().trim().slice(0, 2000);
  const customSubject = (body.subject ?? "").toString().trim().slice(0, 200);
  const includePortal = body.includePortal !== false;

  // Fetch org branding
  const [org] = await db.select({ name: organisations.name, displayName: organisations.displayName })
    .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
  const orgName = org?.displayName || org?.name || "Your Finance Team";

  // Generate token (7-day expiry), covering all bills
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  await db.insert(apApprovalTokens).values({
    orgId: orgId!,
    billId: bills[0].id,                        // primary bill (first)
    billIds: bills.map(b => b.id),              // full batch
    token,
    approverEmail,
    sentByUserId: (session?.user as any)?.id ?? null,
    status: "Pending",
    expiresAt,
  });

  // Update all bills: set approver email + sent timestamp + status
  await db.update(apBills)
    .set({ approverEmail, lastApprovalSentAt: new Date(), workflowStatus: "Pending Approval", updatedAt: new Date() })
    .where(and(inArray(apBills.id, bills.map(b => b.id)), eq(apBills.orgId, orgId!)));

  // Build portal URL from live request host — same as customer portal
  const portalUrl = `${getAppUrl()}/approver/${token}`;

  // Build email
  const senderName = (session?.user as any)?.name ?? orgName;
  const isBatch = bills.length > 1;
  const emailSubject = customSubject
    || (isBatch
      ? `[Action Required] ${bills.length} Bills Awaiting Approval — ${orgName}`
      : `[Action Required] Approve Bill ${bills[0].billNumber ?? bills[0].id.slice(0, 8)} — ${orgName}`);

  const safeMessage = message
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  // Build bill rows for the email table
  const ccy = bills[0].currency;
  const sym = ccy === "GBP" ? "£" : ccy === "EUR" ? "€" : "$";
  const fmtAmt = (n: number) => `${sym}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = (d?: string | null) => d
    ? new Date(d + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })
    : "—";

  const totalAmt = bills.reduce((s, b) => s + (b.balance ?? b.total ?? 0), 0);

  const billRows = bills.map(b => `
    <tr>
      <td style="padding:8px 12px;font-family:monospace;font-size:13px;color:#7c3aed">${b.billNumber ?? b.id.slice(0, 8)}</td>
      <td style="padding:8px 12px;font-size:13px;color:#78716c">${fmtDate(b.dueDate)}</td>
      <td style="padding:8px 12px;font-size:13px;font-weight:600;text-align:right">${fmtAmt(b.balance ?? b.total ?? 0)}</td>
    </tr>`).join("");

  const htmlBody = `
    <div style="font-family:sans-serif;color:#1c1917;max-width:600px;margin:0 auto">
      <div style="background:#7c3aed;padding:24px 28px;border-radius:8px 8px 0 0">
        <h1 style="color:#fff;font-size:18px;margin:0">Bill Approval Request</h1>
        <p style="color:#ddd6fe;font-size:13px;margin:8px 0 0">${orgName}</p>
      </div>
      <div style="background:#fafaf9;border:1px solid #e7e5e4;border-top:none;padding:24px 28px;border-radius:0 0 8px 8px">
        ${safeMessage ? `<p style="font-size:14px;margin:0 0 20px">${safeMessage}</p>` : ""}

        <table style="width:100%;border-collapse:collapse;margin-bottom:4px;font-size:13px">
          <thead>
            <tr style="background:#f5f5f4;border-bottom:1px solid #e7e5e4">
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:.05em">Bill #</th>
              <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:.05em">Due Date</th>
              <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:#78716c;text-transform:uppercase;letter-spacing:.05em">Amount</th>
            </tr>
          </thead>
          <tbody>${billRows}</tbody>
          ${isBatch ? `
          <tfoot>
            <tr style="border-top:2px solid #e7e5e4">
              <td colspan="2" style="padding:8px 12px;font-size:13px;font-weight:700">Total</td>
              <td style="padding:8px 12px;font-size:15px;font-weight:700;text-align:right">${fmtAmt(totalAmt)}</td>
            </tr>
          </tfoot>` : ""}
        </table>

        ${includePortal ? `
        <div style="text-align:center;margin:28px 0 16px">
          <a href="${portalUrl}" style="display:inline-block;background:#7c3aed;color:#fff;text-decoration:none;padding:13px 32px;border-radius:8px;font-size:15px;font-weight:600">
            Review &amp; Approve ${isBatch ? `${bills.length} Bills` : "Bill"} →
          </a>
        </div>
        <p style="font-size:12px;color:#a8a29e;text-align:center;margin:0">
          This link expires in 7 days. Sent by ${senderName} via ${orgName}.
        </p>` : `
        <p style="font-size:12px;color:#a8a29e;margin:12px 0 0">Sent by ${senderName} via ${orgName}.</p>`}
      </div>
    </div>
  `;

  const emailTimeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Email sending timed out (15 s). Check SMTP settings.")), 15_000)
  );
  try {
    await Promise.race([
      sendEmail(orgId!, { to: approverEmail, subject: emailSubject, body: htmlBody }),
      emailTimeout,
    ]);
  } catch (e: any) {
    console.error("Approval email send failed:", e);
    return bad("Bills updated but email failed to send: " + (e.message ?? "unknown error"), 500);
  }

  // Log system comment on each bill
  const actorName = (session?.user as any)?.name ?? "Team";
  await Promise.all(bills.map(b =>
    db.insert(apBillComments).values({
      orgId: orgId!,
      billId: b.id,
      body: isBatch
        ? `Approval request (batch of ${bills.length}) sent to ${approverEmail}`
        : `Approval request sent to ${approverEmail}`,
      authorName: actorName,
      channel: "system",
    }).catch(() => {})
  ));

  return ok({ sent: true, approverEmail, portalUrl, billCount: bills.length });
}
