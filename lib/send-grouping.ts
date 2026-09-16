// ─────────────────────────────────────────────────────────────────────────────
// Who gets which email — grouping for the bulk "Send invoices" composer
// ─────────────────────────────────────────────────────────────────────────────
//
// THE RULE: an email never spans two customers unless a human explicitly said
// to merge them.
//
// The original implementation grouped by EMAIL DOMAIN, on the reasoning that a
// shared domain means a shared organisation — a novated project, a shared
// auditor or bank. That holds for @acme.com. It is catastrophically false for
// @gmail.com, where the domain says nothing whatsoever about who the person is.
//
// On a real charity's board — 235 invoices, 224 individual customers — that
// produced ONE email addressed to 185 unrelated people, with all 185 addresses
// in the To: header, carrying a statement PDF and invoice PDFs belonging to all
// of them. Every recipient would have seen every other recipient's email
// address and financial details. That is a personal-data breach, not a
// formatting glitch.
//
// The unit of billing is the CUSTOMER. Email is only how you reach them.

/** Mailbox providers where a shared domain implies nothing about the person.
 *  A cross-customer merge is never offered on these — it cannot be a genuine
 *  shared-organisation case. */
const CONSUMER_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "aim.com", "gmx.com", "gmx.net", "gmx.de", "mail.com",
  "zoho.com", "proton.me", "protonmail.com", "pm.me", "tutanota.com",
  "fastmail.com", "hushmail.com", "yandex.com", "yandex.ru", "mail.ru",
  "qq.com", "163.com", "126.com", "sina.com", "naver.com", "daum.net",
  "hanmail.net", "rediffmail.com", "web.de", "t-online.de",
  "orange.fr", "free.fr", "wanadoo.fr", "laposte.net",
  "libero.it", "virgilio.it", "alice.it",
  "terra.com.br", "uol.com.br", "bol.com.br",
  "btinternet.com", "sky.com", "talktalk.net", "ntlworld.com",
  "blueyonder.co.uk", "virginmedia.com",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "cox.net",
  "charter.net", "bellsouth.net", "earthlink.net", "juno.com",
  "shaw.ca", "rogers.com", "sympatico.ca", "telus.net",
  "bigpond.com", "bigpond.net.au", "optusnet.com.au", "iinet.net.au",
  "xtra.co.nz",
]);

/** Country variants are endless (yahoo.co.uk, hotmail.fr, live.com.au, …), so
 *  these families match on prefix rather than being enumerated. */
const CONSUMER_PREFIXES = ["yahoo.", "hotmail.", "live.", "outlook.", "msn.", "ymail.", "rocketmail."];

export function isConsumerDomain(domain: string): boolean {
  const d = (domain || "").trim().toLowerCase();
  if (!d) return false;
  if (CONSUMER_DOMAINS.has(d)) return true;
  return CONSUMER_PREFIXES.some(p => d === p.slice(0, -1) || d.startsWith(p));
}

export const domainOf = (email: string) => (email.split("@")[1] || "").trim().toLowerCase();

export const splitEmails = (s: string | null | undefined) =>
  (s || "").split(/[,;]/).map(e => e.trim().toLowerCase()).filter(e => e.includes("@"));

export const uniqEmails = (vals: (string | null | undefined)[]) => {
  const set = new Set<string>();
  vals.forEach(v => splitEmails(v).forEach(e => set.add(e)));
  return [...set];
};

export type GroupableRow = {
  custId: string;
  custName: string;
  email: string | null;
  bal: number;
};

export type SendGroup<R extends GroupableRow = GroupableRow> = {
  /** Stable key: a single custId, or "merge:<domain>" for an explicit merge. */
  key: string;
  label: string;
  custIds: string[];
  emails: string[];
  rows: R[];
  total: number;
};

/** One group per customer, largest balance first. Rows with no usable email
 *  come back separately — they are skipped, never folded into someone else's
 *  email. */
export function groupByCustomer<R extends GroupableRow>(rows: R[]): {
  groups: SendGroup<R>[];
  noEmail: R[];
} {
  const m = new Map<string, SendGroup<R>>();
  const noEmail: R[] = [];
  for (const r of rows) {
    if (splitEmails(r.email).length === 0) { noEmail.push(r); continue; }
    let g = m.get(r.custId);
    if (!g) {
      g = { key: r.custId, label: r.custName, custIds: [r.custId], emails: [], rows: [], total: 0 };
      m.set(r.custId, g);
    }
    g.rows.push(r);
    g.total += r.bal;
  }
  for (const g of m.values()) g.emails = uniqEmails(g.rows.map(r => r.email));
  return { groups: [...m.values()].sort((a, b) => b.total - a.total), noEmail };
}

export type MergeCandidate = { domain: string; custIds: string[]; custNames: string[] };

/** Corporate domains shared by more than one customer — the genuine "novated
 *  project / shared auditor" case the domain grouping was built for. Offered as
 *  an explicit, named opt-in; never applied automatically, and never offered on
 *  a consumer mailbox domain. */
export function mergeCandidates<R extends GroupableRow>(groups: SendGroup<R>[]): MergeCandidate[] {
  const byDomain = new Map<string, SendGroup<R>[]>();
  for (const g of groups) {
    // Only a group whose addresses ALL sit on one domain can join a merge —
    // a customer with contacts at two companies belongs to neither bucket.
    const domains = new Set(g.emails.map(domainOf));
    if (domains.size !== 1) continue;
    const d = [...domains][0];
    if (isConsumerDomain(d)) continue;
    byDomain.set(d, [...(byDomain.get(d) ?? []), g]);
  }
  return [...byDomain.entries()]
    .filter(([, gs]) => gs.length > 1)
    .map(([domain, gs]) => ({
      domain,
      custIds: gs.flatMap(g => g.custIds),
      custNames: gs.map(g => g.label),
    }))
    .sort((a, b) => b.custIds.length - a.custIds.length);
}

/** Apply the merges the user ticked. Everything else stays one-per-customer. */
export function applyMerges<R extends GroupableRow>(
  groups: SendGroup<R>[], mergedDomains: Set<string>, candidates: MergeCandidate[],
): SendGroup<R>[] {
  if (mergedDomains.size === 0) return groups;
  const claimed = new Map<string, string>();       // custId → domain
  for (const c of candidates) {
    if (!mergedDomains.has(c.domain)) continue;
    c.custIds.forEach(id => claimed.set(id, c.domain));
  }
  const out: SendGroup<R>[] = [];
  const merged = new Map<string, SendGroup<R>>();
  for (const g of groups) {
    const d = g.custIds.length === 1 ? claimed.get(g.custIds[0]) : undefined;
    if (!d) { out.push(g); continue; }
    let m = merged.get(d);
    if (!m) {
      m = { key: `merge:${d}`, label: `@${d}`, custIds: [], emails: [], rows: [], total: 0 };
      merged.set(d, m);
      out.push(m);
    }
    m.custIds.push(...g.custIds);
    m.rows.push(...g.rows);
    m.total += g.total;
    m.emails = uniqEmails([...m.emails, ...g.emails]);
  }
  return out.sort((a, b) => b.total - a.total);
}
