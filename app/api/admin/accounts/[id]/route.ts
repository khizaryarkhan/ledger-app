import { requirePlatformAdmin } from "@/lib/billing";
import { db } from "@/db";
import { crmAccounts, landingPageRequests, leadContacts, leadTasks, opportunities, organisations, subscriptions, crmActivities, crmEmails, crmQuotes, users } from "@/db/schema";
import { eq, desc, inArray, or } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { logActivity } from "@/lib/admin/activities";
import { formatAccountRef } from "@/lib/admin/accounts";

const safe = async <T>(p: Promise<T>, fallback: T): Promise<T> => { try { return await p; } catch { return fallback; } };

// GET — the Account 360 payload: header, contacts, opportunities, tasks,
// billing summary, and the activity timeline. One call powers the workspace.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId } = await requirePlatformAdmin();
  if (error) return error;

  const [account] = await db.select().from(crmAccounts).where(eq(crmAccounts.id, params.id)).limit(1);
  if (!account) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  // Owner + admin directory (for the owner picker).
  const admins = await safe(db.select({ id: users.id, name: users.name, email: users.email })
    .from(users).where(inArray(users.role, ["super_admin", "platform_admin"])), [] as any[]);
  const ownerName = account.ownerAdminId ? (admins.find(a => a.id === account.ownerAdminId)?.name ?? null) : null;
  // The signed-in rep's own scheduling link (for the "Book meeting" action).
  const [viewer] = await safe(db.select({ schedulingUrl: users.schedulingUrl }).from(users).where(eq(users.id, userId!)).limit(1), [] as any[]);
  const viewerSchedulingUrl = viewer?.schedulingUrl ?? null;

  // The most recent lead for this account (contacts/tasks hang off it).
  const [lead] = await safe(db.select().from(landingPageRequests)
    .where(eq(landingPageRequests.accountId, params.id)).orderBy(desc(landingPageRequests.createdAt)).limit(1), [] as any[]);

  const contacts = lead ? await safe(db.select().from(leadContacts).where(eq(leadContacts.leadId, lead.id)).orderBy(desc(leadContacts.isPrimary)), [] as any[]) : [];
  // Tasks are account-scoped; fall back to the lead link for older rows.
  const tasks = await safe(db.select().from(leadTasks)
    .where(or(eq(leadTasks.accountId, params.id), lead ? eq(leadTasks.leadId, lead.id) : eq(leadTasks.accountId, params.id)))
    .orderBy(desc(leadTasks.createdAt)), [] as any[]);

  const opps = await safe(db.select({
    id: opportunities.id, title: opportunities.title, stage: opportunities.stage, status: opportunities.status,
    value: opportunities.value, currency: opportunities.currency, invoiceStatus: opportunities.invoiceStatus,
    invoiceUrl: opportunities.invoiceUrl, leadId: opportunities.leadId, updatedAt: opportunities.updatedAt,
  }).from(opportunities).where(eq(opportunities.accountId, params.id)).orderBy(desc(opportunities.updatedAt)), [] as any[]);

  // Billing summary (subscription) for the linked org.
  let subscription: any = null;
  let orgStatus: string | null = null;
  if (account.organisationId) {
    const [org] = await safe(db.select({ status: organisations.status }).from(organisations).where(eq(organisations.id, account.organisationId)).limit(1), [] as any[]);
    orgStatus = org?.status ?? null;
    const [sub] = await safe(db.select().from(subscriptions).where(eq(subscriptions.orgId, account.organisationId)).limit(1), [] as any[]);
    subscription = sub ?? null;
  }

  const activities = await safe(db.select().from(crmActivities)
    .where(eq(crmActivities.accountId, params.id)).orderBy(desc(crmActivities.occurredAt)).limit(100), [] as any[]);

  // Durable emails, newest first, grouped into threads (most recent thread first).
  const emailRows = await safe(db.select({
    id: crmEmails.id, direction: crmEmails.direction, threadKey: crmEmails.threadKey,
    subject: crmEmails.subject, snippet: crmEmails.snippet, fromAddr: crmEmails.fromAddr,
    toAddr: crmEmails.toAddr, occurredAt: crmEmails.occurredAt,
  }).from(crmEmails).where(eq(crmEmails.accountId, params.id)).orderBy(desc(crmEmails.occurredAt)).limit(100), [] as any[]);
  const threadMap = new Map<string, any>();
  for (const e of emailRows) {
    const t = threadMap.get(e.threadKey) ?? { threadKey: e.threadKey, subject: e.subject, lastAt: e.occurredAt, count: 0, messages: [] };
    t.messages.push(e); t.count++;
    threadMap.set(e.threadKey, t);
  }
  const emailThreads = Array.from(threadMap.values());

  // Quotes (CPQ) for this account.
  const quoteRows = await safe(db.select().from(crmQuotes).where(eq(crmQuotes.accountId, params.id)).orderBy(desc(crmQuotes.createdAt)), [] as any[]);
  const quotes = quoteRows.map(q => ({
    id: q.id, ref: q.refSeq ? `Q-${String(q.refSeq).padStart(5, "0")}` : "", status: q.status,
    total: q.total, currency: q.currency, validUntil: q.validUntil, lineItems: q.lineItems, createdAt: q.createdAt,
  }));

  return NextResponse.json({
    account: {
      id: account.id, ref: formatAccountRef(account.refSeq), name: account.name,
      lifecycleStage: account.lifecycleStage, country: account.country, domain: account.domain,
      billingEmail: account.billingEmail, ownerAdminId: account.ownerAdminId, ownerName,
      organisationId: account.organisationId, orgStatus, createdAt: account.createdAt,
      leadId: lead?.id ?? null,
    },
    lead: lead ? { id: lead.id, fullName: lead.fullName, email: lead.email, phone: lead.phone, companyName: lead.companyName, status: lead.status } : null,
    contacts, opportunities: opps, tasks, subscription, activities, admins, emailThreads, quotes,
    viewerSchedulingUrl,
  });
}

// PATCH — update account facets (currently the owner). Platform-admin only.
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { error, userId, userName } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({} as any));
  const patch: Record<string, any> = { updatedAt: new Date() };
  if ("ownerAdminId" in body) patch.ownerAdminId = body.ownerAdminId || null;

  if (Object.keys(patch).length === 1) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  await db.update(crmAccounts).set(patch).where(eq(crmAccounts.id, params.id));
  if ("ownerAdminId" in body) {
    await logActivity({ type: "owner_assigned", title: body.ownerAdminId ? "Owner assigned" : "Owner cleared", accountId: params.id, actorId: userId, actorName: userName });
  }
  return NextResponse.json({ ok: true });
}
