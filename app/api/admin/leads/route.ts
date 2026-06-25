import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { landingPageRequests, users, leadSequenceEnrollments, leadSequences } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq, desc, ilike, or } from "drizzle-orm";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const url    = new URL(req.url);
  const status = url.searchParams.get("status");
  const search = url.searchParams.get("q");

  let query = db
    .select({
      id:               landingPageRequests.id,
      fullName:         landingPageRequests.fullName,
      companyName:      landingPageRequests.companyName,
      email:            landingPageRequests.email,
      phone:            landingPageRequests.phone,
      country:          landingPageRequests.country,
      companySize:      landingPageRequests.companySize,
      interestedService: landingPageRequests.interestedService,
      message:          landingPageRequests.message,
      source:           landingPageRequests.source,
      status:           landingPageRequests.status,
      adminNotes:       landingPageRequests.adminNotes,
      createdAt:        landingPageRequests.createdAt,
      updatedAt:        landingPageRequests.updatedAt,
      assignedAdminName: users.name,
    })
    .from(landingPageRequests)
    .leftJoin(users, eq(users.id, landingPageRequests.assignedToAdminId))
    .$dynamic();

  if (status) {
    query = query.where(eq(landingPageRequests.status, status)) as any;
  }

  if (search) {
    query = query.where(
      or(
        ilike(landingPageRequests.fullName, `%${search}%`),
        ilike(landingPageRequests.email, `%${search}%`),
        ilike(landingPageRequests.companyName, `%${search}%`),
      )
    ) as any;
  }

  const rows = await (query as any).orderBy(desc(landingPageRequests.createdAt));

  // Attach each lead's ACTIVE sequence enrolment (for the inline Sequence column).
  const active = await db
    .select({
      leadId:       leadSequenceEnrollments.leadId,
      enrollmentId: leadSequenceEnrollments.id,
      sequenceId:   leadSequenceEnrollments.sequenceId,
      name:         leadSequences.name,
    })
    .from(leadSequenceEnrollments)
    .innerJoin(leadSequences, eq(leadSequences.id, leadSequenceEnrollments.sequenceId))
    .where(eq(leadSequenceEnrollments.status, "active"));
  const activeByLead = new Map(active.map(a => [a.leadId, a]));

  const leads = (rows as any[]).map(l => ({
    ...l,
    activeSequence: activeByLead.get(l.id) ?? null,
  }));
  return NextResponse.json({ leads });
}

export async function POST(req: NextRequest) {
  const { error } = await requirePlatformAdmin();
  if (error) return error;

  const body = await req.json().catch(() => ({}));
  const { fullName, email, companyName, phone, country, interestedService, message } = body;

  if (!fullName?.trim() || !email?.trim()) {
    return NextResponse.json({ error: "Name and email are required" }, { status: 400 });
  }

  // One company = one account: resolve (find-or-create) the account BEFORE the
  // insert so account_id (NOT NULL) is always set.
  const { ensureAccount } = await import("@/lib/admin/accounts");
  const accountId = await ensureAccount({ name: companyName?.trim() || fullName, email, country });

  const [row] = await db.insert(landingPageRequests).values({
    id:               randomUUID(),
    fullName:         fullName.trim(),
    email:            email.toLowerCase().trim(),
    companyName:      companyName?.trim() || null,
    phone:            phone?.trim() || null,
    country:          country?.trim() || null,
    interestedService: interestedService?.trim() || null,
    message:          message?.trim() || null,
    source:           "manual",
    status:           "new",
    accountId,
  }).returning();

  return NextResponse.json(row, { status: 201 });
}
