"use client";

import { useState } from "react";
import { useData } from "@/components/data-provider";
import { fyStart } from "@/lib/accounting/report-periods";
import { localToday } from "@/lib/format";

/**
 * The "From" date a period report opens with: the start of the organisation's CURRENT fiscal year, the same default
 * the financial statements use ("This fiscal year to date"). Reports used to hardcode 1 January (or, for the
 * General Ledger, 1 July), so an organisation whose year starts in another month saw a different period on each
 * report. A date the user (or a link) sets wins over the default.
 */
export function useFiscalFrom(initial?: string | null): [string, (v: string) => void] {
  const { orgSettings } = useData();
  const [chosen, setChosen] = useState<string | null>(initial || null);
  return [chosen ?? fyStart(localToday(), orgSettings.fiscalYearStartMonth || 1), setChosen];
}
