"use client";

/**
 * The three chart sections of the employee dashboard — This week, Weeks behind,
 * Weeks ahead — all built from components/dash-charts so they behave alike:
 * a chart card, a "Show table" button inside it, and the table opening as its
 * own full-width card underneath, project code and name per row, a column per
 * week, totals, and hours worked on unplanned work flagged in red.
 */
import { Fragment, useState } from "react";
import { SelectField } from "@/components/form-kit";
import {
  HBarChart, ChartCard, TableCard, TableToggle, CodeCell,
  TH, THR, TD, TDR, TD_FLAG, TD_TOTAL, C_LOGGED, C_PLANNED, PALETTE,
  type ChartRow, type ChartSeries,
} from "@/components/dash-charts";
import { formatDateShort, fmt } from "@/lib/format";

export interface AheadData {
  weeks: string[];
  rows: { key: string; label: string; code?: string | null; weeks: number[]; total: number }[];
  totals: number[];
}
export interface LoggedRow { key: string; label: string; code?: string | null; logged: number }
export interface BehindData {
  weeksBack: number;
  weeks: { week: string; planned: number; logged: number }[];
  projects: { key: string; label: string; code?: string | null; planned: number; logged: number }[];
  statuses?: { week: string; status: string }[];
  matrix?: { key: string; label: string; code?: string | null; weeks: { planned: number; logged: number }[] }[];
}

const h = (n: number) => `${fmt.num2(n)} h`;
const wk = (d: string) => `w/c ${formatDateShort(d)}`;
const WEEK_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];
const named = (code: string | null | undefined, label: string) => (code ? `${code} · ${label}` : label);

const LOGGED_S: ChartSeries = { key: "logged", label: "Logged", color: C_LOGGED };
const PLANNED_S: ChartSeries = { key: "planned", label: "Planned", color: C_PLANNED };

