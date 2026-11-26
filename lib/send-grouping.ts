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
  /** Optional: rows of one project always travel together. */
  projectId?: string | null;
  projName?: string | null;
};

export type SendGroup<R extends GroupableRow = GroupableRow> = {
  /** Stable key: a custId (customer with one entity), "<custId>@<entity>" (one
   *  of several entities of a customer), or "merge:<domain>" for an explicit merge. */
  key: string;
  label: string;
  custIds: string[];
  emails: string[];
  rows: R[];
  total: number;
  /** Things a person should look at before pressing Send. */
  warnings: string[];
};

// ── Entities within a customer ───────────────────────────────────────────────
//
// One customer can bill several projects whose contacts belong to DIFFERENT
// organisations (the owner's, the contractor's, the consultant's). Sending all
// of a customer's invoices to the union of all those contacts told a recipient
// about projects they have nothing to do with — and one of them said so.
//
// So inside a customer, rows are connected into an ENTITY when:
//   • they share a corporate domain (acme.com), or
//   • they share a project (a project may legitimately have contacts at
//     several organisations — they are combined), or
//   • they share the exact same PERSONAL address (gmail etc.).
// A personal mailbox domain NEVER links two rows by itself: two people at
// gmail.com are strangers, and customers' invoices are often under an NDA.

/** What an address links on: the domain for a company, the whole address for a
 *  personal mailbox. */
const linkToken = (email: string) => {
  const d = domainOf(email);
  return isConsumerDomain(d) ? email : d;
};

const projectOf = (r: GroupableRow): string | null =>
  r.projectId ?? (r as { inv?: { projectId?: string | null } }).inv?.projectId ?? null;

function clusterRows<R extends GroupableRow>(rows: R[]): R[][] {
  const parent = rows.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  };
  const seen = new Map<string, number>();
  const link = (k: string, i: number) => {
    const j = seen.get(k);
    if (j === undefined) seen.set(k, i);
    else parent[find(i)] = find(j);
  };
  rows.forEach((r, i) => {
    splitEmails(r.email).forEach(e => link(`t:${linkToken(e)}`, i));
    const p = projectOf(r);
    if (p) link(`p:${p}`, i);
  });
  const out = new Map<number, R[]>();
  rows.forEach((r, i) => {
    const root = find(i);
    out.set(root, [...(out.get(root) ?? []), r]);
  });
  return [...out.values()];
}

/** A personal address that is on only SOME of the email's invoices would receive
 *  all of them — worth a human look when an NDA may apply. */
function personalAddressWarning<R extends GroupableRow>(rows: R[]): string[] {
  const perRow = rows.map(r => new Set(splitEmails(r.email)));
  const all = new Set(perRow.flatMap(s => [...s]));
  const exposed = [...all].filter(e => isConsumerDomain(domainOf(e)) && perRow.some(s => !s.has(e)));
  if (!exposed.length) return [];
  return [`${exposed.join(", ")} (personal mailbox) is not on every invoice in this email but will see all of them — check any NDA.`];
}

/** One group per customer ENTITY, largest balance first. Rows with no usable
 *  email come back separately — they are skipped, never folded into someone
 *  else's email. */
export function groupByCustomer<R extends GroupableRow>(rows: R[]): {
  groups: SendGroup<R>[];
  noEmail: R[];
} {
  const byCust = new Map<string, R[]>();
  const noEmail: R[] = [];
  for (const r of rows) {
    if (splitEmails(r.email).length === 0) { noEmail.push(r); continue; }
    byCust.set(r.custId, [...(byCust.get(r.custId) ?? []), r]);
  }

  const groups: SendGroup<R>[] = [];
  for (const [custId, custRows] of byCust) {
    const clusters = clusterRows(custRows);
    for (const rs of clusters) {
      const emails = uniqEmails(rs.map(r => r.email));
      const sig = [...new Set(emails.map(linkToken))].sort().join("+");
      const projects = [...new Set(rs.map(r => r.projName).filter((p): p is string => !!p))];
      const entity = projects.length ? projects.join(", ") : sig;
      const single = clusters.length === 1;
      groups.push({
        key: single ? custId : `${custId}@${sig}`,
        label: single ? rs[0].custName : `${rs[0].custName} · ${entity}`,
        custIds: [custId], emails, rows: rs,
        total: rs.reduce((s, r) => s + r.bal, 0),
        warnings: personalAddressWarning(rs),
      });
    }
  }
  return { groups: groups.sort((a, b) => b.total - a.total), noEmail };
}

export type MergeCandidate = {
  domain: string; custIds: string[]; custNames: string[];
  /** The groups that would be combined (a customer may own several). */
  groupKeys: string[];
};

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
      custIds: [...new Set(gs.flatMap(g => g.custIds))],
      custNames: gs.map(g => g.label),
      groupKeys: gs.map(g => g.key),
    }))
    .sort((a, b) => b.custIds.length - a.custIds.length);
}

/** Apply the merges the user ticked. Everything else stays one-per-customer. */
export function applyMerges<R extends GroupableRow>(
  groups: SendGroup<R>[], mergedDomains: Set<string>, candidates: MergeCandidate[],
): SendGroup<R>[] {
  if (mergedDomains.size === 0) return groups;
  const claimed = new Map<string, string>();       // group key → domain
  for (const c of candidates) {
    if (!mergedDomains.has(c.domain)) continue;
    c.groupKeys.forEach(k => claimed.set(k, c.domain));
  }
  const out: SendGroup<R>[] = [];
  const merged = new Map<string, SendGroup<R>>();
  for (const g of groups) {
    const d = claimed.get(g.key);
    if (!d) { out.push(g); continue; }
    let m = merged.get(d);
    if (!m) {
      m = { key: `merge:${d}`, label: `@${d}`, custIds: [], emails: [], rows: [], total: 0, warnings: [] };
      merged.set(d, m);
      out.push(m);
    }
    m.custIds.push(...g.custIds.filter(id => !m!.custIds.includes(id)));
    m.warnings.push(...g.warnings);
    m.rows.push(...g.rows);
    m.total += g.total;
    m.emails = uniqEmails([...m.emails, ...g.emails]);
  }
  return out.sort((a, b) => b.total - a.total);
}
