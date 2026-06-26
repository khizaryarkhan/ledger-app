import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { landingPageRequests, crmAccounts, organisations } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { or, ilike, desc } from "drizzle-orm";
import { formatAccountRef } from "@/lib/admin/accounts";

export async function GET(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) return NextResponse.json({ results: [] });

  const pattern = `%${q}%`;

  const [leads, accounts, orgs] = await Promise.all([
    db.select({
      id: landingPageRequests.id,
      fullName: landingPageRequests.fullName,
      companyName: landingPageRequests.companyName,
      email: landingPageRequests.email,
      accountId: landingPageRequests.accountId,
    })
      .from(landingPageRequests)
      .where(or(
        ilike(landingPageRequests.fullName, pattern),
        ilike(landingPageRequests.email, pattern),
        ilike(landingPageRequests.companyName, pattern),
      ))
      .orderBy(desc(landingPageRequests.updatedAt))
      .limit(8),
    db.select({
      id: crmAccounts.id,
      refSeq: crmAccounts.refSeq,
      name: crmAccounts.name,
      billingEmail: crmAccounts.billingEmail,
      organisationId: crmAccounts.organisationId,
    })
      .from(crmAccounts)
      .where(or(
        ilike(crmAccounts.name, pattern),
        ilike(crmAccounts.billingEmail, pattern),
      ))
      .orderBy(desc(crmAccounts.updatedAt))
      .limit(8),
    db.select({ id: organisations.id, name: organisations.name })
      .from(organisations)
      .where(ilike(organisations.name, pattern))
      .orderBy(desc(organisations.name))
      .limit(8),
  ]);

  const results: { type: string; id: string; label: string; sublabel: string; href: string }[] = [];

  for (const l of leads) {
    results.push({
      type: "lead",
      id: l.id,
      label: l.companyName || l.fullName || l.email || "Lead",
      sublabel: [l.fullName, l.email].filter(Boolean).join(" · "),
      href: `/admin/leads/${l.id}`,
    });
  }
  for (const a of accounts) {
    results.push({
      type: "account",
      id: a.id,
      label: a.name,
      sublabel: `${formatAccountRef(a.refSeq)}${a.billingEmail ? ` · ${a.billingEmail}` : ""}`,
      href: `/admin/accounts/${a.id}`,
    });
  }
  for (const o of orgs) {
    results.push({
      type: "customer",
      id: o.id,
      label: o.name,
      sublabel: "Customer organisation",
      href: `/admin/customers/${o.id}`,
    });
  }

  return NextResponse.json({ results: results.slice(0, 15) });
}
