/**
 * Maps template columns to the QBO list they reference, so the import UI can
 * offer a dropdown of real QuickBooks values (Customer, Supplier, Item, Account,
 * Tax Code, Class, Location, Payment Method, Terms) instead of free text.
 *
 * A value typed in one of these columns must already exist in QuickBooks — the
 * dropdown lets the user pick the correct one rather than have the row fail.
 */

import type { RefKind } from "./ref-resolver";
import type { BatchEntity } from "./types";

/**
 * A bare "Name" column means something different per entity: `account` /
 * `class` / `department` / `item` use it for the record's OWN name (not a
 * reference to another list — no dropdown belongs there), while
 * `journalentry` (a line's Entity ref, exported by mapJournalEntryRows) and
 * `timeactivity` (its Employee/Vendor, read by buildTimeActivity) are real
 * references that need one. A global `refKindForColumn("name")` mapping
 * would incorrectly force a dropdown onto every other entity's own-name
 * column, so this is scoped per entity id instead. Single-kind only, to
 * match the shape entityRefColumns/the override-picker route already use —
 * the fuller Employee|Vendor union for timeactivity's Excel dropdown lives
 * in dropdowns.ts's entity-scoped union table, same split as "Received
 * From" (single Customer kind here, full Customer|Vendor|Employee union
 * there).
 */
const ENTITY_NAME_OVERRIDES: Record<string, RefKind> = {
  // PRIMARY kind only. Both of these genuinely accept more than one list —
  // a journal line's Name may be a Customer, Vendor or Employee, and a time
  // activity's an Employee or Vendor — and the full unions live in
  // dropdowns.ts's ENTITY_UNION_COLUMNS, which is what the spreadsheet picker
  // uses. Do not read this table as "the only kind allowed": the builders
  // accept the whole union, and treating this as exhaustive is what left
  // journal-entry Name offering customers only.
  journalentry: "Customer",
  timeactivity: "Employee",
};

export function refKindForColumn(column: string, entityId?: string): RefKind | null {
  const c = column.trim().toLowerCase();

  if (c === "name" && entityId) {
    const override = ENTITY_NAME_OVERRIDES[entityId];
    if (override) return override;
  }

  if ([
    "customer", "expense customer", "line item customer", "parent customer",
    "received from", "billable customer:product/service",
  ].includes(c)) return "Customer";

  if (c === "vendor" || c === "payee") return "Vendor";

  if (["product/service", "service", "line item"].includes(c)) return "Item";

  if ([
    "account", "bank account", "expense account", "income account", "line account",
    "deposit to", "deposit to account", "deposit to account name", "refunded from",
    "transfer funds from", "transfer funds to", "adjustment account", "discount account",
    "accounts payable account name", "bank or cc account", "credit card account",
    "cash back goes to", "parent account", "inventory asset account",
  ].includes(c)) return "Account";

  if ([
    "class", "product/service class", "expense class", "line item class",
    "line class", "parent class",
  ].includes(c)) return "Class";

  if (c === "location" || c === "parent location") return "Department";

  if (c === "sales tax code" || c === "tax code") return "TaxCode";

  if (["payment method", "preferred payment method", "line payment method"].includes(c)) return "PaymentMethod";

  if (c === "terms") return "Term";

  return null;
}

export interface RefColumn { column: string; kind: RefKind; }

/** All reference columns for an entity, in template order. */
export function entityRefColumns(entity: BatchEntity): RefColumn[] {
  const out: RefColumn[] = [];
  const seen = new Set<string>();
  for (const col of entity.columns) {
    const c = col.trim();
    if (seen.has(c)) continue;
    seen.add(c);
    const kind = refKindForColumn(c, entity.id);
    if (kind) out.push({ column: c, kind });
  }
  return out;
}

/** Distinct RefKinds an entity references (for preloading). */
export function entityRefKinds(entity: BatchEntity): RefKind[] {
  return [...new Set(entityRefColumns(entity).map((r) => r.kind))];
}
