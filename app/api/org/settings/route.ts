import { db } from "@/db";
import { organisations, invoices } from "@/db/schema";
import { requireOrg, ok, bad } from "@/lib/api";
import { eq, and } from "drizzle-orm";
import { DEFAULT_STAGES, Stage } from "@/lib/stages";

function getStages(org: any): Stage[] {
  return (org?.stages as Stage[] | null) ?? DEFAULT_STAGES;
}

export async function GET() {
  const { error, orgId } = await requireOrg();
  if (error) return error;
  const [org] = await db
    .select({
      classificationLevel: organisations.classificationLevel,
      dateFormat: organisations.dateFormat,
      currency: organisations.currency,
      logoUrl: organisations.logoUrl,
      displayName: organisations.displayName,
      name: organisations.name,
      stages: organisations.stages,
    })
    .from(organisations)
    .where(eq(organisations.id, orgId!))
    .limit(1);
  return ok({
    classificationLevel: org?.classificationLevel ?? "customer",
    dateFormat: org?.dateFormat ?? "DD MMM YYYY",
    currency: org?.currency ?? "EUR",
    logoUrl: org?.logoUrl ?? null,
    displayName: org?.displayName ?? null,
    name: org?.name ?? "",
    stages: getStages(org),
  });
}

const ALLOWED_DATE_FORMATS = ["DD MMM YYYY", "DD/MM/YYYY", "MM/DD/YYYY", "YYYY-MM-DD", "MMM DD, YYYY"];
const ALLOWED_CURRENCIES = ["EUR", "USD", "GBP", "AED", "AUD", "CAD", "CHF", "DKK", "NOK", "NZD", "SEK", "SGD", "ZAR"];
const ALLOWED_COLORS = ["stone", "blue", "violet", "rose", "amber", "orange", "emerald", "cyan", "purple", "pink"];

export async function PATCH(req: Request) {
  const { error, orgId, role } = await requireOrg();
  if (error) return error;
  if (!["company_admin", "super_admin"].includes(role!)) return bad("Admins only", 403);

  const body = await req.json();
  const updates: Record<string, any> = { updatedAt: new Date() };

  if (body.classificationLevel !== undefined) {
    if (!["customer", "project"].includes(body.classificationLevel)) return bad("Invalid classificationLevel");
    updates.classificationLevel = body.classificationLevel;
  }
  if (body.dateFormat !== undefined) {
    if (!ALLOWED_DATE_FORMATS.includes(body.dateFormat)) return bad("Invalid dateFormat");
    updates.dateFormat = body.dateFormat;
  }
  if (body.currency !== undefined) {
    if (!ALLOWED_CURRENCIES.includes(body.currency)) return bad("Invalid currency");
    updates.currency = body.currency;
  }
  if (body.logoUrl !== undefined) updates.logoUrl = body.logoUrl || null;
  if (body.displayName !== undefined) updates.displayName = body.displayName || null;

  // ── Stages update ──────────────────────────────────────────────────────────
  if (body.stages !== undefined) {
    const incoming: Stage[] = body.stages;

    // Validate
    if (!Array.isArray(incoming) || incoming.length === 0) return bad("stages must be a non-empty array");
    if (incoming.filter(s => s.isDefault).length !== 1) return bad("Exactly one stage must be isDefault");
    if (incoming.filter(s => s.isClosed).length !== 1)  return bad("Exactly one stage must be isClosed");
    for (const s of incoming) {
      if (!s.key || !s.label?.trim()) return bad("Each stage must have a key and label");
      if (!ALLOWED_COLORS.includes(s.color)) return bad(`Invalid color: ${s.color}`);
    }

    // Fetch current stages to detect label renames
    const [currentOrg] = await db.select({ stages: organisations.stages })
      .from(organisations).where(eq(organisations.id, orgId!)).limit(1);
    const currentStages: Stage[] = getStages(currentOrg);

    // Build rename map: key → { oldLabel, newLabel } where label changed
    const renames: { oldLabel: string; newLabel: string }[] = [];
    for (const incoming_s of incoming) {
      const current_s = currentStages.find(c => c.key === incoming_s.key);
      if (current_s && current_s.label !== incoming_s.label) {
        renames.push({ oldLabel: current_s.label, newLabel: incoming_s.label.trim() });
      }
    }

    // Apply invoice relabeling for any renames
    for (const { oldLabel, newLabel } of renames) {
      await db.update(invoices)
        .set({ collectionStage: newLabel, updatedAt: new Date() })
        .where(and(eq(invoices.orgId, orgId!), eq(invoices.collectionStage, oldLabel)));
    }

    updates.stages = incoming.map(s => ({ ...s, label: s.label.trim() }));
  }

  await db.update(organisations).set(updates).where(eq(organisations.id, orgId!));

  const [updated] = await db
    .select({
      classificationLevel: organisations.classificationLevel,
      dateFormat: organisations.dateFormat,
      currency: organisations.currency,
      logoUrl: organisations.logoUrl,
      displayName: organisations.displayName,
      name: organisations.name,
      stages: organisations.stages,
    })
    .from(organisations)
    .where(eq(organisations.id, orgId!))
    .limit(1);

  return ok({
    classificationLevel: updated.classificationLevel,
    dateFormat: updated.dateFormat ?? "DD MMM YYYY",
    currency: updated.currency ?? "EUR",
    logoUrl: updated.logoUrl ?? null,
    displayName: updated.displayName ?? null,
    name: updated.name,
    stages: getStages(updated),
  });
}
