/**
 * The one substitution used by every AR email path — chase automation,
 * bulk send, and the free-text composer's "Apply template" button
 * (components/feature.tsx).
 *
 * Two vocabularies existed before this: the automated chase paths taught
 * admins {name}/{ref}/{invoicelines}, while the composer's own reduce-based
 * substitution only understood {contactName}/{amount}/{dueDate}/etc. A
 * template built the way Settings instructs (with {name}/{ref}) and then
 * applied via the composer went out with those placeholders untouched —
 * literal "{name}" text in the customer's inbox. Every alias below resolves
 * to the same value, so a template written with either vocabulary works
 * identically wherever it's used.
 *
 * Case-insensitive throughout, and unmatched vars resolve to "" rather than
 * being left as literal placeholder text.
 */
import type { EmailTemplate } from "@/db/schema";

export type TemplateVars = {
  /** The greeting name — {name} / {contactName}. Usually a first name. */
  name?: string;
  /** The full customer/company name — {customerName}. Falls back to `name`
   *  and vice versa, so a caller that only has one of the two still fills
   *  both placeholders sensibly rather than leaving one blank. */
  customerName?: string;
  ref?: string;
  invoiceLines?: string[];
  invoiceNumber?: string;
  amount?: string;
  dueDate?: string;
  daysOverdue?: string;
  senderName?: string;
};

export function fillTemplate(text: string, vars: TemplateVars): string {
  const name = vars.name ?? vars.customerName ?? "";
  const customerName = vars.customerName ?? vars.name ?? "";
  const ref = vars.ref ?? "";
  const lines = (vars.invoiceLines ?? []).join("\n");
  return (text ?? "")
    .replace(/\{name\}/gi, name)
    .replace(/\{contactname\}/gi, name)
    .replace(/\{customername\}/gi, customerName)
    .replace(/\{invoice ?lines\}/gi, lines)
    .replace(/\{ref\}/gi, ref)
    .replace(/\{referencenumber\}/gi, ref)
    .replace(/\{invoicenumber\}/gi, vars.invoiceNumber ?? "")
    .replace(/\{amount\}/gi, vars.amount ?? "")
    .replace(/\{duedate\}/gi, vars.dueDate ?? "")
    .replace(/\{daysoverdue\}/gi, vars.daysOverdue ?? "")
    .replace(/\{sendername\}/gi, vars.senderName ?? "");
}

/**
 * First name, or a neutral fallback — how every AR path greets a customer.
 *
 * "Sir/Madam" (not "there") to match the tone already used by the three
 * highest-volume send paths (daily chase, legacy cron, manual trigger) —
 * this used to be the odd one out at "there", used only by the lowest-
 * volume path (bulk send), which is the drift this consolidates away.
 */
export const greetingName = (customerName: string | null | undefined) =>
  (customerName || "").trim().split(" ")[0] || "Sir/Madam";

/**
 * Shared by inngest/functions/chase.ts, app/api/cron/route.ts and
 * app/api/cron/trigger/route.ts — previously copy-pasted identically into
 * all three (each with a "mirrors ... see there for why" comment). Splits an
 * org's active templates into a generic (stage-only) map and a map scoped to
 * one specific escalation type on top of a stage, so a template with
 * escalationType only ever narrows a match that would otherwise hit the
 * generic template for that stage — an org that never sets escalationType-
 * specific templates sees no change from before this existed.
 */
export function buildTemplateMaps(templates: EmailTemplate[]): {
  byStage: Map<string, EmailTemplate>;
  byStageAndType: Map<string, EmailTemplate>;
} {
  const byStage = new Map<string, EmailTemplate>(
    templates.filter(t => t.collectionStage && !t.escalationType).map(t => [t.collectionStage!, t]),
  );
  const byStageAndType = new Map<string, EmailTemplate>(
    templates.filter(t => t.collectionStage && t.escalationType)
      .map(t => [`${t.collectionStage}::${t.escalationType}`, t]),
  );
  return { byStage, byStageAndType };
}

/**
 * Pick the template for this invoice's stage — an exact (stage, escalation
 * type) match first, falling back to the stage-only (generic) template.
 */
export function pickTemplate(
  byStageAndType: Map<string, EmailTemplate>,
  byStage: Map<string, EmailTemplate>,
  stage: string,
  escalationType: string | null | undefined,
): EmailTemplate | undefined {
  if (escalationType) {
    const specific = byStageAndType.get(`${stage}::${escalationType}`);
    if (specific) return specific;
  }
  return byStage.get(stage);
}
