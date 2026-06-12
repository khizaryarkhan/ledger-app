import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { landingPageRequests, users } from "@/db/schema";
import { requirePlatformAdmin } from "@/lib/billing";
import { eq, desc, ilike, or } from "drizzle-orm";

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
  return NextResponse.json({ leads: rows });
}