const STATUS_WORD: Record<string, { label: string; cls: string }> = {
  approved:  { label: "Approved", cls: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30" },
  submitted: { label: "Submitted", cls: "bg-sky-500/15 text-sky-300 ring-sky-500/30" },
  returned:  { label: "Returned", cls: "bg-rose-500/15 text-rose-300 ring-rose-500/30" },
  draft:     { label: "Draft", cls: "bg-amber-500/15 text-amber-300 ring-amber-500/30" },
  missing:   { label: "Nothing logged", cls: "bg-stone-700/60 text-stone-300 ring-stone-600" },
};

function SectionHead({ title, select }: { title: string; select?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <h2 className="text-[15px] font-semibold text-white tracking-tight">{title}</h2>
      {select && <div className="w-32">{select}</div>}
    </div>
  );
}

function WeeksSelect({ value, onChange, extra }: { value: number; onChange: (n: number) => void; extra?: number[] }) {
  return (
    <SelectField value={String(value)} onChange={(e) => onChange(Number(e.target.value))}>
      {[...WEEK_CHOICES, ...(extra ?? [])].map((n) => <option key={n} value={n}>{n} {n === 1 ? "week" : "weeks"}</option>)}
    </SelectField>
  );
}

// ── This week ────────────────────────────────────────────────────────────────

export function ThisWeekSection({ ahead, logged }: { ahead: AheadData; logged: LoggedRow[] }) {
  const [open, setOpen] = useState(false);
  const byKey = new Map<string, { label: string; code: string | null; planned: number; logged: number }>();
  for (const r of ahead.rows) byKey.set(r.key, { label: r.label, code: r.code ?? null, planned: r.weeks[0] ?? 0, logged: 0 });
  for (const l of logged) {
    const cur = byKey.get(l.key) ?? { label: l.label, code: l.code ?? null, planned: 0, logged: 0 };
    byKey.set(l.key, { ...cur, logged: cur.logged + l.logged });
  }
  const items = Array.from(byKey.entries()).map(([key, v]) => ({ key, ...v }))
    .filter((r) => r.planned > 0 || r.logged > 0)
    .sort((a, b) => Math.max(b.planned, b.logged) - Math.max(a.planned, a.logged));
  const planned = items.reduce((s, r) => s + r.planned, 0);
  const done = items.reduce((s, r) => s + r.logged, 0);
  const rows: ChartRow[] = items.map((r) => ({ id: r.key, label: named(r.code, r.label), values: { logged: r.logged, planned: r.planned } }));

  return (
    <>
      <SectionHead title="This week" />
      <ChartCard title="Planned vs logged — by project" right={items.length ? `Planned ${h(planned)} · Logged ${h(done)}` : undefined}>
        <HBarChart rows={rows} series={[LOGGED_S, PLANNED_S]} empty="Nothing is planned or logged for you this week." />
        {items.length > 0 && <TableToggle open={open} onToggle={() => setOpen((v) => !v)} />}
      </ChartCard>
      {open && items.length > 0 && (
        <TableCard>
          <thead><tr><th className={TH}>No.</th><th className={TH}>Project</th><th className={THR}>Plan</th><th className={THR}>Actual</th></tr></thead>
          <tbody>
            {items.map((r) => (
              <tr key={r.key}>
                <CodeCell code={r.code} />
                <td className={TD}>{r.label}</td>
                <td className={TDR}>{fmt.num2(r.planned)}</td>
                <td className={`${TDR} ${r.planned === 0 && r.logged > 0 ? TD_FLAG : ""}`}>{fmt.num2(r.logged)}</td>
              </tr>
            ))}
            <tr><td className={`${TD} ${TD_TOTAL}`} colSpan={2}>Project total</td>
              <td className={`${TDR} ${TD_TOTAL}`}>{fmt.num2(planned)}</td><td className={`${TDR} ${TD_TOTAL}`}>{fmt.num2(done)}</td></tr>
          </tbody>
        </TableCard>
      )}
    </>
  );
}

// ── Weeks behind ─────────────────────────────────────────────────────────────

export function WeeksBehindSection({ behind, weeksBack, onWeeksBack }: { behind: BehindData; weeksBack: number; onWeeksBack: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const weekRows: ChartRow[] = behind.weeks.map((w) => ({ id: w.week, label: wk(w.week), values: { logged: w.logged, planned: w.planned } }));
  const projectRows: ChartRow[] = behind.projects.map((p) => ({ id: p.key, label: named(p.code, p.label), values: { logged: p.logged, planned: p.planned } }));
  const matrix = behind.matrix ?? [];
  const weeks = behind.weeks.map((w) => w.week);
  const statusOf = (w: string) => behind.statuses?.find((s) => s.week === w)?.status;
  const totalAt = (i: number, k: "planned" | "logged") => matrix.reduce((s, r) => s + (r.weeks[i]?.[k] ?? 0), 0);

  return (
    <>
      <SectionHead title="Weeks behind" select={<WeeksSelect value={weeksBack} onChange={onWeeksBack} extra={[12]} />} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard title="Planned vs logged — per week">
          <HBarChart rows={weekRows} series={[LOGGED_S, PLANNED_S]} labelWidth={110} empty="Nothing planned or logged in this window." />
          {matrix.length > 0 && <TableToggle open={open} onToggle={() => setOpen((v) => !v)} />}
        </ChartCard>
        <ChartCard title="Planned vs logged — per project">
          <HBarChart rows={projectRows} series={[LOGGED_S, PLANNED_S]} labelWidth={230} empty="Nothing planned or logged in this window." />
        </ChartCard>
      </div>
      {open && matrix.length > 0 && (
        <TableCard>
          <thead>
            <tr>
              <th className={TH} rowSpan={2}>No.</th><th className={TH} rowSpan={2}>Project</th>
              {weeks.map((w) => <th key={w} colSpan={2} className={`${THR} !text-center border-l border-stone-800`}>{formatDateShort(w)}</th>)}
            </tr>
            <tr>{weeks.map((w) => <Fragment key={w}><th className={`${THR} border-l border-stone-800`}>Plan</th><th className={THR}>Actual</th></Fragment>)}</tr>
          </thead>
          <tbody>
            <tr>
              <td className={`${TD} font-semibold`} colSpan={2}>Timesheet</td>
              {weeks.map((w) => {
                const st = STATUS_WORD[statusOf(w) ?? "missing"] ?? STATUS_WORD.missing;
                return <td key={w} colSpan={2} className={`${TD} text-center border-l border-stone-800`}><span className={`inline-block rounded-md px-2 py-0.5 text-[11px] font-medium ring-1 ${st.cls}`}>{st.label}</span></td>;
              })}
            </tr>
            {matrix.map((r) => (
              <tr key={r.key}>
                <CodeCell code={r.code ?? null} />
                <td className={TD}>{r.label}</td>
                {r.weeks.map((c, i) => (
                  <Fragment key={i}>
                    <td className={`${TDR} border-l border-stone-800`}>{fmt.num2(c.planned)}</td>
                    <td className={`${TDR} ${c.planned === 0 && c.logged > 0 ? TD_FLAG : ""}`}>{fmt.num2(c.logged)}</td>
                  </Fragment>
                ))}
              </tr>
            ))}
            <tr>
              <td className={`${TD} ${TD_TOTAL}`} colSpan={2}>Project total</td>
              {weeks.map((w, i) => (
                <Fragment key={w}>
                  <td className={`${TDR} ${TD_TOTAL} border-l border-stone-800`}>{fmt.num2(totalAt(i, "planned"))}</td>
                  <td className={`${TDR} ${TD_TOTAL}`}>{fmt.num2(totalAt(i, "logged"))}</td>
                </Fragment>
              ))}
            </tr>
          </tbody>
        </TableCard>
      )}
    </>
  );
}

// ── Weeks ahead ──────────────────────────────────────────────────────────────

export function WeeksAheadSection({ ahead, weeksAhead, onWeeksAhead }: { ahead: AheadData; weeksAhead: number; onWeeksAhead: (n: number) => void }) {
  const [open, setOpen] = useState(false);
  const idx = ahead.weeks.slice(1).map((_, i) => i + 1);
  const projects = ahead.rows
    .map((r) => ({ ...r, window: idx.reduce((s, i) => s + (r.weeks[i] ?? 0), 0) }))
    .filter((r) => r.window > 0)
    .sort((a, b) => b.window - a.window);
  const weekRows: ChartRow[] = idx.map((i) => ({ id: ahead.weeks[i], label: wk(ahead.weeks[i]), values: { planned: ahead.totals[i] ?? 0 } }))
    .filter(() => projects.length > 0);
  const projectRows: ChartRow[] = projects.map((p) => ({ id: p.key, label: named(p.code, p.label), values: { planned: p.window } }));
  const windowTotal = projects.reduce((s, p) => s + p.window, 0);
  const colorOf = new Map(projects.map((p, i) => [p.key, PALETTE[i % PALETTE.length]]));
  const planned: ChartSeries[] = [PLANNED_S];

  return (
    <>
      <SectionHead title="Weeks ahead" select={<WeeksSelect value={weeksAhead} onChange={onWeeksAhead} />} />
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <ChartCard title="Planned — per week" right={projects.length ? `Total ${h(windowTotal)}` : undefined}>
          <HBarChart rows={weekRows} series={planned} labelWidth={110} empty="Nothing is planned for you in these weeks yet." />
          {projects.length > 0 && <TableToggle open={open} onToggle={() => setOpen((v) => !v)} />}
        </ChartCard>
        <ChartCard title="Planned — per project">
          <HBarChart rows={projectRows} series={planned} labelWidth={230} empty="Nothing is planned for you in these weeks yet." />
        </ChartCard>
      </div>
      {open && projects.length > 0 && (
        <TableCard>
          <thead>
            <tr>
              <th className={TH}>No.</th><th className={TH}>Project</th>
              {idx.map((i) => <th key={i} className={THR}>{wk(ahead.weeks[i])}</th>)}
              <th className={THR}>Total</th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.key}>
                <CodeCell code={p.code ?? null} color={colorOf.get(p.key)} />
                <td className={TD}>{p.label}</td>
                {idx.map((i) => <td key={i} className={TDR}>{fmt.num2(p.weeks[i] ?? 0)}</td>)}
                <td className={`${TDR} font-semibold text-white`}>{fmt.num2(p.window)}</td>
              </tr>
            ))}
            <tr>
              <td className={`${TD} ${TD_TOTAL}`} colSpan={2}>Planned total</td>
              {idx.map((i) => <td key={i} className={`${TDR} ${TD_TOTAL}`}>{fmt.num2(ahead.totals[i] ?? 0)}</td>)}
              <td className={`${TDR} ${TD_TOTAL}`}>{fmt.num2(windowTotal)}</td>
            </tr>
          </tbody>
        </TableCard>
      )}
    </>
  );
}
