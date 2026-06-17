import { db } from "@/db";
import { apApprovalTokens, apBills, apBillComments, organisations, users } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { sendEmail } from "@/lib/mailer";
import { rateLimit, clientIp } from "@/lib/rate-limit";

// POST /api/approver/[token]/submit
// Accepts either:
//   { decisions: [{ billId, action, comment }] }   ← per-bill (new)
//   { action, comment }                             ← all-bills (legacy)
export async function POST(req: Request, { params }: { params: { token: string } }) {
  const rl = await rateLimit(`approver-submit:${clientIp(req)}`, 10, 600);
  if (!rl.ok) return Response.json({ error: "Too many requests" }, { status: 429 });

  const [tokenRow] = await db.select().from(apApprovalTokens)
    .where(eq(apApprovalTokens.token, params.token))
    .limit(1);

  if (!tokenRow) return Response.json({ error: "Invalid link" }, { status: 410 });
  if (tokenRow.expiresAt < new Date()) return Response.json({ error: "This link has expired." }, { status: 410 });
  if (tokenRow.status !== "Pending") return Response.json({ error: "This request has already been decided." }, { status: 409 });

  // Resolve all bill IDs in this batch
  const billIds: string[] = (tokenRow.billIds && (tokenRow.billIds as string[]).length > 0)
    ? (tokenRow.billIds as string[])
    : (tokenRow.billId ? [tokenRow.billId] : []);

  const body = await req.json().catch(() => ({}));
  const approverLabel = tokenRow.approverName ?? tokenRow.approverEmail;
  const now = new Date();

  // ── Per-bill decisions (new format) ────────────────────────────────────────
  if (Array.isArray(body.decisions)) {
    const perBill: { billId: string; action: "approve" | "reject"; comment: string }[] = body.decisions;

    // Validate
    for (const d of perBill) {
      if (!["approve", "reject"].includes(d.action)) {
        return Response.json({ error: `Invalid action for bill ${d.billId}` }, { status: 400 });
      }
      if (d.action === "reject" && !d.comment?.trim()) {
        return Response.json({ error: `A rejection reason is required for each rejected bill.` }, { status: 400 });
      }
    }
    // Ensure all token bills are covered
    const submittedIds = new Set(perBill.map(d => d.billId));
    const missing = billIds.filter(id => !submittedIds.has(id));
    if (missing.length > 0) {
      return Response.json({ error: `Missing decisions for ${missing.length} bill(s).` }, { status: 400 });
    }

    // Update each bill
    for (const d of perBill) {
      await db.update(apBills)
        .set({
          workflowStatus: d.action === "approve" ? "Approved" : "Rejected",
          ...(d.action === "approve" ? { approvedAt: now } : {}),
          updatedAt: now,
        })
        .where(eq(apBills.id, d.billId));

      const commentBody = d.action === "approve"
        ? `Bill approved by ${approverLabel}${d.comment ? `\n\n"${d.comment}"` : ""}`
        : `Bill rejected by ${approverLabel}\n\nReason: ${d.comment}`;

      await db.insert(apBillComments).values({
        orgId: tokenRow.orgId,
        billId: d.billId,
        body: commentBody,
        authorName: approverLabel,
        channel: "approver",
      }).catch(() => {});
    }

    const approvedCount = perBill.filter(d => d.action === "approve").length;
    const rejectedCount = perBill.filter(d => d.action === "reject").length;
    const overallStatus = rejectedCount === 0 ? "Approved" : approvedCount === 0 ? "Rejected" : "Partial";
    const decisionSummary = `${approvedCount} approved, ${rejectedCount} rejected`;

    await db.update(apApprovalTokens)
      .set({ status: overallStatus, decision: decisionSummary, submittedAt: now })
      .where(eq(apApprovalTokens.id, tokenRow.id));

    // Notification email — fire and forget
    _sendNotification(tokenRow, approverLabel, perBill, approvedCount, rejectedCount).catch(() => {});

    return Response.json({ success: true, status: overallStatus, approved: approvedCount, rejected: rejectedCount });
  }

  // ── Legacy: single action for all bills ────────────────────────────────────
  const action = body.action;
  if (!["approve", "reject"].includes(action)) {
    return Response.json({ error: "action must be approve or reject" }, { status: 400 });
  }
  const comment = (body.comment ?? "").toString().trim().slice(0, 2000);
  if (action === "reject" && !comment) {
    return Response.json({ error: "A reason is required when rejecting." }, { status: 400 });
  }

  const newStatus = action === "approve" ? "Approved" : "Rejected";

  await db.update(apApprovalTokens)
    .set({ status: newStatus, decision: comment || null, submittedAt: now })
    .where(eq(apApprovalTokens.id, tokenRow.id));

  if (billIds.length > 0) {
    await db.update(apBills)
      .set({
        workflowStatus: newStatus,
        ...(action === "approve" ? { approvedAt: now } : {}),
        updatedAt: now,
      })
      .where(inArray(apBills.id, billIds));
  }

  const bills = billIds.length > 0
    ? await db.select({ billNumber: apBills.billNumber, total: apBills.total, currency: apBills.currency })
        .from(apBills).where(inArray(apBills.id, billIds))
    : [];

  const commentBody = action === "approve"
    ? `Bill approved by ${approverLabel}${comment ? `\n\n"${comment}"` : ""}`
    : `Bill rejected by ${approverLabel}\n\nReason: ${comment}`;

  await Promise.all(billIds.map(billId =>
    db.insert(apBillComments).values({
      orgId: tokenRow.orgId, billId, body: commentBody, authorName: approverLabel, channel: "approver",
    }).catch(() => {})
  ));

  _sendNotificationLegacy(tokenRow, approverLabel, action, comment, bills).catch(() => {});

  return Response.json({ success: true, status: newStatus });
}

