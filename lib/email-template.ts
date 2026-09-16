/**
 * The one substitution used by every AR email path.
 *
 * Vocabulary (case-insensitive): {name}, {ref}, {invoicelines}. A customer
 * reported receiving mail that read "Hi{name}" literally, which is what
 * happens when a send path forgets to substitute — so this exists to make it
 * impossible to get the vocabulary subtly wrong in a new path.
 *
 * NOTE: `{invoice lines}` with a space is also accepted. The send modal has
 * always allowed it and templates in the wild use it.
 *
 * Still duplicated in inngest/functions/chase.ts, app/api/cron/route.ts and
 * app/api/cron/trigger/route.ts, which predate this file and are byte-identical
 * in behaviour. Those are on the daily chase path and deserve their own change
 * rather than being folded in alongside a send rewrite.
 */
export function fillTemplate(
  text: string,
  { name, ref, invoiceLines = [] }: { name: string; ref: string; invoiceLines?: string[] },
): string {
  return (text ?? "")
    .replace(/\{name\}/gi, name)
    .replace(/\{invoice ?lines\}/gi, invoiceLines.join("\n"))
    .replace(/\{ref\}/gi, ref);
}

/** First name, or a neutral fallback — how every AR path greets a customer. */
export const greetingName = (customerName: string | null | undefined) =>
  (customerName || "").trim().split(" ")[0] || "there";
