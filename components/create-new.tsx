"use client";

/**
 * "+ Add new …" for any picker. A <select> adds
 *   <option value={CREATE_NEW}>{createNewLabel(kind)}</option>
 * as its last option; picking it opens <CreateNewDrawer kind=…>, which renders
 * the ONE real form for that record (never a thinner copy — see CLAUDE.md
 * "Quick-add inline drawers were silently a SECOND, thinner form"):
 * customers/suppliers → PartyDrawer, items → NewItemDrawer, class/location →
 * QuickAdd. `onCreated` receives the new row so the caller can select it.
 *
 * Accounts have their own picker: components/account-select.tsx.
 */
import { PartyDrawer } from "@/components/party-drawer";
import { NewItemDrawer } from "@/components/products-register";
import { QuickAdd } from "@/components/quick-add";

export const CREATE_NEW = "__create_new__";

export type CreateKind = "customer" | "supplier" | "item" | "stock-item" | "material" | "class" | "location";

const LABELS: Record<CreateKind, string> = {
  customer: "+ Add new customer…",
  supplier: "+ Add new supplier…",
  item: "+ Add new item…",
  "stock-item": "+ Add new item…",
  material: "+ Add new material…",
  class: "+ Add new class…",
  location: "+ Add new location…",
};

export function createNewLabel(kind: CreateKind): string {
  return LABELS[kind];
}

export function CreateNewDrawer({ kind, onClose, onCreated }: {
  kind: CreateKind;
  onClose: () => void;
  onCreated: (row: any) => void;
}) {
  // Every caller is already inside a drawer or form, so the new one sits above it.
  const done = (row?: any) => { if (row?.id) onCreated(row); onClose(); };
  if (kind === "customer" || kind === "supplier") {
    return <PartyDrawer type={kind === "customer" ? "customers" : "suppliers"} elevated onClose={onClose} onCreated={done} />;
  }
  if (kind === "item") return <NewItemDrawer elevated onClose={onClose} onCreated={done} />;
  // Receiving, shipping and builds move stock, so the new item starts as a stocked kind.
  if (kind === "stock-item") return <NewItemDrawer initialProductType="StockItem" elevated onClose={onClose} onCreated={done} />;
  if (kind === "material") return <NewItemDrawer initialProductType="RawMaterial" elevated onClose={onClose} onCreated={done} />;
  return <QuickAdd kind={kind} onClose={onClose} onCreated={done} />;
}
