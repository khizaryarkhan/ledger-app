import { db } from "@/db";
import { invoices, customers, projects } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { sendEmail } from "@/lib/mailer";
import { eq, and, ilike, ne } from "drizzle-orm";
import Groq from "groq-sdk";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

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
          to:           { type: "string", description: "Recipient email address. If not specified by the user, omit this and the system will use the customer's billing email on file." },
          cc:           { type: "string", description: "CC email address(es), comma-separated" },
        },
        required: [],
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

// ── PDF statement generator (pdf-lib — no filesystem, Vercel-safe) ────────────
async function generateStatementPDF(
  rows: Awaited<ReturnType<typeof fetchOpenInvoices>>,
  title: string,
): Promise<Buffer> {
  const pdfDoc   = await PDFDocument.create();
  const regular  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold     = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28, H = 841.89; // A4
  const margin = 50;
  const colX   = { num: margin, customer: 130, date: 340, due: 415, bal: 500 };

  const stone900 = rgb(0.11, 0.10, 0.09);
  const stone600 = rgb(0.42, 0.40, 0.38);
  const stone200 = rgb(0.90, 0.89, 0.88);
  const red      = rgb(0.86, 0.15, 0.15);
  const white    = rgb(1, 1, 1);

  let page = pdfDoc.addPage([W, H]);
  let y = H - margin;

  function addPage() {
    page = pdfDoc.addPage([W, H]);
    y = H - margin;
  }

  function ensureSpace(needed: number) {
    if (y - needed < margin + 40) addPage();
  }

  // Header
  page.drawRectangle({ x: 0, y: H - 70, width: W, height: 70, color: stone900 });
  page.drawText(title, { x: margin, y: H - 35, size: 14, font: bold, color: white, maxWidth: W - margin * 2 });
  const dateStr = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  page.drawText(`Statement as of ${dateStr}`, { x: margin, y: H - 55, size: 9, font: regular, color: rgb(0.66, 0.64, 0.62) });

  y = H - 90;

  // Column headers
  page.drawRectangle({ x: margin, y: y - 18, width: W - margin * 2, height: 20, color: rgb(0.95, 0.95, 0.95) });
  const headerY = y - 12;
  [
    ["INVOICE",   colX.num],
    ["CUSTOMER / PROJECT", colX.customer],
    ["DATE",      colX.date],
    ["DUE",       colX.due],
    ["BALANCE",   colX.bal],
  ].forEach(([label, x]) =>
    page.drawText(String(label), { x: Number(x), y: headerY, size: 7, font: bold, color: stone600 })
  );
  y -= 22;

  // Rows
  rows.forEach((inv, idx) => {
    const bal  = openBal(inv);
    const days = daysOverdue(inv.dueDate);
    const rowH = inv.projectName ? 26 : 18;

    ensureSpace(rowH + 4);

    // Alternating background
    if (idx % 2 === 0) {
      page.drawRectangle({ x: margin, y: y - rowH + 4, width: W - margin * 2, height: rowH, color: rgb(0.98, 0.98, 0.98) });
    }

    const textY = y - 10;
    page.drawText(`#${inv.invoiceNumber}`, { x: colX.num, y: textY, size: 8, font: regular, color: stone900 });
    page.drawText(inv.customerName ?? "—", { x: colX.customer, y: inv.projectName ? textY + 4 : textY, size: 8, font: regular, color: stone900, maxWidth: 200 });
    if (inv.projectName) {
      page.drawText(inv.projectName, { x: colX.customer, y: textY - 7, size: 6.5, font: regular, color: stone600, maxWidth: 200 });
    }
    page.drawText(inv.invoiceDate, { x: colX.date, y: textY, size: 8, font: regular, color: stone900 });

    if (days > 0) {
      page.drawText(`${days}d overdue`, { x: colX.due, y: textY, size: 8, font: bold, color: red });
    } else {
      page.drawText(inv.dueDate, { x: colX.due, y: textY, size: 8, font: regular, color: stone900 });
    }

    page.drawText(fmt(bal, inv.currency || "EUR"), { x: colX.bal, y: textY, size: 8, font: bold, color: stone900 });

    // Row divider
    page.drawLine({ start: { x: margin, y: y - rowH + 4 }, end: { x: W - margin, y: y - rowH + 4 }, thickness: 0.4, color: stone200 });
    y -= rowH;
  });

  // Total footer
  ensureSpace(30);
  const total = rows.reduce((s, i) => s + openBal(i), 0);
  page.drawRectangle({ x: margin, y: y - 22, width: W - margin * 2, height: 26, color: stone900 });
  page.drawText("TOTAL OUTSTANDING", { x: margin + 5, y: y - 12, size: 9, font: bold, color: white });
  page.drawText(fmt(total), { x: colX.bal, y: y - 12, size: 9, font: bold, color: white });

  const pdfBytes = await pdfDoc.save();
  return Buffer.from(pdfBytes);
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

  // Resolve recipient — use chat-provided address or fall back to billing email on file
  let toAddress = args.to?.trim();
  if (!toAddress) {
    // Try invoice billingEmail first, then customer email
    const [sample] = await db
      .select({ billingEmail: invoices.billingEmail, customerEmail: customers.email })
      .from(invoices)
      .leftJoin(customers, eq(customers.id, invoices.customerId))
      .where(eq(invoices.id, rows[0].id))
      .limit(1);
    toAddress = sample?.billingEmail?.split(",")[0]?.trim() || sample?.customerEmail?.trim() || "";
  }
  if (!toAddress) {
    return `No recipient email provided and no billing email found on file for "${resolved.label}". Please specify an email address to send to.`;
  }

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
      to:      toAddress,
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

  return `✅ Sent ${rows.length} invoice(s) totalling ${fmt(total)} to ${toAddress}${args.cc ? ` (CC: ${args.cc})` : ""}\nPDF statement attached · via ${transport}`;
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
