"use client";

/**
 * ISO 3166-1 country picker (2026-11-20, EDI addresses).
 *
 * Stores the two-letter CODE, and hands back the country name alongside so
 * screens that print or group by the name (documents, regions) keep working
 * unchanged. A record that has a name but no code yet pre-selects the code its
 * name means (exact match only, lib/countries.ts), so saving the form once
 * fills the code in; a name that matches nothing shows as unset.
 */
import { SelectField } from "@/components/form-kit";
import { COUNTRIES, countryByCode, countryCodeFromName } from "@/lib/countries";

export function countryCodeFor(code?: string | null, name?: string | null): string {
  return countryByCode(code)?.code ?? countryCodeFromName(name) ?? "";
}

export function CountrySelect({
  code, name, onChange, inset = false, placeholder = "Select country…", className = "", id,
}: {
  code?: string | null; name?: string | null;
  onChange: (code: string, name: string) => void;
  inset?: boolean; placeholder?: string; className?: string; id?: string;
}) {
  const value = countryCodeFor(code, name);
  return (
    <SelectField id={id} inset={inset} className={className} value={value}
      onChange={e => { const c = countryByCode(e.target.value); onChange(c?.code ?? "", c?.name ?? ""); }}>
      <option value="">{placeholder}</option>
      {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.name}</option>)}
    </SelectField>
  );
}
