import { db } from "@/db";
import { invoices, customers, projects, users, reps as repsTable, communications, contacts } from "@/db/schema";
import { requireOrg, bad } from "@/lib/api";
import { sendEmail, type MailAttachment } from "@/lib/mailer";
import { getOrgQboToken } from "@/lib/qbo-token";
import { getOrgXeroToken } from "@/lib/xero-token";
import { createPortalToken } from "@/lib/portal";
import { genEmailRef } from "@/lib/email-ref";
import { renderInvoiceEmail } from "@/lib/ar-email";
import { eq, and, ilike, ne, gte, lte, isNull } from "drizzle-orm";
import OpenAI from "openai";
import { NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Tool definitions ──────────────────────────────────────────────────────────
const TOOLS: OpenAI.Chat.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "get_collections_briefing",
      description: "Proactive 'what should I chase today' digest — prioritised across the whole portfolio. Returns: top priority chases, broken promises, promises due today, new disputes, and accounts crossing 90 days.\nTRIGGER: \"what should I do today\", \"daily briefing\", \"where do I start\", \"what needs my attention\", \"morning summary\", \"what to chase\", \"help me prioritise\", \"give me a plan\".",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "suggest_next_action",
      description: "Recommend the next-best collection action for a SPECIFIC customer or project, based on aging, stage, promises, disputes and last contact. Explains the reasoning and proposes the concrete next step.\nTRIGGER: \"what should I do about X\", \"how should I handle X\", \"next step for X\", \"what's the best action for X\", \"should I escalate X\", \"how do I chase X\".",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string" },
          customerName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_contact_info",
      description: "Get the billing email(s) and contacts on file for a specific project or customer.\nTRIGGER: \"what's the email for X\", \"who do I contact at X\", \"billing email on X\", \"contact details for X\", \"what email is on [project/invoice]\".",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Project name or code (e.g. D24005)" },
          customerName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "list_portfolio",
      description: "Show all open projects/customers in the user's portfolio with balances.\nTRIGGER: \"show my portfolio\", \"what's open\", \"list my projects\", \"what do I have\", \"show everything\", \"all projects\", \"my accounts\".",
      parameters: {
        type: "object",
        properties: {
          sortBy: { type: "string", enum: ["outstanding", "overdue", "oldest"], description: "Default: outstanding" },
          filter: { type: "string", enum: ["all", "overdue", "current"], description: "Default: all" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_priority_list",
      description: "Return a prioritised chase list — invoices most urgently needing action, scored by days overdue x balance.\nTRIGGER: \"what should I chase\", \"what needs attention\", \"priority list\", \"what to follow up\", \"most urgent\", \"top overdue\", \"worst accounts\", \"where should I focus\", \"who hasn't paid\".",
      parameters: {
        type: "object",
        properties: {
          minDaysOverdue: { type: "number", description: "Only include invoices overdue by at least this many days. E.g. 90 for '90+ days' queries." },
          limit: { type: "number", description: "Max results to return (default 10)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_aging",
      description: "Show aging breakdown: Current / 1-30d / 31-60d / 61-90d / 90+ days.\nTRIGGER: \"aging breakdown\", \"aging report\", \"how old is the debt\", \"aging for X\", \"bucket breakdown\", \"what's in 90+ days\", \"how much is current vs overdue\".",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string" },
          customerName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_due_soon",
      description: "Show invoices coming due within the next N days — for proactive chasing before they go overdue.\nTRIGGER: \"due this week\", \"due soon\", \"coming due\", \"due in 7 days\", \"due in 30 days\", \"what's due next week\", \"upcoming payments\", \"invoices due this month\".",
      parameters: {
        type: "object",
        properties: {
          days: { type: "number", description: "Look ahead window in days (default 7, use 30 for this month)" },
          projectName: { type: "string" },
          customerName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_invoices",
      description: "Get the full invoice list for a SPECIFIC named project or customer.\nTRIGGER: when user names a specific project or customer and wants to see their invoices.\nExamples: \"show invoices for MW22004\", \"open invoices for Acme\", \"overdue for Barna project\".\nSet status=\"overdue\" when user says overdue/past due/late. status=\"open\" for unpaid. status=\"all\" for everything.",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string", description: "Project name or code — use exact words the user said" },
          customerName: { type: "string", description: "Customer/company name" },
          status: { type: "string", enum: ["open", "overdue", "all"] },
          minDaysOverdue: { type: "number", description: "Only include invoices overdue by at least this many days. Use 365 for '1 year+', 180 for '6 months+', 90 for '90+ days', etc." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_ar_summary",
      description: "Get total AR amounts (no invoice list) for a project, customer, or whole portfolio.\nTRIGGER: \"AR summary for X\", \"how much does X owe\", \"total outstanding for X\", \"balance on X\", \"overdue amount for X\", \"total AR\".",
      parameters: {
        type: "object",
        properties: {
          projectName: { type: "string" },
          customerName: { type: "string" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "update_invoice",
      description: "Update the collection stage of an invoice or add a follow-up note.\nTRIGGER: \"mark invoice X as promised\", \"set #7544 to disputed\", \"mark as in progress\", \"add note to invoice X\", \"escalate invoice X\", \"promise to pay on invoice X\".",
      parameters: {
        type: "object",
        properties: {
          invoiceNumber: { type: "string", description: "Invoice number (e.g. '7544' or '#7544')" },
          stage: { type: "string", enum: ["New", "In Progress", "Promised", "Disputed", "Escalated", "Written Off"], description: "New collection stage to set" },
          note: { type: "string", description: "Optional note to attach" },
          promiseDate: { type: "string", description: "Promise-to-pay date YYYY-MM-DD (for Promised stage)" },
        },
        required: ["invoiceNumber"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "send_invoices",
      description: "Email invoices as individual PDF attachments (fetched from QuickBooks).\nTRIGGER: ONLY when user says \"send\", \"email\", \"forward\" invoices to an address.\nExamples: \"send invoice 7786 to billing@client.com\" (a number = invoiceNumber), \"send invoices of MW22004 to billing@client.com CC finance@client.com\", \"send invoices overdue 365+ days to finance@client.com\".\nIf the user gives a bare number, treat it as invoiceNumber, NOT a project.\nOmit 'to' if no address given — system uses billing email on file.\nUse minDaysOverdue when user says 'overdue 180 days', '1 year+', '365+ days', etc.\nIMPORTANT: First call WITHOUT confirmed=true — the tool returns a confirmation summary. Only set confirmed=true after the user explicitly says yes/confirm/send it.",
      parameters: {
        type: "object",
        properties: {
          invoiceNumber: { type: "string", description: "A specific invoice number to send (e.g. '7786'). Use this when the user names an invoice number rather than a project/customer." },
          projectName: { type: "string" },
          customerName: { type: "string" },
          to: { type: "string", description: "Recipient email. Omit if not stated." },
          cc: { type: "string", description: "CC email(s), comma-separated" },
          minDaysOverdue: { type: "number", description: "Only send invoices overdue by at least this many days. Use 365 for '1 year+', 180 for '6 months+', 90 for '90+ days'." },
          confirmed: { type: "boolean", description: "Set to true ONLY after the user has explicitly confirmed the send. Default: omit (do not set)." },
        },
        required: [],
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
  | { status: "ok";      projectId?: string; customerId?: string; projectRepId?: string | null; label: string }
  | { status: "confirm"; message: string }
  | { status: "none";    message: string };

async function resolveEntity(
  orgId: string,
  projectName?: string,
  customerName?: string,
): Promise<MatchResult> {
  if (projectName) {
    const matches = await db
      .select({ id: projects.id, name: projects.name, repId: projects.repId })
      .from(projects)
      .where(and(eq(projects.orgId, orgId), ilike(projects.name, `%${projectName}%`)));

    if (matches.length === 0) {
      return { status: "none", message: `No project found matching "${projectName}".` };
    }
    if (matches.length === 1) {
      return { status: "ok", projectId: matches[0].id, projectRepId: matches[0].repId, label: matches[0].name };
    }

    // Multiple matches — check if exactly one starts with the search term (e.g. "MW22004")
    const lower = projectName.toLowerCase();
    const prefixMatches = matches.filter(p => p.name.toLowerCase().startsWith(lower));
    if (prefixMatches.length === 1) {
      return { status: "ok", projectId: prefixMatches[0].id, projectRepId: prefixMatches[0].repId, label: prefixMatches[0].name };
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
      qboId:         invoices.qboId,
      xeroId:        invoices.xeroId,
      paymentStatus: invoices.paymentStatus,
      txnType:       invoices.txnType,
      currency:      invoices.currency,
      customerId:     invoices.customerId,
      projectId:      invoices.projectId,
      customerName:   customers.name,
      customerRepId:  customers.repId,
      projectName:    projects.name,
      projectRepId:   projects.repId,
      collectionStage: invoices.collectionStage,
      promiseDate:    invoices.promiseDate,
      promiseAmount:  invoices.promiseAmount,
      hasOpenDispute: invoices.hasOpenDispute,
      lastFollowupDate: invoices.lastFollowupDate,
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

// ── QBO individual invoice PDF fetcher ───────────────────────────────────────
const QBO_API = "https://quickbooks.api.intuit.com/v3/company";

async function fetchQboPdf(token: { accessToken: string; realmId: string }, qboId: string): Promise<Buffer | null> {
  try {
    const res = await fetch(
      `${QBO_API}/${token.realmId}/invoice/${qboId}/pdf?minorversion=65`,
      {
        headers: { Authorization: `Bearer ${token.accessToken}`, Accept: "application/pdf" },
        signal: AbortSignal.timeout(15_000),
      }
    );
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 0 ? Buffer.from(buf) : null;
  } catch {
    return null;
  }
}

// ── Xero individual invoice PDF fetcher ──────────────────────────────────────
const XERO_API = "https://api.xero.com/api.xro/2.0";

async function fetchXeroPdf(token: { accessToken: string; tenantId: string }, xeroId: string): Promise<Buffer | null> {
  try {
    const res = await fetch(`${XERO_API}/Invoices/${xeroId}`, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Xero-Tenant-Id": token.tenantId,
        Accept: "application/pdf",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return buf.byteLength > 0 ? Buffer.from(buf) : null;
  } catch {
    return null;
  }
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

// ── Tool: list_portfolio ──────────────────────────────────────────────────────
async function toolListPortfolio(orgId: string, args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const allRows = await fetchOpenInvoices(orgId);

  // Scope to visible reps using invoice-level ownership rule
  const visibleRows = visibleRepIds
    ? allRows.filter(i => {
        if (i.projectId) {
          return i.projectRepId != null && visibleRepIds.has(i.projectRepId as string);
        }
        return i.customerRepId != null && visibleRepIds.has(i.customerRepId as string);
      })
    : allRows;

  if (visibleRows.length === 0) return "No open invoices found in your portfolio.";

  // Group by project (or customer if no project)
  const groups: Record<string, { label: string; balance: number; overdue: number; count: number; maxDays: number }> = {};
  for (const i of visibleRows) {
    const key   = i.projectId ?? i.customerId;
    const label = i.projectName ?? i.customerName ?? "Unknown";
    const bal   = openBal(i);
    const days  = daysOverdue(i.dueDate);
    if (!groups[key]) groups[key] = { label, balance: 0, overdue: 0, count: 0, maxDays: 0 };
    groups[key].balance += bal;
    groups[key].count   += 1;
    if (days > 0) { groups[key].overdue += bal; groups[key].maxDays = Math.max(groups[key].maxDays, days); }
  }

  let sorted = Object.values(groups);
  const sortBy = args.sortBy || "outstanding";
  if (sortBy === "overdue")  sorted.sort((a, b) => b.maxDays - a.maxDays);
  else if (sortBy === "oldest") sorted.sort((a, b) => b.maxDays - a.maxDays);
  else sorted.sort((a, b) => b.balance - a.balance);

  const filter = args.filter || "all";
  if (filter === "overdue")  sorted = sorted.filter(g => g.overdue > 0);
  if (filter === "current")  sorted = sorted.filter(g => g.overdue === 0);

  const totalBal = sorted.reduce((s, g) => s + g.balance, 0);
  const totalOvd = sorted.reduce((s, g) => s + g.overdue, 0);

  const lines = sorted.slice(0, 15).map(g => {
    const ovdTag = g.overdue > 0 ? ` ⚠ ${fmt(g.overdue)} overdue (${g.maxDays}d)` : "";
    return `• ${g.label} — ${fmt(g.balance)} (${g.count} invoice${g.count > 1 ? "s" : ""})${ovdTag}`;
  }).join("\n");

  const more = sorted.length > 15 ? `\n…and ${sorted.length - 15} more` : "";
  return `Portfolio: ${sorted.length} project(s) · ${fmt(totalBal)} open · ${fmt(totalOvd)} overdue\n\n${lines}${more}`;
}

// ── Tool: get_invoices ────────────────────────────────────────────────────────
async function toolGetInvoices(orgId: string, args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const resolved = await resolveEntity(orgId, args.projectName, args.customerName);
  if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;

  if (visibleRepIds && resolved.projectId) {
    const projectRepId = resolved.projectRepId ?? null;
    if (!projectRepId || !visibleRepIds.has(projectRepId)) {
      return `⛔ "${resolved.label}" is not within your portfolio.`;
    }
  }

  const rows = await fetchOpenInvoices(orgId, resolved.projectId, resolved.customerId);
  if (rows.length === 0) return `No open invoices found for ${resolved.label}.`;

  const status = args.status || "open";
  let display = rows;
  if (status === "overdue") display = rows.filter(i => daysOverdue(i.dueDate) > 0);
  if (args.minDaysOverdue)  display = display.filter(i => daysOverdue(i.dueDate) >= args.minDaysOverdue);

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
async function toolSendInvoices(orgId: string, args: any, visibleRepIds: Set<string> | null, userId: string): Promise<string> {
  let rows: Awaited<ReturnType<typeof fetchOpenInvoices>>;
  let label: string;

  // Path A: a specific invoice number was given ("send invoice 7786 to …")
  if (args.invoiceNumber && !args.projectName && !args.customerName) {
    const num = String(args.invoiceNumber).replace(/^#/, "").trim();
    const all = await fetchOpenInvoices(orgId);
    rows = all.filter(i => i.invoiceNumber === num);
    if (rows.length === 0) return `No open invoice found with number "${num}". It may be paid, closed, or the number may be different.`;
    if (visibleRepIds) {
      rows = scopeToVisible(rows, visibleRepIds);
      if (rows.length === 0) return `⛔ Invoice #${num} is not within your portfolio.`;
    }
    label = `#${num}`;
  } else {
    // Path B: resolve a project / customer
    const resolved = await resolveEntity(orgId, args.projectName, args.customerName);
    if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;
    if (visibleRepIds && resolved.projectId) {
      const projectRepId = resolved.projectRepId ?? null;
      if (!projectRepId || !visibleRepIds.has(projectRepId)) {
        return `⛔ "${resolved.label}" is not within your portfolio. You can only send invoices for projects assigned to you or your team.`;
      }
    }
    rows = await fetchOpenInvoices(orgId, resolved.projectId, resolved.customerId);
    if (args.minDaysOverdue) rows = rows.filter(i => daysOverdue(i.dueDate) >= args.minDaysOverdue);
    if (rows.length === 0) {
      const ageTag = args.minDaysOverdue ? ` overdue by ${args.minDaysOverdue}+ days` : "";
      return `No open invoices${ageTag} found for "${resolved.label}" — nothing sent.`;
    }
    label = resolved.label;
  }

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
    return `No recipient email provided and no billing email found on file for "${label}". Please specify an email address to send to.`;
  }

  // ── Confirmation gate — show summary and wait for user to confirm ─────────
  if (!args.confirmed) {
    const total = rows.reduce((s, i) => s + openBal(i), 0);
    const ageNote = args.minDaysOverdue ? ` (overdue ${args.minDaysOverdue}+ days)` : "";
    const invLines = rows.slice(0, 8).map(i => {
      const days = daysOverdue(i.dueDate);
      const tag  = days > 0 ? ` — ${days}d overdue` : ` — due ${i.dueDate}`;
      return `  • #${i.invoiceNumber}${tag} — ${fmt(openBal(i), i.currency)}`;
    }).join("\n");
    const more = rows.length > 8 ? `\n  …and ${rows.length - 8} more` : "";
    // Embed resolved args so the handler can replay the send on "confirm"
    // without asking Groq to reconstruct parameters (which it gets wrong).
    const pendingPayload = JSON.stringify({
      invoiceNumber:  args.invoiceNumber,
      projectName:    args.projectName,
      customerName:   args.customerName,
      to:             toAddress,        // already resolved
      cc:             args.cc,
      minDaysOverdue: args.minDaysOverdue,
    });
    return [
      `📋 Please confirm before sending:`,
      ``,
      `Project/Customer: ${label}`,
      `To: ${toAddress}${args.cc ? `\nCC: ${args.cc}` : ""}`,
      `Invoices${ageNote}: ${rows.length} invoice(s) — ${fmt(total)} total`,
      invLines + more,
      ``,
      `Reply "confirm" or "yes, send" to proceed.[__PENDING__:${pendingPayload}]`,
    ].join("\n");
  }

  const total    = rows.reduce((s, i) => s + openBal(i), 0);
  const emailRef = genEmailRef();
  const subject  = `Open Invoices — ${label} — Ref ${emailRef}`;
  const dateStr  = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

  // Generate a single-use customer portal link covering these invoices so the
  // customer can self-report a promise date or raise a dispute.
  let portalUrl: string | null = null;
  const portalCustomerId = rows[0]?.customerId;
  if (portalCustomerId) {
    try {
      const { url } = await createPortalToken(orgId, portalCustomerId, rows.map(r => r.id), userId);
      portalUrl = url;
    } catch (e: any) {
      console.warn("chat: portal link generation failed:", e?.message);
    }
  }

  // HTML email body — shared branded template (single source of truth)
  const body = renderInvoiceEmail({
    subject,
    dateStr,
    total,
    rows: rows.map(i => ({
      invoiceNumber: i.invoiceNumber,
      customerName:  i.customerName,
      projectName:   i.projectName,
      invoiceDate:   i.invoiceDate,
      dueDate:       i.dueDate,
      balance:       openBal(i),
      currency:      i.currency,
      daysOverdue:   daysOverdue(i.dueDate),
    })),
    portalUrl,
  });

  // Build attachments — prefer the real invoice PDFs (Xero from Xero, the rest
  // from QBO), fall back to a generated statement.
  let attachments: MailAttachment[] = [];
  const qboToken = await getOrgQboToken(orgId);
  const needsXero = rows.some(r => (r as any).xeroId && !(r as any).xeroId.startsWith("CN-"));
  let xeroToken: Awaited<ReturnType<typeof getOrgXeroToken>> | null = null;
  if (needsXero) {
    try { xeroToken = await getOrgXeroToken(orgId); } catch { xeroToken = null; }
  }
  if (qboToken || xeroToken) {
    const pdfs = await Promise.all(
      rows.map(async r => {
        const xeroId = (r as any).xeroId as string | null | undefined;
        let buf: Buffer | null = null;
        if (xeroId && !xeroId.startsWith("CN-")) {
          if (xeroToken) buf = await fetchXeroPdf(xeroToken, xeroId);
        } else if (qboToken && r.qboId && !r.qboId.startsWith("CM-")) {
          buf = await fetchQboPdf(qboToken, r.qboId);
        }
        if (!buf) return null;
        return { filename: `Invoice-${r.invoiceNumber}.pdf`, content: buf, contentType: "application/pdf" } as MailAttachment;
      })
    );
    attachments = pdfs.filter(Boolean) as MailAttachment[];
  }
  // Fall back to a single statement PDF if not connected or all fetches failed
  if (attachments.length === 0) {
    const statementBuf = await generateStatementPDF(rows, subject);
    attachments = [{ filename: `${label.replace(/[^a-zA-Z0-9 ]/g, "")}_Statement.pdf`, content: statementBuf, contentType: "application/pdf" }];
  }

  let transport = "";
  try {
    const result = await sendEmail(orgId, {
      to:      toAddress,
      cc:      args.cc,
      subject,
      body,
      attachments,
    });
    transport = result.transport;
  } catch (e: any) {
    const msg = e?.message ?? "Unknown error";
    return `❌ Email not sent — ${msg}\n\nCheck Settings → Email to make sure Gmail, Outlook or SMTP is connected.`;
  }

  // Log each invoice to the communications tab
  const logRows = rows.map(i => ({
    orgId,
    customerId:  i.customerId!,
    projectId:   i.projectId ?? null,
    invoiceId:   i.id,
    direction:   "Outbound" as const,
    channel:     "Email" as const,
    subject,
    recipients:  toAddress + (args.cc ? `, ${args.cc}` : ""),
    matchedBy:   "AI",
    isDraft:     false,
    authorId:    userId,
    stageAtSend: null as string | null,
    refNumber:   emailRef,
  }));
  await db.insert(communications).values(logRows).catch(err =>
    console.warn("chat: failed to log communications:", err?.message)
  );

  return `✅ Sent ${rows.length} invoice(s) totalling ${fmt(total)} to ${toAddress}${args.cc ? ` (CC: ${args.cc})` : ""}\nPDF statement attached · via ${transport}`;
}

// ── Tool: get_ar_summary ──────────────────────────────────────────────────────
async function toolGetArSummary(orgId: string, args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const resolved = await resolveEntity(orgId, args.projectName, args.customerName);
  if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;

  if (visibleRepIds && resolved.projectId) {
    const projectRepId = resolved.projectRepId ?? null;
    if (!projectRepId || !visibleRepIds.has(projectRepId)) {
      return `⛔ "${resolved.label}" is not within your portfolio.`;
    }
  }

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

// ── Tool: get_priority_list ───────────────────────────────────────────────────
async function toolGetPriorityList(orgId: string, args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const allRows = await fetchOpenInvoices(orgId);
  const scoped = visibleRepIds
    ? allRows.filter(i => {
        const repId = i.projectId ? (i as any).projectRepId : (i as any).customerRepId;
        return repId && visibleRepIds.has(repId);
      })
    : allRows;

  const minDays = args.minDaysOverdue ?? 1;
  const limit   = args.limit ?? 10;

  const overdue = scoped
    .filter(i => daysOverdue(i.dueDate) >= minDays)
    .map(i => ({ ...i, days: daysOverdue(i.dueDate), bal: openBal(i), score: daysOverdue(i.dueDate) * openBal(i) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  if (overdue.length === 0) return minDays > 1 ? `No invoices overdue by ${minDays}+ days.` : "No overdue invoices found.";

  const lines = overdue.map((i, idx) => {
    const label = i.projectName ?? i.customerName ?? "Unknown";
    return `${idx + 1}. #${i.invoiceNumber} — ${label} — ${fmt(i.bal, i.currency)} (${i.days}d overdue)`;
  }).join("\n");

  const total = overdue.reduce((s, i) => s + i.bal, 0);
  return `Top ${overdue.length} invoices to chase (${minDays > 1 ? `${minDays}+d overdue` : "by priority"}) — ${fmt(total)} total:\n\n${lines}`;
}

// ── Tool: get_aging ───────────────────────────────────────────────────────────
async function toolGetAging(orgId: string, args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const resolved = args.projectName || args.customerName
    ? await resolveEntity(orgId, args.projectName, args.customerName)
    : { status: "ok" as const, label: "portfolio" };

  if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;

  const rows = await fetchOpenInvoices(
    orgId,
    (resolved as any).projectId,
    (resolved as any).customerId,
  );

  const scoped = visibleRepIds
    ? rows.filter(i => {
        const repId = i.projectId ? (i as any).projectRepId : (i as any).customerRepId;
        return repId == null || visibleRepIds.has(repId);
      })
    : rows;

  if (scoped.length === 0) return `No open invoices found for ${resolved.label}.`;

  const buckets = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };
  const counts  = { current: 0, d30: 0, d60: 0, d90: 0, d90plus: 0 };

  for (const i of scoped) {
    const d   = daysOverdue(i.dueDate);
    const bal = openBal(i);
    if (d <= 0)       { buckets.current += bal; counts.current++; }
    else if (d <= 30) { buckets.d30     += bal; counts.d30++; }
    else if (d <= 60) { buckets.d60     += bal; counts.d60++; }
    else if (d <= 90) { buckets.d90     += bal; counts.d90++; }
    else              { buckets.d90plus += bal; counts.d90plus++; }
  }

  const total = Object.values(buckets).reduce((s, v) => s + v, 0);
  const pct   = (v: number) => total > 0 ? ` (${Math.round(v / total * 100)}%)` : "";

  return [
    `Aging breakdown for ${resolved.label}:`,
    `• Current:   ${fmt(buckets.current)}${pct(buckets.current)} — ${counts.current} invoice(s)`,
    `• 1–30d:     ${fmt(buckets.d30)}${pct(buckets.d30)} — ${counts.d30} invoice(s)`,
    `• 31–60d:    ${fmt(buckets.d60)}${pct(buckets.d60)} — ${counts.d60} invoice(s)`,
    `• 61–90d:    ${fmt(buckets.d90)}${pct(buckets.d90)} — ${counts.d90} invoice(s)`,
    `• 90+ days:  ${fmt(buckets.d90plus)}${pct(buckets.d90plus)} — ${counts.d90plus} invoice(s)`,
    `\nTotal open: ${fmt(total)}`,
  ].join("\n");
}

// ── Tool: get_due_soon ────────────────────────────────────────────────────────
async function toolGetDueSoon(orgId: string, args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const days    = args.days ?? 7;
  const todayMs = Date.now();
  const endMs   = todayMs + days * 86_400_000;

  const resolved = args.projectName || args.customerName
    ? await resolveEntity(orgId, args.projectName, args.customerName)
    : { status: "ok" as const, label: "portfolio" };

  if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;

  const rows = await fetchOpenInvoices(orgId, (resolved as any).projectId, (resolved as any).customerId);

  const scoped = visibleRepIds
    ? rows.filter(i => {
        const repId = i.projectId ? (i as any).projectRepId : (i as any).customerRepId;
        return repId == null || visibleRepIds.has(repId);
      })
    : rows;

  const dueSoon = scoped
    .filter(i => {
      const t = new Date(i.dueDate).getTime();
      return t >= todayMs && t <= endMs;
    })
    .sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());

  if (dueSoon.length === 0) return `No invoices due in the next ${days} day(s).`;

  const total = dueSoon.reduce((s, i) => s + openBal(i), 0);
  const lines = dueSoon.map(i => {
    const label = i.projectName ?? i.customerName ?? "Unknown";
    return `• #${i.invoiceNumber} — ${label} — ${fmt(openBal(i), i.currency)} (due ${i.dueDate})`;
  }).join("\n");

  return `${dueSoon.length} invoice(s) due in the next ${days} day(s) — ${fmt(total)} total:\n\n${lines}`;
}

// ── Tool: update_invoice ──────────────────────────────────────────────────────
async function toolUpdateInvoice(orgId: string, args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const num = String(args.invoiceNumber).replace(/^#/, "").trim();

  const [inv] = await db
    .select({ id: invoices.id, invoiceNumber: invoices.invoiceNumber, projectId: invoices.projectId, customerId: invoices.customerId, collectionStage: invoices.collectionStage })
    .from(invoices)
    .where(and(eq(invoices.orgId, orgId), eq(invoices.invoiceNumber, num)))
    .limit(1);

  if (!inv) return `No invoice found with number "${num}" in your org.`;

  // Scope check
  if (visibleRepIds) {
    const [projRep] = inv.projectId
      ? await db.select({ repId: projects.repId }).from(projects).where(eq(projects.id, inv.projectId)).limit(1)
      : [];
    const [custRep] = !inv.projectId
      ? await db.select({ repId: customers.repId }).from(customers).where(eq(customers.id, inv.customerId)).limit(1)
      : [];
    const repId = projRep?.repId ?? custRep?.repId ?? null;
    if (!repId || !visibleRepIds.has(repId)) return `⛔ Invoice #${num} is not within your portfolio.`;
  }

  const updates: Record<string, any> = {};
  if (args.stage)       updates.collectionStage = args.stage;
  if (args.promiseDate) updates.promiseDate      = args.promiseDate;
  if (args.note)        updates.notes            = args.note;

  if (Object.keys(updates).length === 0) return `Nothing to update on invoice #${num}. Specify a stage, note, or promise date.`;

  await db.update(invoices).set(updates).where(eq(invoices.id, inv.id));

  const parts = [];
  if (args.stage)       parts.push(`stage → ${args.stage}`);
  if (args.promiseDate) parts.push(`promise date → ${args.promiseDate}`);
  if (args.note)        parts.push(`note added`);
  return `✅ Invoice #${num} updated: ${parts.join(", ")}.`;
}

// ── Shared scoping helper ─────────────────────────────────────────────────────
function scopeToVisible<T extends { projectId: string | null; projectRepId: any; customerRepId: any }>(
  rows: T[], visibleRepIds: Set<string> | null,
): T[] {
  if (!visibleRepIds) return rows;
  return rows.filter(i => {
    const owner = i.projectId ? i.projectRepId : i.customerRepId;
    return owner != null && visibleRepIds.has(owner as string);
  });
}

// ── Tool: get_collections_briefing — proactive "what to chase today" ──────────
async function toolGetCollectionsBriefing(orgId: string, _args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const all = scopeToVisible(await fetchOpenInvoices(orgId), visibleRepIds);
  if (all.length === 0) return "Your portfolio is all clear — no open invoices to chase. 🎉";

  const today = new Date().toISOString().slice(0, 10);
  const openNonDisputed = all.filter(i => !i.hasOpenDispute);

  const priority = openNonDisputed
    .filter(i => daysOverdue(i.dueDate) > 0)
    .map(i => ({ ...i, d: daysOverdue(i.dueDate), bal: openBal(i) }))
    .sort((a, b) => (b.d * b.bal) - (a.d * a.bal))
    .slice(0, 5);
  const broken   = all.filter(i => i.promiseDate && i.promiseDate < today && !i.hasOpenDispute);
  const dueToday = all.filter(i => i.promiseDate === today && !i.hasOpenDispute);
  const disputes = all.filter(i => i.hasOpenDispute);
  const over90   = openNonDisputed.filter(i => daysOverdue(i.dueDate) > 90);

  const totalOpen  = all.reduce((s, i) => s + openBal(i), 0);
  const overdueAmt = openNonDisputed.filter(i => daysOverdue(i.dueDate) > 0).reduce((s, i) => s + openBal(i), 0);
  const nm = (i: any) => i.projectName ?? i.customerName ?? "Unknown";

  const lines: string[] = [`📊 Portfolio: ${fmt(totalOpen)} open · ${fmt(overdueAmt)} overdue`];

  if (priority.length) {
    lines.push(`\n🔴 Chase first (${priority.length}):`);
    priority.forEach((i, idx) => lines.push(`  ${idx + 1}. #${i.invoiceNumber} — ${nm(i)} — ${fmt(i.bal, i.currency)} (${i.d}d overdue)`));
  }
  if (broken.length) {
    lines.push(`\n⚠️ Broken promises (${broken.length}) — follow up:`);
    broken.slice(0, 5).forEach(i => lines.push(`  • #${i.invoiceNumber} — ${nm(i)} — promised ${i.promiseDate}, ${fmt(openBal(i), i.currency)}`));
  }
  if (dueToday.length) {
    lines.push(`\n📅 Promises due TODAY (${dueToday.length}):`);
    dueToday.forEach(i => lines.push(`  • #${i.invoiceNumber} — ${nm(i)} — ${fmt(openBal(i), i.currency)}`));
  }
  if (disputes.length) {
    lines.push(`\n🔵 Open disputes (${disputes.length}) — resolve (chasing is paused):`);
    disputes.slice(0, 5).forEach(i => lines.push(`  • #${i.invoiceNumber} — ${nm(i)} — ${fmt(openBal(i), i.currency)}`));
  }
  if (over90.length) {
    lines.push(`\n🚨 90+ days (${over90.length}) — ${fmt(over90.reduce((s, i) => s + openBal(i), 0))} — escalate or write off`);
  }
  if (priority.length === 0 && broken.length === 0 && dueToday.length === 0 && disputes.length === 0) {
    lines.push(`\n✅ Nothing urgent — everything is current or promised for a future date.`);
  }
  lines.push(`\nSay e.g. "send invoices for [the top one]", "escalate #X", or "what should I do about [customer]" and I'll help.`);
  return lines.join("\n");
}

// ── Tool: suggest_next_action — next-best-action for one customer/project ──────
async function toolSuggestNextAction(orgId: string, args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const resolved = await resolveEntity(orgId, args.projectName, args.customerName);
  if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;
  if (visibleRepIds && resolved.projectId) {
    const repId = resolved.projectRepId ?? null;
    if (!repId || !visibleRepIds.has(repId)) return `⛔ "${resolved.label}" is not within your portfolio.`;
  }

  const rows = scopeToVisible(await fetchOpenInvoices(orgId, resolved.projectId, resolved.customerId), visibleRepIds);
  if (rows.length === 0) return `No open invoices for "${resolved.label}" — nothing to action.`;

  const today  = new Date().toISOString().slice(0, 10);
  const total  = rows.reduce((s, i) => s + openBal(i), 0);
  const disputed       = rows.filter(i => i.hasOpenDispute);
  const broken         = rows.filter(i => i.promiseDate && i.promiseDate < today && !i.hasOpenDispute);
  const promisedFuture = rows.filter(i => i.promiseDate && i.promiseDate >= today && !i.hasOpenDispute);
  const overdue        = rows.filter(i => !i.hasOpenDispute && daysOverdue(i.dueDate) > 0);
  const maxDays        = rows.reduce((m, i) => Math.max(m, daysOverdue(i.dueDate)), 0);
  const neverContacted = overdue.filter(i => !i.lastFollowupDate);

  const recs: string[] = [];
  if (disputed.length)       recs.push(`Resolve the dispute on ${disputed.length} invoice(s) FIRST — chasing is paused until it's closed. Review the reason, then correct/credit or reject.`);
  if (broken.length)         recs.push(`${broken.length} promise(s) have passed unpaid — CALL to secure a firm new date or escalate. A repeat email rarely works after a broken promise.`);
  if (promisedFuture.length) recs.push(`${promisedFuture.length} invoice(s) have a future promise date — no chasing needed yet; set a reminder for the promised day.`);
  if (overdue.length) {
    if (maxDays > 90)      recs.push(`Oldest is ${maxDays}d overdue — send a FINAL notice and escalate; assess write-off if uncollectable.`);
    else if (maxDays > 30) recs.push(`Up to ${maxDays}d overdue — send a FIRM reminder and request a committed payment date.`);
    else                   recs.push(`Up to ${maxDays}d overdue — a GENTLE reminder is appropriate at this stage.`);
    if (neverContacted.length) recs.push(`${neverContacted.length} overdue invoice(s) have NO contact logged — reach out today.`);
  }
  if (recs.length === 0) recs.push(`Everything is current — no action needed yet. Best practice: a courtesy reminder ~7 days before the due date.`);

  const body = recs.map((r, i) => `${i + 1}. ${r}`).join("\n");
  return `Recommended actions for "${resolved.label}" (${rows.length} open · ${fmt(total)}):\n${body}\n\nWant me to send the invoices, set a promise/escalate the stage, or add a note? Just tell me.`;
}

// ── Tool: get_contact_info — emails across all three levels ───────────────────
async function toolGetContactInfo(orgId: string, args: any, visibleRepIds: Set<string> | null): Promise<string> {
  const resolved = await resolveEntity(orgId, args.projectName, args.customerName);
  if (resolved.status === "confirm" || resolved.status === "none") return resolved.message;
  if (visibleRepIds && resolved.projectId) {
    const repId = resolved.projectRepId ?? null;
    if (!repId || !visibleRepIds.has(repId)) return `⛔ "${resolved.label}" is not within your portfolio.`;
  }

  const projectId = resolved.projectId ?? null;
  let customerId = resolved.customerId ?? null;
  const projectName = projectId ? resolved.label : null;
  if (projectId && !customerId) {
    const [p] = await db.select({ customerId: projects.customerId }).from(projects).where(eq(projects.id, projectId)).limit(1);
    customerId = p?.customerId ?? null;
  }
  if (!customerId) return `Couldn't resolve a customer for "${resolved.label}".`;

  const [cust] = await db.select({ name: customers.name, email: customers.email })
    .from(customers).where(eq(customers.id, customerId)).limit(1);

  // Project-level chase contacts (automations)
  const projContacts = projectId
    ? await db.select().from(contacts).where(and(eq(contacts.orgId, orgId), eq(contacts.projectId, projectId)))
    : [];
  // Customer-level chase contacts (not tied to a project)
  const custContacts = await db.select().from(contacts)
    .where(and(eq(contacts.orgId, orgId), eq(contacts.customerId, customerId), isNull(contacts.projectId)));

  // Billing emails on the actual invoices (from QBO), scoped to this entity
  const invRows = await db.select({ billingEmail: invoices.billingEmail })
    .from(invoices)
    .where(and(
      eq(invoices.orgId, orgId), ne(invoices.txnType, "CreditMemo"),
      ...(projectId ? [eq(invoices.projectId, projectId)] : [eq(invoices.customerId, customerId)]),
    ));
  const billingSet = new Set<string>();
  invRows.forEach(r => (r.billingEmail || "").split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e.includes("@")).forEach(e => billingSet.add(e)));

  const fmtC = (c: any) =>
    `${c.email}${c.name ? ` — ${c.name}` : ""}${c.isPrimary ? " (primary)" : ""}${c.isEscalation ? " (escalation)" : ""}${c.receivesAuto ? "" : " [auto OFF]"}`;

  const lines: string[] = [`📇 Contacts for ${projectName ? `project "${projectName}"` : `"${cust?.name ?? resolved.label}"`}:`];

  if (projectId) {
    lines.push(`\n▸ Project-level chase contacts (used by automations for this project):`);
    lines.push(projContacts.length ? projContacts.map(c => `  • ${fmtC(c)}`).join("\n") : "  — none set at project level");
  }
  lines.push(`\n▸ Customer-level chase contacts (automations):`);
  lines.push(custContacts.length ? custContacts.map(c => `  • ${fmtC(c)}`).join("\n") : "  — none set");
  if (cust?.email) lines.push(`\n▸ Customer record email: ${cust.email}`);
  lines.push(`\n▸ Billing email(s) on the invoices (from QuickBooks):`);
  lines.push(billingSet.size ? [...billingSet].map(e => `  • ${e}`).join("\n") : "  — none on file");

  // Divergence warning — these sources can legitimately differ
  const allEmails = new Set<string>([
    ...billingSet,
    ...projContacts.map((c: any) => c.email.toLowerCase()),
    ...custContacts.map((c: any) => c.email.toLowerCase()),
  ]);
  if (allEmails.size > 1) {
    lines.push(`\n⚠️ These addresses differ across levels — confirm which to use before sending. By default an automated chase uses the project-level contact if set, otherwise the customer-level one; a manual send uses whatever you specify (falling back to the invoice billing email).`);
  }

  return lines.join("\n");
}

// ── POST ──────────────────────────────────────────────────────────────────────
export async function POST(req: Request) {
  const { error, session, orgId } = await requireOrg();
  if (error) return error;

  const { message, history = [] } = await req.json();
  if (!message?.trim()) return bad("message required");

  // Build visibleRepIds — mirrors rep portal scoping logic exactly.
  // null = no restriction (admin users see everything).
  const userId   = (session!.user as any).id as string;
  const userRole = (session!.user as any).role as string;
  const isAdmin  = userRole === "company_admin" || userRole === "company_user" || userRole === "super_admin";

  let visibleRepIds: Set<string> | null = null;
  if (!isAdmin) {
    const [u] = await db.select({ repId: users.repId }).from(users).where(eq(users.id, userId)).limit(1);
    if (u?.repId) {
      const myRepId = u.repId;
      // Direct reports of this rep
      const reports = await db.select({ id: repsTable.id }).from(repsTable)
        .where(and(eq(repsTable.orgId, orgId!), eq(repsTable.managerId, myRepId)));
      visibleRepIds = new Set([myRepId, ...reports.map(r => r.id)]);
    }
  }

  // Build user context for the system prompt
  const [userData] = await db
    .select({ name: users.name, repId: users.repId })
    .from(users).where(eq(users.id, userId)).limit(1);

  let repContext = "";
  if (userData?.repId) {
    const [rep] = await db.select().from(repsTable).where(eq(repsTable.id, userData.repId)).limit(1);
    if (rep) {
      const reports = await db.select({ name: repsTable.name }).from(repsTable)
        .where(and(eq(repsTable.orgId, orgId!), eq(repsTable.managerId, rep.id)));
      repContext = `\nThe user's rep profile: name="${rep.name}", tier="${rep.tier}"${reports.length > 0 ? `, manages: ${reports.map(r => r.name).join(", ")}` : ""}.`;
      if (visibleRepIds) repContext += `\nThey can only see/act on projects within their portfolio (${visibleRepIds.size} rep(s) in scope).`;
    }
  } else {
    repContext = "\nThis user is an admin and can access all projects and customers.";
  }

  const systemPrompt = `You are a proactive AR (Accounts Receivable) collections copilot embedded in Ledger AR.
You don't just answer questions — you help the accountant decide WHO to chase, WHAT action to take next, and you carry it out (send invoices, set promises, escalate stages, add notes).
When someone opens with a vague "where do I start / help me" → call get_collections_briefing.
After showing a briefing or recommendation, suggest the concrete next step and offer to do it.

STRICT RULES — follow these without exception:
1. IN SCOPE = everything about this company's AR: invoices, balances, aging, payments, collections, promises, disputes, customers, projects, AND their contacts / billing email addresses / who to chase. Questions like "what's the email on D24005" or "who do I contact at X" ARE in scope — call get_contact_info.
2. Only refuse if the request is clearly NOT about this company's AR data (general knowledge, essays, coding, weather, world news, opinions). Then reply exactly: "I can only help with AR-related questions such as invoices, outstanding balances, collections, and sending statements. What would you like to know about your AR?" When in doubt, assume it IS in scope and call the most relevant tool — do NOT refuse.
3. NEVER answer questions about amounts, balances, or AR data from memory. ALWAYS call a tool first.
4. ANY question about invoices, balances, overdue amounts, aging, or portfolio data requires a tool call.
5. When a tool returns a numbered list asking for clarification, copy it EXACTLY and wait for the user to choose.
6. A bare number like "7786" or "#7544" is an INVOICE NUMBER — pass it as invoiceNumber (send_invoices / update_invoice), never as a project or customer name.
7. Be concise — no need to restate what you just did. Lead with the result.
7. For follow-up questions like "total overdue?", "how many?", "send those" — infer the project/customer from conversation history.
8. If the user's request is unclear, ask one short clarifying question.

TOOL SELECTION GUIDE:
- "what should I do today / daily briefing / where do I start / morning summary / help me prioritise" → get_collections_briefing
- "what should I do about X / next step for X / how do I handle X / should I escalate X" → suggest_next_action
- "what's the email on X / who do I contact at X / billing email for X / contact details" → get_contact_info
- "show my portfolio / what's open / list projects" → list_portfolio
- "what should I chase / priority / most urgent / who hasn't paid" → get_priority_list
- "aging breakdown / aging report / buckets / 90+ days" → get_aging
- "due this week / coming due / due soon / due in X days" → get_due_soon
- "invoices for X / open for X / overdue for X" (specific entity) → get_invoices
- "how much does X owe / balance on X / total AR for X" → get_ar_summary
- "mark as promised / set to disputed / update stage / add note" → update_invoice
- "send / email / forward invoices to [email]" → send_invoices

AR DOMAIN KNOWLEDGE:
- Collection stages: New → In Progress → Committed → Disputed → Escalated → Written Off
- "Committed" means the customer has committed to a payment date — always set a promiseDate
- "Disputed" means there is a disagreement about the invoice — no chasing until resolved
- 90+ days overdue = high risk, prioritise immediately
- Best practice: chase at 7 days before due, 1 day after due, 7 days overdue, 30 days overdue

User: ${userData?.name ?? "Unknown"}${repContext}
Today: ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}.`;

  // ── Confirmation interceptor — if user just said "confirm"/"yes/send it"
  //    and there's a pending send in history, execute it directly. This
  //    bypasses Groq entirely so it can't reconstruct params incorrectly.
  const CONFIRM_RE = /^(confirm|yes|yes,?\s*send(\s*it)?|send\s*it|proceed|ok,?\s*(go|send)|go\s*ahead)$/i;
  if (CONFIRM_RE.test(message.trim())) {
    const pendingMsg = [...history].reverse().find((h: any) =>
      h.role === "assistant" && typeof h.content === "string" && h.content.includes("[__PENDING__:")
    );
    if (pendingMsg) {
      const match = (pendingMsg.content as string).match(/\[__PENDING__:(.*?)\]/);
      if (match) {
        try {
          const pendingArgs = { ...JSON.parse(match[1]), confirmed: true };
          const result = await toolSendInvoices(orgId!, pendingArgs, visibleRepIds, userId);
          return NextResponse.json({ reply: result });
        } catch (e: any) {
          return NextResponse.json({ reply: `❌ Failed to send: ${e?.message ?? "Unknown error"}` });
        }
      }
    }
  }

  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: "system", content: systemPrompt },
    ...history.slice(-8),
    { role: "user", content: message },
  ];

  // First call — let GPT decide if a tool is needed
  const first = await openai.chat.completions.create({
    model:        "gpt-4o-mini",
    messages,
    tools:        TOOLS,
    tool_choice:  "auto",
    temperature:  0,
  });

  const choice = first.choices[0];

  if (choice.finish_reason !== "tool_calls" || !choice.message.tool_calls?.length) {
    return NextResponse.json({ reply: choice.message.content ?? "I'm not sure how to help with that." });
  }

  // Execute tool
  const toolCall = choice.message.tool_calls[0];
  if (toolCall.type !== "function") {
    return NextResponse.json({ reply: "I'm not sure how to help with that." });
  }
  const toolName = toolCall.function.name;
  let toolArgs: any = {};
  try { toolArgs = JSON.parse(toolCall.function.arguments) ?? {}; } catch {}

  let toolResult = "";
  try {
    if      (toolName === "get_collections_briefing") toolResult = await toolGetCollectionsBriefing(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "suggest_next_action")      toolResult = await toolSuggestNextAction(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "get_contact_info")         toolResult = await toolGetContactInfo(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "list_portfolio")   toolResult = await toolListPortfolio(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "get_priority_list") toolResult = await toolGetPriorityList(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "get_aging")         toolResult = await toolGetAging(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "get_due_soon")      toolResult = await toolGetDueSoon(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "get_invoices")      toolResult = await toolGetInvoices(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "get_ar_summary")    toolResult = await toolGetArSummary(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "update_invoice")    toolResult = await toolUpdateInvoice(orgId!, toolArgs, visibleRepIds);
    else if (toolName === "send_invoices")     toolResult = await toolSendInvoices(orgId!, toolArgs, visibleRepIds, userId);
    else toolResult = "Unknown tool.";
  } catch (e: any) {
    toolResult = `Error: ${e?.message ?? "Something went wrong."}`;
  }

  // Always return tool results verbatim — never let Groq paraphrase them.
  // This ensures errors are shown as errors and confirmations preserve their lists.
  return NextResponse.json({ reply: toolResult });
}
