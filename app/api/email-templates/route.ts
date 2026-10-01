/**
 * GET  /api/email-templates  — list all templates for the org
 * POST /api/email-templates  — create a new template
 */

import { NextResponse } from "next/server";
import { db } from "@/db";
import { emailTemplates } from "@/db/schema";
import { eq, and, isNull } from "drizzle-orm";
import { requireOrg } from "@/lib/api";
import { z } from "zod";

const Schema = z.object({
  name:             z.string().min(1).max(255),
  subject:          z.string().min(1).max(512),
  body:             z.string().min(1),
  collectionStage:  z.string().max(64).nullable().optional(),
  escalationType:   z.string().max(64).nullable().optional(),
  isActive:         z.boolean().optional().default(true),
  sendIntervalDays: z.number().int().min(1).optional().default(7),
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

  // Server-side half of the "one template per (org, stage, escalation type)"
  // rule — the DB partial unique index (migration 0104) is what actually
  // closes the race, but a friendly 400 here beats a raw constraint violation
  // for the common (non-racing) case. Draft templates (no collectionStage)
  // are outside the constraint entirely, same as the index.
  const stage = parsed.data.collectionStage ?? null;
  if (stage) {
    const escalationType = parsed.data.escalationType ?? null;
    const [dup] = await db
      .select({ id: emailTemplates.id })
      .from(emailTemplates)
      .where(and(
        eq(emailTemplates.orgId, orgId!),
        eq(emailTemplates.collectionStage, stage),
        escalationType === null ? isNull(emailTemplates.escalationType) : eq(emailTemplates.escalationType, escalationType),
      ))
      .limit(1);
    if (dup) {
      return NextResponse.json(
        { error: "A template for this stage/escalation type already exists" },
        { status: 400 },
      );
    }
  }

  const [created] = await db
    .insert(emailTemplates)
    .values({
      orgId:            orgId!,
      name:             parsed.data.name,
      subject:          parsed.data.subject,
      body:             parsed.data.body,
      collectionStage:  parsed.data.collectionStage ?? null,
      escalationType:   parsed.data.escalationType ?? null,
      isActive:         parsed.data.isActive ?? true,
      sendIntervalDays: parsed.data.sendIntervalDays ?? 7,
    })
    .returning();

  return NextResponse.json(created, { status: 201 });
}
