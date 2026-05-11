import { auth } from "@/lib/auth";
import { db } from "@/db";
import { userOrganisations, organisations, users } from "@/db/schema";
import { and, eq, or } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userId       = (session.user as any).id    as string;
  const defaultOrgId = (session.user as any).orgId as string | null;

  const { orgId } = await req.json();
  if (!orgId) return NextResponse.json({ error: "orgId required" }, { status: 400 });

  // Validate: user must be in junction table OR it must be their default org
  const [membership] = await db.select({ orgId: userOrganisations.orgId })
    .from(userOrganisations)
    .where(and(eq(userOrganisations.userId, userId), eq(userOrganisations.orgId, orgId)))
    .limit(1);

  const isDefault = orgId === defaultOrgId;
  if (!membership && !isDefault) {
    return NextResponse.json({ error: "You do not have access to this organisation" }, { status: 403 });
  }

  const res = NextResponse.json({ success: true, orgId });
  res.cookies.set("active_org_id", orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
