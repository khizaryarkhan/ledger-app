/**
 * One name, one item — per org (server-only; imports db).
 *
 * The Products register accepted a second "Cotton Yarn 24s": neither the create
 * nor the rename path checked, and only the Accounting quick-add did, by exact
 * match. Two items with one name cannot be told apart in any picker, report or
 * import — a PO line, a BOM input or a stock count lands on whichever the user
 * happened to click. The comparison ignores case and surrounding spaces, since
 * "cotton yarn 24s " is the same item to a person.
 *
 * Checked in the app rather than by a unique index: existing duplicates may
 * already be in the data (QBO permits them across item types), and an index
 * would fail to build against them. New duplicates stop here.
 */

import { db } from "@/db";
import { apItems } from "@/db/schema";
import { and, eq, ne, sql } from "drizzle-orm";

export async function itemNameTaken(orgId: string, name: string, exceptId?: string): Promise<boolean> {
  const n = name.trim().toLowerCase();
  if (!n) return false;
  const [hit] = await db.select({ id: apItems.id }).from(apItems)
    .where(and(eq(apItems.orgId, orgId), sql`lower(trim(${apItems.name})) = ${n}`, ...(exceptId ? [ne(apItems.id, exceptId)] : [])))
    .limit(1);
  return !!hit;
}

export const duplicateNameMessage = (name: string) =>
  `An item called "${name.trim()}" already exists. Item names must be unique — open the existing item, or give this one a distinguishing name.`;
