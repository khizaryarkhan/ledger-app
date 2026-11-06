"use client";

/**
 * The Personal, Emergency contact and Bank tabs of the person drawer.
 * Rules: lib/resources/personal-details.ts. Secrets (national ID, tax number,
 * bank account number, sort/routing code) are never sent to the browser in
 * full — the field shows "•••• 6819", stays empty, and only what is typed
 * into it replaces the stored value.
 */
import { useEffect, useState } from "react";
import { Field, SelectField, controlInset } from "@/components/form-kit";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL, type SecretField } from "@/lib/resources/personal-details";

type Masked = { set: boolean; last4: string | null };

export interface PersonDetailsState {
  loaded: boolean;
  error: string | null;
  details: Record<string, string>;
  masked: Partial<Record<SecretField, Masked>>;
  /** undefined = untouched, "" = clear, text = replace */
  secretEdits: Partial<Record<SecretField, string>>;
  dirty: boolean;
}

const EMPTY: PersonDetailsState = { loaded: false, error: null, details: {}, masked: {}, secretEdits: {}, dirty: false };

/**
 * `endpoint` overrides where details load from and save to — the self-service
 * page passes /api/resources/me/personal-details, which finds the person from
 * the session rather than from an id.
 */
export function usePersonDetails(id: string | undefined, endpoint?: string) {
  const loadUrl = endpoint ?? (id ? `/api/resources/${id}/personal-details` : null);
  const [state, setState] = useState<PersonDetailsState>(loadUrl ? EMPTY : { ...EMPTY, loaded: true });

  useEffect(() => {
    if (!loadUrl) return;
    let live = true;
    fetch(loadUrl)
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!live) return;
        if (!r.ok) { setState({ ...EMPTY, loaded: true, error: d?.error || "Could not load personal details" }); return; }
        setState({ ...EMPTY, loaded: true, details: d.details ?? {}, masked: d.secrets ?? {} });
      })
      .catch(() => { if (live) setState({ ...EMPTY, loaded: true, error: "Could not load personal details" }); });
    return () => { live = false; };
  }, [loadUrl]);

  const setField = (k: string, v: string) =>
    setState((s) => ({ ...s, dirty: true, details: { ...s.details, [k]: v } }));
  const setSecret = (k: SecretField, v: string) =>
    setState((s) => ({ ...s, dirty: true, secretEdits: { ...s.secretEdits, [k]: v } }));

  /** Save for `resourceId` (passed in so a just-created person can be saved too). */
  async function save(resourceId?: string): Promise<string | null> {
    if (!state.dirty) return null;
    const url = endpoint ?? (resourceId ? `/api/resources/${resourceId}/personal-details` : null);
    if (!url) return "Save the person first";
    const body: Record<string, string> = { ...state.details };
    for (const [k, v] of Object.entries(state.secretEdits)) if (v !== undefined) body[k] = v;
    const r = await fetch(url, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return d?.error || "Could not save personal details";
    setState((s) => ({ ...s, dirty: false, details: d.details ?? s.details, masked: d.secrets ?? s.masked, secretEdits: {} }));
    return null;
  }

  return { state, setField, setSecret, save };
}

type Hook = ReturnType<typeof usePersonDetails>;

function Text({ hook, k, label, type = "text", className = "", readOnly = false }: { hook: Hook; k: string; label: string; type?: string; className?: string; readOnly?: boolean }) {
  return (
    <Field label={label} className={className}>
      <input type={type} className={controlInset} readOnly={readOnly} disabled={readOnly}
        value={hook.state.details[k] ?? ""} onChange={(e) => hook.setField(k, e.target.value)} />
    </Field>
  );
}

