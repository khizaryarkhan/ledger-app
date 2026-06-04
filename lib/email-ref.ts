/**
 * Unique, human-friendly outbound-email reference.
 * Neutral "AR-" prefix (never org-specific), e.g. AR-260604-K3F9.
 * Used by every send path (board bulk send, AI chat, automations) and stored
 * on the communication's refNumber so it surfaces in the "Last ref" column.
 */
export function genEmailRef(): string {
  const d = new Date();
  const ymd = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `AR-${ymd}-${rnd}`;
}