// ── Email helpers ─────────────────────────────────────────────────────────────

async function _sendNotification(
  tokenRow: any,
  approverLabel: string,
  perBill: { billId: string; action: string; comment: string }[],
  approvedCount: number,
  rejectedCount: number,
) {
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

    const allApproved = rejectedCount === 0;
    const allRejected = approvedCount === 0;
    const accentColor = allApproved ? "#059669" : allRejected ? "#dc2626" : "#7c3aed";
    const statusLabel = allApproved ? "All Approved ✓" : allRejected ? "All Rejected ✗" : `${approvedCount} Approved / ${rejectedCount} Rejected`;

    const billRows = await db.select({ id: apBills.id, billNumber: apBills.billNumber, total: apBills.total, currency: apBills.currency })
      .from(apBills).where(inArray(apBills.id, perBill.map(d => d.billId)));
    const billMap = Object.fromEntries(billRows.map(b => [b.id, b]));

    const sym = (billRows[0]?.currency === "GBP" ? "£" : billRows[0]?.currency === "EUR" ? "€" : "$");
    const fmt = (n: number) => `${sym}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    const rows = perBill.map(d => {
      const b = billMap[d.billId];
      const icon = d.action === "approve" ? "✓" : "✗";
      const color = d.action === "approve" ? "#059669" : "#dc2626";
      const safeComment = (d.comment || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<tr style="border-bottom:1px solid #e7e5e4">
        <td style="padding:8px 12px;font-family:monospace;font-size:13px;color:#7c3aed">${b?.billNumber ?? d.billId.slice(0, 8)}</td>
        <td style="padding:8px 12px;font-size:13px;text-align:right">${b ? fmt(b.total ?? 0) : "—"}</td>
        <td style="padding:8px 12px;font-size:13px;font-weight:700;color:${color}">${icon} ${d.action === "approve" ? "Approved" : "Rejected"}</td>
        <td style="padding:8px 12px;font-size:12px;color:#78716c;max-width:200px">${safeComment || "—"}</td>
      </tr>`;
    }).join("");

    const htmlBody = `
      <div style="font-family:sans-serif;color:#1c1917;max-width:600px;margin:0 auto">
        <div style="background:${accentColor};padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;font-size:16px;margin:0">Bill Approval: ${statusLabel}</h2>
          <p style="color:rgba(255,255,255,0.8);font-size:13px;margin:6px 0 0">${orgName}</p>
        </div>
        <div style="background:#fafaf9;border:1px solid #e7e5e4;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
          <p style="font-size:14px;margin:0 0 16px"><strong>${approverLabel}</strong> has submitted decisions on ${perBill.length} bill${perBill.length > 1 ? "s" : ""}.</p>
          <table style="width:100%;border-collapse:collapse">
            <thead>
              <tr style="background:#f5f5f4;border-bottom:2px solid #e7e5e4">
                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:#78716c;text-transform:uppercase">Bill #</th>
                <th style="padding:8px 12px;text-align:right;font-size:11px;font-weight:600;color:#78716c;text-transform:uppercase">Amount</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:#78716c;text-transform:uppercase">Decision</th>
                <th style="padding:8px 12px;text-align:left;font-size:11px;font-weight:600;color:#78716c;text-transform:uppercase">Note</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;

    await sendEmail(tokenRow.orgId, {
      to: notifyEmail,
      subject: `Bill Decisions: ${statusLabel} — ${orgName}`,
      body: htmlBody,
    });
  } catch { /* non-critical */ }
}

async function _sendNotificationLegacy(
  tokenRow: any,
  approverLabel: string,
  action: string,
  comment: string,
  bills: { billNumber?: string | null; total?: number | null; currency?: string | null }[],
) {
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
    const fmt = (n: number) => `${sym}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    const totalAmt = bills.reduce((s, b) => s + (b.total ?? 0), 0);
    const isBatch = bills.length > 1;
    const accentColor = action === "approve" ? "#059669" : "#dc2626";
    const safeComment = comment.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const billSummary = isBatch ? `${bills.length} bills (${fmt(totalAmt)})` : `${bills[0]?.billNumber ?? "Bill"} (${fmt(bills[0]?.total ?? 0)})`;

    const htmlBody = `
      <div style="font-family:sans-serif;color:#1c1917;max-width:520px;margin:0 auto">
        <div style="background:${accentColor};padding:20px 24px;border-radius:8px 8px 0 0">
          <h2 style="color:#fff;font-size:16px;margin:0">${isBatch ? "Batch " : ""}Bill ${action === "approve" ? "Approved ✓" : "Rejected ✗"}</h2>
        </div>
        <div style="background:#fafaf9;border:1px solid #e7e5e4;border-top:none;padding:20px 24px;border-radius:0 0 8px 8px">
          <p style="font-size:14px;margin:0 0 12px"><strong>${approverLabel}</strong> has ${action === "approve" ? "approved" : "rejected"} <strong>${billSummary}</strong>.</p>
          ${safeComment ? `<blockquote style="font-size:13px;background:#f5f5f4;border-left:3px solid #a8a29e;padding:10px 14px;margin:0;border-radius:0 4px 4px 0">${safeComment}</blockquote>` : ""}
        </div>
      </div>`;

    await sendEmail(tokenRow.orgId, {
      to: notifyEmail,
      subject: `${isBatch ? `${bills.length} Bills` : `Bill ${bills[0]?.billNumber ?? ""}`} ${action === "approve" ? "Approved" : "Rejected"} — ${orgName}`,
      body: htmlBody,
    });
  } catch { /* non-critical */ }
}
