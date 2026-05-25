import { db } from "@/db";
import { invoices, customers, projects } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { sendEmail } from "@/lib/mailer";
import { eq, and, ilike, ne } from "drizzle-orm";
import Groq from "groq-sdk";
import { NextResponse } from "next/server";
// @ts-ignore — pdfkit types are loaded separately
import PDFDocument from "pdfkit";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "send_invoices",
      description: "Send open invoices for a project or customer via email with a PDF statement attached",
      parameters: {
        type: "object",
        properties: {
          projectName:  { type: "string", description: "Project name (partial match ok)" },
          customerName: { type: "string", description: "Customer name (partial match ok)" },
          to:           { type: "string", description: "Recipient email address" },
          cc:           { type: "string", description: "CC email address(es), comma-separated" },
        },
        required: ["to"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoices",
      description: "Look up open or overdue invoices for a project or customer and return a summary",
      parameters: {
        type: "object",
        properties: {
          projectName:  { type: "string" },
          customerName: { type: "string" },
          status: {
            type: "string",
            enum: ["open", "overdue", "all"],
            description: "Filter: open (unpaid), overdue (past due date), all",
          },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ar_summary",
      description: "Get accounts receivable summary — total open AR and overdue amounts, optionally scoped to a customer or project",
      parameters: {
        type: "object",
        properties: {
          customerName: { type: "string" },
          projectName:  { type: "string" },
        },
      },
    },
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────
function openBal(i: any): number {
  if (i.qboBalance != null) return Math.max(0, i.qboBalance);
  return Math.max(0, (i.total ?? 0) - (i.paid ?? 0));
}

function daysOverdue(dueDate: string): number {
  return Math.floor((Date.now() - new Date(dueDate).getTime()) / 86_400_000);
}

function fmt(n: number, ccy = "EUR") {
  return new Intl.NumberFormat("en-IE", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
}

// ── Fuzzy entity lookup — returns matches or a CONFIRM_NEEDED signal ──────────
type MatchResult =
  | { status: "ok";      projectId?: string; customerId?: string; label: string }
  | { status: "confirm"; message: string }
  | { status: "none";    message: string };

async function resolveEntity(
  orgId: string,
  projectName?: string,
  customerName?: string,
): Promise<MatchResult> {
  if (projectName) {
    const matches = await db
      .select({ id: projects.id, name: projects.name })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), ilike(projects.name, `%${projectName}%`)));

    if (matches.length === 0) {
      return { status: "none", message: `No project found matching "${projectName}".` };
    }
    if (matches.length === 1) {
      return { status: "ok", projectId: matches[0].id, label: matches[0].name };
    }

    // Multiple matches — check if exactly one starts with the search term (e.g. "MW22004")
    const lower = projectName.toLowerCase();
    const prefixMatches = matches.filter(p => p.name.toLowerCase().startsWith(lower));
    if (prefixMatches.length === 1) {
      return { status: "ok", projectId: prefixMatches[0].id, label: prefixMatches[0].name };
    }

    // Genuinely ambiguous — list options for the user
    const list = matches.slice(0, 8).map((p, i) => `${i + 1}. ${p.name}`).join("\n");
    return {
      status: "confirm",
      message: `Found ${matches.length} projects matching "${projectName}":\n\n${list}\n\nWhich one did you mean?`,
    };
  }

  if (customerName) {
    const matches = await db
      .select({ id: customers.id, name: customers.name })
      .from(customers)
      .where(and(eq(customers.orgId, orgId), ilike(customers.name, `%${customerName}%`)));

    if (matches.length === 0) {
      return { status: "none", message: `No customer found matching "${customerName}".` };
    }
    if (matches.length === 1) {
      return { status: "ok", customerId: matches[0].id, label: matches[0].name };
    }

    // Prefix match wins
    const lower = customerName.toLowerCase();
    const prefixMatches = matches.filter(c => c.name.toLowerCase().startsWith(lower));
    if (prefixMatches.length === 1) {
      return { status: "ok", customerId: prefixMatches[0].id, label: prefixMatches[0].name };
    }

    const list = matches.slice(0, 8).map((c, i) => `${i + 1}. ${c.name}`).join("\n");
    return {
      status: "confirm",
      message: `Found ${matches.length} customers matching "${customerName}":\n\n${list}\n\nWhich one did you mean?`,
    };
  }

  return { status: "ok", label: "all" };
}

// ── Fetch open invoices (scoped to resolved entity IDs) ───────────────────────
async function fetchOpenInvoices(
  orgId: string,
  projectId?: string,
  customerId?: string,
) {
  const rows = await db
    .select({
      id:            invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate:   invoices.invoiceDate,
      dueDate:       invoices.dueDate,
      total:         invoices.total,
      paid:          invoices.paid,
      qboBalance:    invoices.qboBalance,
      paymentStatus: invoices.paymentStatus,
      txnType:       invoices.txnType,
      currency:      invoices.currency,
      customerId:    invoices.customerId,
      projectId:     invoices.projectId,
      customerName:  customers.name,
      projectName:   projects.name,
    })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(
      and(
        eq(invoices.orgId, orgId),
        ne(invoices.paymentStatus, "Paid"),
        ne(invoices.txnType, "CreditMemo"),
        ...(projectId  ? [eq(invoices.projectId,  projectId)]  : []),
        ...(customerId ? [eq(invoices.customerId, customerId)] : []),
      )
    );

  return rows;
}

// ── PDF statement generator ───────────────────────────────────────────────────
async function generateStatementPDF(
  rows: Awaited<ReturnType<typeof fetchOpenInvoices>>,
  title: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: "A4" });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const dateStr = new Date().toLocaleDateString("en-GB", {
      day: "numeric", month: "long", year: "numeric",
    });

    // Header bar
    doc.rect(0, 0, doc.page.width, 80).fill("#1c1917");
    doc.fillColor("#ffffff").fontSize(18).font("Helvetica-Bold")
       .text(title, 50, 25, { width: doc.page.width - 100 });
    doc.fillColor("#a8a29e").fontSize(10).font("Helvetica")
       .text(`Statement as of ${dateStr}`, 50, 52);

    doc.fillColor("#111827");
    let y = 110;

    // Column config
    const cols = { num: 50, customer: 130, date: 330, due: 400, bal: 490 };
    const colW = doc.page.width - 100;

    // Table header
    doc.rect(50, y, colW, 22).fill("#f3f4f6");
    doc.fillColor("#6b7280").fontSize(8).font("Helvetica-Bold");
    doc.text("INVOICE",      cols.num,      y + 7);
    doc.text("CUSTOMER / PROJECT", cols.customer, y + 7);
    doc.text("DATE",         cols.date,     y + 7);
    doc.text("DUE",          cols.due,      y + 7);
    doc.text("BALANCE",      cols.bal,      y + 7, { width: 55, align: "right" });
    y += 22;

    // Rows
    rows.forEach((inv, idx) => {
      const bal  = openBal(inv);
      const days = daysOverdue(inv.dueDate);
      const rowH = inv.projectName ? 28 : 20;

      if (y + rowH > doc.page.height - 80) {
        doc.addPage();
        y = 50;
      }

      // Alternating row bg
      if (idx % 2 === 0) doc.rect(50, y, colW, rowH).fill("#fafafa");

      doc.fillColor("#374151").fontSize(9).font("Helvetica");
      doc.text(`#${inv.invoiceNumber}`, cols.num, y + 5, { width: 75 });

      // Customer + project sub-label
      doc.text(inv.customerName ?? "—", cols.customer, inv.projectName ? y + 2 : y + 5, { width: 190 });
      if (inv.projectName) {
        doc.fillColor("#9ca3af").fontSize(7.5)
           .text(inv.projectName, cols.customer, y + 14, { width: 190 });
        doc.fillColor("#374151").fontSize(9).font("Helvetica");
      }

      doc.text(inv.invoiceDate, cols.date, y + 5, { width: 65 });

      // Overdue in red
      if (days > 0) {
        doc.fillColor("#dc2626").font("Helvetica-Bold")
           .text(`${days}d overdue`, cols.due, y + 5, { width: 85 });
        doc.fillColor("#374151").font("Helvetica");
      } else {
        doc.text(inv.dueDate, cols.due, y + 5, { width: 85 });
      }

      doc.font("Helvetica-Bold").fillColor("#111827")
         .text(fmt(bal, inv.currency || "EUR"), cols.bal, y + 5, { width: 55, align: "right" });
      doc.font("Helvetica");

      // Row bottom border
      doc.moveTo(50, y + rowH).lineTo(50 + colW, y + rowH).strokeColor("#e5e7eb").lineWidth(0.5).stroke();
      y += rowH;
    });

    // Total footer
    const total = rows.reduce((s, i) => s + openBal(i), 0);
    const footerY = Math.min(y + 8, doc.page.height - 70);
    doc.rect(50, footerY, colW, 28).fill("#1c1917");
    doc.fillColor("#ffffff").fontSize(10).font("Helvetica-Bold")
       .text("TOTAL OUTSTANDING", 55, footerY + 9)
       .text(fmt(total), cols.bal, footerY + 9, { width: 55, align: "right" });

    doc.end();
  });
}

