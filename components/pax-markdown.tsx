// Renders a model's answer. Deliberately small and safe: it builds React elements
// from a handful of markdown shapes (paragraphs, headings, bullet and numbered
// lists, pipe tables, fenced code, **bold**, `code`) and never injects HTML, so
// text a model copied out of an invoice note cannot become markup or a link.

import type { ReactNode } from "react";

const INLINE = /(\*\*[^*]+\*\*|`[^`]+`)/g;

function inline(text: string): ReactNode[] {
  return text.split(INLINE).filter(Boolean).map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return <strong key={i} className="font-semibold text-stone-100">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return <code key={i} className="rounded bg-stone-800 px-1 text-[13px] text-stone-200">{part.slice(1, -1)}</code>;
    return part;
  });
}

const isRow = (l: string) => /^\s*\|.*\|\s*$/.test(l);
const isRule = (l: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(l);
const cells = (l: string) => l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim());

export function PaxMarkdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }

    if (line.trim().startsWith("```")) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) body.push(lines[i++]);
      i++;
      out.push(<pre key={key++} className="overflow-x-auto rounded-lg bg-stone-900 border border-stone-800 p-3 text-[13px] text-stone-300"><code>{body.join("\n")}</code></pre>);
      continue;
    }

    if (isRow(line) && i + 1 < lines.length && isRule(lines[i + 1])) {
      const head = cells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isRow(lines[i])) rows.push(cells(lines[i++]));
      out.push(
        <div key={key++} className="overflow-x-auto rounded-lg border border-stone-800">
          <table className="w-full text-[13px]">
            <thead><tr className="bg-stone-900 text-stone-400">{head.map((h, c) => <th key={c} className="px-3 py-1.5 text-left font-medium">{inline(h)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-stone-800 text-stone-200">{r.map((c, ci) => <td key={ci} className="px-3 py-1.5 align-top">{inline(c)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      out.push(<p key={key++} className="text-[15px] font-semibold text-white">{inline(heading[2])}</p>);
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*[-*]\s+/, ""));
      out.push(<ul key={key++} className="list-disc pl-5 space-y-1">{items.map((t, n) => <li key={n}>{inline(t)}</li>)}</ul>);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*\d+[.)]\s+/, ""));
      out.push(<ol key={key++} className="list-decimal pl-5 space-y-1">{items.map((t, n) => <li key={n}>{inline(t)}</li>)}</ol>);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^\s*([-*]|\d+[.)])\s+/.test(lines[i]) && !lines[i].trim().startsWith("```") && !/^#{1,4}\s/.test(lines[i]) && !isRow(lines[i])) para.push(lines[i++]);
    if (para.length) out.push(<p key={key++}>{inline(para.join(" "))}</p>);
    else i++;
  }

  return <div className="space-y-3 text-[15px] leading-relaxed text-stone-200 max-w-[68ch]">{out}</div>;
}
