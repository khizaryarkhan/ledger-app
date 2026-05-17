/**
 * GET  /api/email-templates  — list all templates for the org
 * POST /api/email-templates  — create a new template
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { emailTemplates } from "@/db/schema";
import { eq } from "drizzle-orm";
import { requireOrg } from "@/lib/api";
import { z } from "zod";

const Schema = z.object({
  name:            z.string().min(1).max(255),
  subject:         z.string().min(1).max(512),
  body:            z.string().min(1),
  collectionStage: z.string().max(64).nullable().optional(),
  isActive:        z.boolean().optional().default(true),
  scheduleDays:    z.array(z.number().int()).optional().default([-3, 1, 8, 21]),
});

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const rows = await db
    .select()
    .from(emailTemplates)
    .where(eq(emailTemplates.orgId, orgId!));

  return NextResponse.json(rows);
}

export async function POST(req: Request) {
  const { error, orgId } = await requireOrg();
  if (error) return error;

  const raw = await req.json().catch(() => null);
  const parsed = Schema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues }, { status: 400 });
  }

  const [created] = await db
    .insert(emailTemplates)
    .values({
      orgId:           orgId!,
      name:            parsed.data.name,
      subject:         parsed.data.subject,
      body:            parsed.data.body,
      collectionStage: parsed.data.collectionStage ?? null,
      isActive:        parsed.data.isActive ?? true,
      scheduleDays:    parsed.data.scheduleDays,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
