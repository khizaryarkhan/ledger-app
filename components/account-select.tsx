"use client";

/**
 * AccountSelect — a Chart-of-Accounts picker with "+ Add new account…" as its
 * last option. Picking it opens QuickAdd restricted to the same account types
 * the list is filtered by, and the new account is selected as soon as it is
 * created, so a user never has to leave a half-filled drawer to make one.
 *
 * Use this instead of a hand-built <select> of accounts in any drawer.
 */
import { useMemo, useState } from "react";
import { SelectField } from "@/components/form-kit";
import { QuickAdd } from "@/components/quick-add";

export type PickableAccount = {
  id: string; name: string; code?: string | null; type?: string | null;
  isHeader?: boolean | null; status?: string | null;
};

const ADD = "__add_account__";

export function accountLabel(a: PickableAccount): string {
  return `${a.code ? a.code + " " : ""}${a.name}`;
}

export function AccountSelect({
  accounts, types, value, onChange, inset = true, placeholder = "Choose...", canCreate = true, onCreated,
}: {
  accounts: PickableAccount[];
  /** Account types offered — and the only types a new account may take. */
  types: readonly string[];
  value: string;
  onChange: (id: string) => void;
  inset?: boolean;
  placeholder?: string;
  canCreate?: boolean;
  /** Lets the caller add the new account to its own list (e.g. other pickers on the form). */
  onCreated?: (row: PickableAccount) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [created, setCreated] = useState<PickableAccount[]>([]);

  const options = useMemo(() => {
    const seen = new Set<string>();
    return [...accounts, ...created].filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return !a.isHeader && (a.status ?? "Active") === "Active" && types.includes(a.type ?? "");
    });
  }, [accounts, created, types]);

  return (
    <>
      <SelectField
        inset={inset}
        value={value}
        onChange={(e) => (e.target.value === ADD ? setIsAdding(true) : onChange(e.target.value))}
      >
        <option value="">{options.length ? placeholder : "No accounts yet — add one"}</option>
        {options.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
        {canCreate && <option value={ADD}>+ Add new account…</option>}
      </SelectField>
      {isAdding && (
        <QuickAdd
          kind="account"
          accountTypes={types}
          onClose={() => setIsAdding(false)}
          onCreated={(row) => {
            const acct: PickableAccount = { ...row, type: row?.type ?? types[0] };
            setCreated((p) => [...p, acct]);
            onCreated?.(acct);
            onChange(acct.id);
            setIsAdding(false);
          }}
        />
      )}
    </>
  );
}
