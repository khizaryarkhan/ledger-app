import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, landingPageRequests, opportunities, leadTasks, crmActivities, crmEmails } from "@/db/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";

export const runtime = "nodejs";
export const maxDuration = 30;

// POST — AI next-best-action for an account. Reads the real signals (lifecycle,
// recent activity, open deals, open tasks, last emails) and asks the model for
// the single most useful next step. On-demand (it costs a token call).
export async function POST(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;
  if (!process.env.OPENAI_API_KEY) return NextResponse.json({ error: "AI is not configured (OPENAI_API_KEY missing)." }, { status: 503 });

  const [account] = await db.select().from(crmAccounts).where(eq(crmAccounts.id, params.id)).limit(1);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const [lead] = await db.select({ id: landingPageRequests.id, status: landingPageRequests.status })
    .from(landingPageRequests).where(eq(landingPageRequests.accountId, params.id)).orderBy(desc(landingPageRequests.createdAt)).limit(1);

  const activities = await db.select({ type: crmActivities.type, title: crmActivities.title, at: crmActivities.occurredAt })
    .from(crmActivities).where(eq(crmActivities.accountId, params.id)).orderBy(desc(crmActivities.occurredAt)).limit(12);
  const deals = await db.select({ title: opportunities.title, stage: opportunities.stage, value: opportunities.value, status: opportunities.status })
    .from(opportunities).where(eq(opportunities.accountId, params.id));
  const tasks = lead ? await db.select({ title: leadTasks.title, dueDate: leadTasks.dueDate })
    .from(leadTasks).where(and(eq(leadTasks.leadId, lead.id), isNull(leadTasks.completedAt))) : [];
  const emails = await db.select({ direction: crmEmails.direction, subject: crmEmails.subject, at: crmEmails.occurredAt })
    .from(crmEmails).where(eq(crmEmails.accountId, params.id)).orderBy(desc(crmEmails.occurredAt)).limit(6);

  const lastAt = activities[0]?.at ?? account.updatedAt;
  const daysSince = lastAt ? Math.round((Date.now() - new Date(lastAt).getTime()) / 86_400_000) : null;
  const fmtDate = (t: any) => t ? new Date(t).toISOString().slice(0, 10) : "?";

  const context = [
    `Company: ${account.name} (lifecycle: ${account.lifecycleStage}${lead ? `, lead status: ${lead.status}` : ""})`,
    daysSince != null ? `Days since last activity: ${daysSince}` : "No recorded activity",
    `Open deals: ${deals.filter(d => d.status === "open").map(d => `${d.title} [${d.stage}, value ${d.value}]`).join("; ") || "none"}`,
    `Open tasks: ${tasks.map(t => `${t.title}${t.dueDate ? ` (due ${fmtDate(t.dueDate)})` : ""}`).join("; ") || "none"}`,
    `Recent emails: ${emails.map(e => `${e.direction === "inbound" ? "IN" : "OUT"} "${e.subject ?? ""}" ${fmtDate(e.at)}`).join("; ") || "none"}`,
    `Recent activity: ${activities.map(a => `${a.title} (${fmtDate(a.at)})`).join("; ") || "none"}`,
  ].join("\n");

  try {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.4,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are a senior B2B sales coach for an AR-automation SaaS (Prime Accountax). Given a CRM account's current state, recommend THE single most valuable next action the rep should take now. Be specific and concrete. Respond as JSON: {\"action\": string (one imperative sentence), \"reason\": string (one sentence, cite the signal), \"urgency\": \"high\"|\"medium\"|\"low\"}." },
        { role: "user", content: context },
      ],
    });
    const raw = resp.choices[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = { action: raw.slice(0, 200), reason: "", urgency: "medium" }; }
    return NextResponse.json({
      action: String(parsed.action ?? "").slice(0, 300),
      reason: String(parsed.reason ?? "").slice(0, 300),
      urgency: ["high", "medium", "low"].includes(parsed.urgency) ? parsed.urgency : "medium",
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "AI request failed" }, { status: 502 });
  }
}