// ── Tool: get_invoices ────────────────────────────────────────────────────────
async function toolGetInvoices(orgId: string, args: any): Promise<string> {
  const resolved = await resolveEntity(orgId, args.projectName, args.customerName);
  if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;

  const rows = await fetchOpenInvoices(orgId, resolved.projectId, resolved.customerId);
  if (rows.length === 0) return `No open invoices found for ${resolved.label}.`;

  const status = args.status || "open";
  let display = rows;
  if (status === "overdue") display = rows.filter(i => daysOverdue(i.dueDate) > 0);

  const total = display.reduce((s, i) => s + openBal(i), 0);
  const lines = display.slice(0, 10).map(i => {
    const bal  = openBal(i);
    const days = daysOverdue(i.dueDate);
    const tag  = days > 0 ? ` (${days}d overdue)` : ` (due ${i.dueDate})`;
    return `• #${i.invoiceNumber} — ${i.customerName}${i.projectName ? ` / ${i.projectName}` : ""} — ${fmt(bal, i.currency)}${tag}`;
  }).join("\n");

  const more = display.length > 10 ? `\n…and ${display.length - 10} more` : "";
  return `Found ${display.length} ${status} invoice(s) for "${resolved.label}" totalling ${fmt(total)}:\n${lines}${more}`;
}