function Choice({ hook, k, label, options, className = "", disabled = false }: { hook: Hook; k: string; label: string; options: { v: string; l: string }[]; className?: string; disabled?: boolean }) {
  return (
    <Field label={label} className={className}>
      <SelectField inset disabled={disabled} value={hook.state.details[k] ?? ""} onChange={(e) => hook.setField(k, e.target.value)}>
        <option value="">Not stated</option>
        {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
      </SelectField>
    </Field>
  );
}

function Secret({ hook, k, label, hint, className = "" }: { hook: Hook; k: SecretField; label: string; hint?: string; className?: string }) {
  const m = hook.state.masked[k];
  const edit = hook.state.secretEdits[k];
  const cleared = edit === "";
  const placeholder = cleared ? "Will be removed on save"
    : m?.set ? (m.last4 ? `•••• ${m.last4} — type to replace` : "Saved — type to replace") : "";
  return (
    <Field label={label} className={className} hint={hint ?? "Stored encrypted. Only the last four characters are ever shown."}>
      <div className="flex gap-2">
        <input className={controlInset} autoComplete="off" placeholder={placeholder}
          value={cleared ? "" : edit ?? ""} onChange={(e) => hook.setSecret(k, e.target.value)} />
        {m?.set && !cleared && (
          <button type="button" onClick={() => hook.setSecret(k, "")}
            className="h-9 px-2.5 text-[12px] rounded-md ring-1 ring-stone-700 text-stone-400 hover:text-rose-300 shrink-0">Clear</button>
        )}
      </div>
    </Field>
  );
}

function Heading({ children }: { children: string }) {
  return <div className="text-[11px] font-semibold text-stone-500 uppercase tracking-wider mb-3">{children}</div>;
}

/** Loading / error placeholder; null once the details are ready to show. */
function gate(hook: Hook) {
  if (!hook.state.loaded) return <p className="text-[13px] text-stone-500">Loading…</p>;
  if (hook.state.error) return <p className="text-[13px] text-rose-400">{hook.state.error}</p>;
  return null;
}

const GENDERS = [{ v: "female", l: "Female" }, { v: "male", l: "Male" }, { v: "non_binary", l: "Non-binary" }, { v: "other", l: "Other" }];
const MARITAL = [{ v: "single", l: "Single" }, { v: "married", l: "Married" }, { v: "civil_partnership", l: "Civil partnership" }, { v: "divorced", l: "Divorced" }, { v: "widowed", l: "Widowed" }];
const RELATIONSHIPS = ["Spouse / partner", "Parent", "Child", "Sibling", "Friend", "Other"].map((r) => ({ v: r, l: r }));
const EMPLOYMENT = EMPLOYMENT_TYPES.map((t) => ({ v: t, l: EMPLOYMENT_TYPE_LABEL[t] }));

/** `lockEmployment`: self-service — employment fields are the administrator's to change. */
export function PersonalTab({ hook, lockEmployment = false }: { hook: Hook; lockEmployment?: boolean }) {
  const lock = lockEmployment;
  const g = gate(hook);
  if (g) return g;
  return (
    <div className="space-y-6">
      <div>
        <Heading>Bio data</Heading>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Text hook={hook} k="preferredName" label="Preferred name" />
          <Text hook={hook} k="dateOfBirth" label="Date of birth" type="date" />
          <Choice hook={hook} k="gender" label="Gender" options={GENDERS} />
          <Choice hook={hook} k="maritalStatus" label="Marital status" options={MARITAL} />
          <Text hook={hook} k="nationality" label="Nationality" />
          <Secret hook={hook} k="nationalId" label="National ID / passport no." />
        </div>
      </div>
      <div>
        <Heading>Contact</Heading>
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Text hook={hook} k="personalEmail" label="Personal email" type="email" />
          <Text hook={hook} k="personalPhone" label="Personal phone" type="tel" />
          <Text hook={hook} k="addressLine1" label="Address line 1" className="col-span-2" />
          <Text hook={hook} k="addressLine2" label="Address line 2" className="col-span-2" />
          <Text hook={hook} k="city" label="City" />
          <Text hook={hook} k="region" label="County / state" />
          <Text hook={hook} k="postcode" label="Postcode" />
          <Text hook={hook} k="country" label="Country" />
        </div>
      </div>
      <div>
        <Heading>Employment</Heading>
        {lock && <p className="text-[12px] text-stone-500 -mt-1 mb-3">Your administrator keeps these up to date. Ask them if something is wrong.</p>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-4">
          <Text hook={hook} k="employeeNumber" label="Employee number" readOnly={lock} />
          <Text hook={hook} k="jobTitle" label="Job title" readOnly={lock} />
          <Choice hook={hook} k="employmentType" label="Employment type" options={EMPLOYMENT} disabled={lock} />
          <Secret hook={hook} k="taxNumber" label="Tax / NI number" />
          <Text hook={hook} k="startDate" label="Start date" type="date" readOnly={lock} />
          <Text hook={hook} k="endDate" label="End date" type="date" readOnly={lock} />
        </div>
      </div>
    </div>
  );
}

export function EmergencyTab({ hook }: { hook: Hook }) {
  const g = gate(hook);
  if (g) return g;
  return (
    <div className="grid grid-cols-2 gap-x-4 gap-y-4">
      <Text hook={hook} k="emergencyName" label="Contact name" className="col-span-2" />
      <Choice hook={hook} k="emergencyRelationship" label="Relationship" options={RELATIONSHIPS} />
      <Text hook={hook} k="emergencyPhone" label="Phone" type="tel" />
      <Text hook={hook} k="emergencyEmail" label="Email" type="email" className="col-span-2" />
    </div>
  );
}

export function BankTab({ hook }: { hook: Hook }) {
  const g = gate(hook);
  if (g) return g;
  return (
    <div className="space-y-4">
      <p className="text-[12px] text-stone-500">
        Used for paying this person. Account and sort / routing numbers are encrypted and never shown in full again once saved.
      </p>
      <div className="grid grid-cols-2 gap-x-4 gap-y-4">
        <Text hook={hook} k="bankAccountName" label="Account holder name" className="col-span-2" />
        <Text hook={hook} k="bankName" label="Bank name" className="col-span-2" />
        <Secret hook={hook} k="bankAccountNumber" label="Account number / IBAN" className="col-span-2" />
        <Secret hook={hook} k="bankSortCode" label="Sort code / routing no." hint="Encrypted." />
        <Text hook={hook} k="bankSwift" label="SWIFT / BIC" />
      </div>
    </div>
  );
}
