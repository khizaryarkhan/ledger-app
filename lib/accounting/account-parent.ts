/**
 * Shared Parent Account validation for the Chart of Accounts — called from
 * both the create (POST) and edit (PATCH) routes so the rule can't drift
 * between the two. `accounts.parent_id` is a real FK into `accounts.id`
 * (db/schema.ts) — always OUR internal uuid, whether the parent/child link
 * was set by a user via the native picker or resolved by the QBO sync (which
 * maps QBO's own ParentRef onto the matching row's internal id before ever
 * writing it — see lib/qbo-ap-sync.ts). It is never a raw external id.
 */

import { db } from "@/db";
import { apAccounts } from "@/db/schema";
import { eq } from "drizzle-orm";

/**
 * Returns an error message if `parentId` is not a valid parent for an
 * account of `type` in this org, or null if it's valid.
 * `selfId` (the account being edited, or null when creating) is excluded
 * from being its own parent and from appearing anywhere in the new parent's
 * ancestor chain (no cycles).
 */
export async function validateParent(
  orgId: string,
  parentId: string,
  type: string,
  selfId: string | null
): Promise<string | null> {
  const rows = await db.select({ id: apAccounts.id, type: apAccounts.type, parentId: apAccounts.parentId })
    .from(apAccounts).where(eq(apAccounts.orgId, orgId));

  const byId = new Map(rows.map(r => [r.id, r]));

  const parent = byId.get(parentId);
  if (!parent) return "Parent account not found";
  if (selfId && parent.id === selfId) return "An account can't be its own parent";
  if (parent.type !== type) return `Parent account is a different account type (${parent.type}) — a sub-account must match its parent's type`;

  // Walk the candidate parent's own ancestor chain; if it ever reaches the
  // account being edited, this would create a cycle.
  if (selfId) {
    let cursor = parent.parentId;
    const seen = new Set<string>([parent.id]);
    while (cursor) {
      if (cursor === selfId) return "That would create a circular parent relationship";
      const next = byId.get(cursor);
      if (!next || seen.has(next.id)) break; // already-corrupt chain elsewhere — don't loop forever
      seen.add(next.id);
      cursor = next.parentId;
    }
  }

  return null;
}
