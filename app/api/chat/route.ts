import { db } from "@/db";
import { invoices, customers, projects } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { sendEmail } from "@/lib/mailer";
import { eq, and, ilike, ne } from "drizzle-orm";
import Groq from "groq-sdk";
import { NextResponse } from "next/server";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS: Groq.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "send_invoices",
      description: "Send open invoices for a project or customer via email",
      parameters: {
        type: "object",
        properties: {
          projectName:  { type: "string", description: "Project name (partial match)" },
          customerName: { type: "string", description: "Customer name (partial match)" },
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

function fmt(n: number, ccy = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(n);
}

// ── Tool executors ────────────────────────────────────────────────────────────
async function fetchOpenInvoices(orgId: string, projectName?: string, customerName?: string) {
  const allInvoices = await db
    .select({
      id: invoices.id,
      invoiceNumber: invoices.invoiceNumber,
      invoiceDate: invoices.invoiceDate,
      dueDate: invoices.dueDate,
      total: invoices.total,
      paid: invoices.paid,
      qboBalance: invoices.qboBalance,
      paymentStatus: invoices.paymentStatus,
      txnType: invoices.txnType,
      currency: invoices.currency,
      customerId: invoices.customerId,
      projectId: invoices.projectId,
      customerName: customers.name,
      projectName: projects.name,
    })
    .from(invoices)
    .leftJoin(customers, eq(customers.id, invoices.customerId))
    .leftJoin(projects, eq(projects.id, invoices.projectId))
    .where(
      and(
        eq(invoices.orgId, orgId),
        ne(invoices.paymentStatus, "Paid"),
        ne(invoices.txnType, "CreditMemo"),
      )
    );

  let filtered = allInvoices;

  if (projectName) {
    const lower = projectName.toLowerCase();
    filtered = filtered.filter(i => i.projectName?.toLowerCase().includes(lower));
  }
  if (customerName) {
    const lower = customerName.toLowerCase();
    filtered = filtered.filter(i => i.customerName?.toLowerCase().includes(lower));
  }

  return filtered;
}

async function toolGetInvoices(orgId: string, args: any): Promise<string> {
  const rows = await fetchOpenInvoices(orgId, args.projectName, args.customerName);

  if (rows.length === 0) {
    return "No open invoices found matching your criteria.";
  }

  const status = args.status || "open";
  let display = rows;
  if (status === "overdue") display = rows.filter(i => daysOverdue(i.dueDate) > 0);

  const total = display.reduce((s, i) => s + openBal(i), 0);
  const lines = display.slice(0, 10).map(i => {
    const bal = openBal(i);
    const days = daysOverdue(i.dueDate);
    const tag = days > 0 ? ` (${days}d overdue)` : ` (due ${i.dueDate})`;
    return `• #${i.invoiceNumber} — ${i.customerName}${i.projectName ? ` / ${i.projectName}` : ""} — ${fmt(bal, i.currency)}${tag}`;
  }).join("\n");

  const more = display.length > 10 ? `\n…and ${display.length - 10} more` : "";
  return `Found ${display.length} ${status} invoice(s) totalling ${fmt(total)}:\n${lines}${more}`;
}

async function toolSendInvoices(orgId: string, args: any): Promise<string> {
  const rows = await fetchOpenInvoices(orgId, args.projectName, args.customerName);

  if (rows.length === 0) {
    return "No open invoices found matching your criteria — nothing was sent.";
  }

  const total = rows.reduce((s, i) => s + openBal(i), 0);

  // Build HTML email
  const subject = args.projectName
    ? `Open Invoices — ${args.projectName}`
    : args.customerName
    ? `Open Invoices — ${args.customerName}`
    : "Open Invoices Statement";

  const rows_html = rows.map(i => {
    const bal = openBal(i);
    const days = daysOverdue(i.dueDate);
    const overdueStyle = days > 0 ? 'color:#dc2626;font-weight:600;' : 'color:#374151;';
    const overdueLabel = days > 0 ? `${days}d overdue` : `Due ${i.dueDate}`;
    return `
      <tr style="border-bottom:1px solid #e5e7eb;">
        <td style="padding:10px 12px;font-size:13px;color:#374151;">#${i.invoiceNumber}</td>
        <td style="padding:10px 12px;font-size:13px;color:#374151;">${i.customerName ?? "—"}${i.projectName ? `<br><span style="font-size:11px;color:#6b7280;">${i.projectName}</span>` : ""}</td>
        <td style="padding:10px 12px;font-size:13px;color:#374151;">${i.invoiceDate}</td>
        <td style="padding:10px 12px;font-size:13px;${overdueStyle}">${overdueLabel}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:#111827;text-align:right;">${fmt(bal, i.currency)}</td>
      </tr>`;
  }).join("");

  const body = `
    <div style="font-family:Arial,sans-serif;max-width:680px;margin:0 auto;background:#fff;">
      <div style="background:#1c1917;padding:24px 32px;">
        <h1 style="color:#fff;margin:0;font-size:20px;font-weight:600;">${subject}</h1>
        <p style="color:#a8a29e;margin:6px 0 0;font-size:13px;">As of ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}</p>
      </div>
      <div style="padding:24px 32px;">
        <p style="font-size:14px;color:#374151;margin:0 0 20px;">Please find below the outstanding invoices. Kindly arrange payment at your earliest convenience.</p>
        <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;">
          <thead>
            <tr style="background:#f9fafb;">
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Invoice</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Customer / Project</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Date</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:left;">Due</th>
              <th style="padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.05em;color:#6b7280;text-align:right;">Balance</th>
            </tr>
          </thead>
          <tbody>${rows_html}</tbody>
          <tfoot>
            <tr style="background:#f9fafb;">
              <td colspan="4" style="padding:12px;font-size:13px;font-weight:700;color:#111827;">Total Outstanding</td>
              <td style="padding:12px;font-size:15px;font-weight:700;color:#111827;text-align:right;">${fmt(total)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;

  try {
    await sendEmail(orgId, {
      to: args.to,
      cc: args.cc,
      subject,
      body,
    });
    return `✓ Sent ${rows.length} invoice(s) totalling ${fmt(total)} to ${args.to}${args.cc ? ` (CC: ${args.cc})` : ""}.`;
  } catch (e: any) {
    return `Failed to send email: ${e?.message ?? "Unknown error"}. Check your email settings in Settings → Email.`;
  }
}

async function toolGetArSummary(orgId: string, args: any): Promise<string> {
  const rows = await fetchOpenInvoices(orgId, args.projectName, args.customerName);

  if (rows.length === 0) return "No open AR found matching your criteria.";

  const totalAR = rows.reduce((s, i) => s + openBal(i), 0);
  const overdue = rows.filter(i => daysOverdue(i.dueDate) > 0);
  const overdueAR = overdue.reduce((s, i) => s + openBal(i), 0);
  const over90 = overdue.filter(i => daysOverdue(i.dueDate) > 90).reduce((s, i) => s + openBal(i), 0);

  const scope = args.projectName ? ` for project "${args.projectName}"` : args.customerName ? ` for "${args.customerName}"` : "";
  return [
    `AR Summary${scope}:`,
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

  const systemPrompt = `You are a helpful accounts receivable assistant embedded in a financial management app called Ledger.
You help users query invoices, check overdue amounts, and send invoice emails to customers.
Be concise and professional. When users ask to send invoices, always confirm what was sent.
If a request is ambiguous (e.g. no email address for sending), ask for clarification.
Today is ${new Date().toLocaleDateString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}.`;

  const messages: Groq.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-6), // keep last 3 exchanges for context
    { role: "user", content: message },
  ];

  // First call — let Groq decide if a tool is needed
  const first = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages,
    tools: TOOLS,
    tool_choice: "auto",
    temperature: 0.1,
  });

  const choice = first.choices[0];

  // No tool call — just a conversational reply
  if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
    return NextResponse.json({ reply: choice.message.content ?? "I'm not sure how to help with that." });
  }

  // Execute tool calls
  const toolCall = choice.message.tool_calls[0];
  const toolName = toolCall.function.name;
  let toolArgs: any = {};
  try { toolArgs = JSON.parse(toolCall.function.arguments); } catch {}

  let toolResult = "";
  try {
    if (toolName === "send_invoices")  toolResult = await toolSendInvoices(orgId!, toolArgs);
    else if (toolName === "get_invoices")   toolResult = await toolGetInvoices(orgId!, toolArgs);
    else if (toolName === "get_ar_summary") toolResult = await toolGetArSummary(orgId!, toolArgs);
    else toolResult = "Unknown tool.";
  } catch (e: any) {
    toolResult = `Error: ${e?.message ?? "Something went wrong."}`;
  }

  // Second call — format tool result as a natural reply
  const second = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    messages: [
      ...messages,
      choice.message,
      { role: "tool", tool_call_id: toolCall.id, content: toolResult },
    ],
    temperature: 0.2,
  });

  return NextResponse.json({ reply: second.choices[0].message.content ?? toolResult });
}