// ── Tool: send_invoices ───────────────────────────────────────────────────────
async function toolSendInvoices(orgId: string, args: any): Promise<string> {
  const resolved = await resolveEntity(orgId, args.projectName, args.customerName);
  if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;

  const rows = await fetchOpenInvoices(orgId, resolved.projectId, resolved.customerId);
  if (rows.length === 0) return `No open invoices found for "${resolved.label}" — nothing sent.`;

  const total   = rows.reduce((s, i) => s + openBal(i), 0);
  const subject = `Open Invoices — ${resolved.label}`;
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // HTML email body
  const rowsHtml = rows.map(i => {
    const bal   = openBal(i);
    const days  = daysOverdue(i.dueDate);
    const style = days > 0 ? "color:#dc2626;font-weight:600;" : "color:#374151;";
    const label = days > 0 ? `${days}d overdue` : `Due ${i.dueDate}`;
    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;font-size:13px;color:#374151;">#${i.invoiceNumber}</td>
        <td style="padding:10px 12px;font-size:13px;color:#374151;">
          ${i.customerName ?? "—"}${i.projectName ? `<br><span style="font-size:11px;color:#6b7280;">${i.projectName}</span>` : ""}
        </td>
        <td style="padding:10px 12px;font-size:13px;color:#374151;">${i.invoiceDate}</td>
        <td style="padding:10px 12px;font-size:13px;${style}">${label}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#111827;text-align:right;">${fmt(bal, i.currency)}</td>
      </tr>`;
  }).join("");

  const body = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff;">
      <div style="background:#1c1917;padding:24px 32px;">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600;">${subject}</h1>
        <p style="color:#a8a29e;margin:6px 0 0;font-size:13px;">As of ${dateStr}</p>
      </div>
      <div style="padding:24px 32px;">
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">
          Please find below the outstanding invoices. A PDF statement is attached for your records.
          Kindly arrange payment at your earliest convenience.
        </p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Invoice</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Customer / Project</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Date</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:left;">Due</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;color:#6b7280;text-align:right;">Balance</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
          <tfoot>
            <tr style="background:#f9fafb;">
              <td colspan="4" style="padding:12px;font-size:13px;font-weight:700;color:#111827;">Total Outstanding</td>
              <td style="padding:12px;font-size:15px;font-weight:700;color:#111827;text-align:right;">${fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;

  // Generate PDF
  const pdfBuffer = await generateStatementPDF(rows, subject);

  let transport = "";
  try {
    const result = await sendEmail(orgId, {
      to:      args.to,
      cc:      args.cc,
      subject,
      body,
      attachments: [{
        filename:    `${resolved.label.replace(/[^a-zA-Z0-9 ]/g, "")}_Statement.pdf`,
        content:     pdfBuffer,
        contentType: "application/pdf",
      }],
    });
    transport = result.transport;
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return `❌ Email not sent — ${msg}\n\nCheck Settings → Email to make sure Gmail, Outlook or SMTP is connected.`;
  }

  return `✅ Sent ${rows.length} invoice(s) totalling ${fmt(total)} to ${args.to}${args.cc ? ` (CC: ${args.cc})` : ""}\nPDF statement attached · via ${transport}`;
}

// ── Tool: get_ar_summary ──────────────────────────────────────────────────────
async function toolGetArSummary(orgId: string, args: any): Promise<string> {
  const resolved = await resolveEntity(orgId, args.projectName, args.customerName);
  if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;

  const rows = await fetchOpenInvoices(orgId, resolved.projectId, resolved.customerId);
  if (rows.length === 0) return `No open AR found for "${resolved.label}".`;

  const totalAR   = rows.reduce((s, i) => s + openBal(i), 0);
  const overdue   = rows.filter(i => daysOverdue(i.dueDate) > 0);
  const overdueAR = overdue.reduce((s, i) => s + openBal(i), 0);
  const over90    = overdue.filter(i => daysOverdue(i.dueDate) > 90).reduce((s, i) => s + openBal(i), 0);

  return [
    `AR Summary for "${resolved.label}":`,
    `• Total open: ${fmt(totalAR)} across ${rows.length} invoice(s)`,
    `• Overdue: ${fmt(overdueAR)} (${overdue.length} invoice(s))`,
    over90 > 0 ? `• 90+ days overdue: ${fmt(over90)}` : null,
  ].filter(Boolean).join("\n");
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const { message, history = [] } = await req.json();
  if (!message?.trim()) return bad("message required");

  const systemPrompt = `You are a helpful accounts receivable assistant embedded in a financial management app.
You help users query invoices, check overdue amounts, and send invoice statement emails with PDF attachments.
Be concise and professional. When the tool returns a confirmation request (multiple matches found), relay it exactly and wait for the user to clarify.
When users ask to send invoices, confirm what was sent including the PDF attachment.
If no email address is provided for sending, ask for one.
Today is ${new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-8),
    { role: "user", content: message },
  ];

  // First call — let Groq decide if a tool is needed
  const first = await groq.chat.completions.create({
    model:        "llama-3.3-70b-versatile",
    messages,
    tools:        TOOLS,
    tool_choice:  "auto",
    temperature:  0.1,
  });

  const choice = first.choices[0];

  if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
    return NextResponse.json({ reply: choice.message.content ?? "I'm not sure how to help with that." });
  }

  // Execute tool
  const toolCall = choice.message.tool_calls[0];
  const toolName = toolCall.function.name;
  let toolArgs: any = {};
  try { toolArgs = JSON.parse(toolCall.function.arguments); } catch {}

  let toolResult = "";
  try {
    if      (toolName === "send_invoices")  toolResult = await toolSendInvoices(orgId!, toolArgs);
    else if (toolName === "get_invoices")   toolResult = await toolGetInvoices(orgId!, toolArgs);
    else if (toolName === "get_ar_summary") toolResult = await toolGetArSummary(orgId!, toolArgs);
    else toolResult = "Unknown tool.";
  } catch (e: any) {
    toolResult = `Error: ${e?.message ?? "Something went wrong."}`;
  }

  // Always return tool results verbatim — never let Groq paraphrase them.
  // This ensures errors are shown as errors and confirmations preserve their lists.
  return NextResponse.json({ reply: toolResult });
}
