"use client";

/**
 * Audit history — QBO form-parity, Phase 5.
 *
 * Self-contained, the same shape as DocumentAttachmentsPanel/
 * DocumentEmailModal before it: given only {kind, id}, it fetches and
 * renders its own timeline from GET /api/documents/audit. Wired into the
 * same two places Print/Download, Email/Send and Attachments already are.
 */

import { useEffect, useState } from "react";
import { History, Loader, FilePlus, Pencil, Undo2, Trash2, Mail, Paperclip, PaperclipIcon } from "lucide-react";

type AuditRow = {
  id: string;
  eventType: string;
  meta: Record<string, any> | null;
  occurredAt: string;
  actorName: string | null;
};

type Props = {
  kind: "ledger" | "trade";
  id: string;
};

const EVENT_META: Record<string, { label: (r: AuditRow) => string; icon: any }> = {
  document_created:    { label: () => "Created", icon: FilePlus },
  document_edited:     { label: () => "Edited", icon: Pencil },
  document_reversed:   { label: () => "Reversed", icon: Undo2 },
  document_deleted:    { label: () => "Deleted", icon: Trash2 },
  document_emailed:    { label: (r) => `Emailed${r.meta?.to ? ` to ${r.meta.to}` : ""}`, icon: Mail },
  attachment_added:    { label: (r) => `Attached "${r.meta?.filename ?? "a file"}"`, icon: Paperclip },
  attachment_removed:  { label: (r) => `Removed attachment "${r.meta?.filename ?? ""}"`, icon: PaperclipIcon },
};

function describe(r: AuditRow): string {
  return (EVENT_META[r.eventType]?.label(r)) ?? r.eventType;
}

function iconFor(eventType: string) {
  return EVENT_META[eventType]?.icon ?? History;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function DocumentAuditPanel({ kind, id }: Props) {
  const [items, setItems] = useState<AuditRow[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/audit?docType=${kind}&docId=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setItems(Array.isArray(d) ? d : []); })
      .catch(() => { if (!cancelled) setItems([]); });
    return () => { cancelled = true; };
  }, [kind, id]);

  return (
    <div className="max-w-[1200px] mt-4">
      <div className="text-[11px] uppercase tracking-wider text-stone-500 mb-2 inline-flex items-center gap-1.5">
        <History size={12} /> Audit history{items && items.length > 0 ? ` (${items.length})` : ""}
      </div>

      {items === null ? (
        <div className="text-[12px] text-stone-500 inline-flex items-center gap-2"><Loader size={12} className="animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-[12px] text-stone-600">No history recorded yet.</div>
      ) : (
        <div className="space-y-1">
          {items.map(r => {
            const Icon = iconFor(r.eventType);
            return (
              <div key={r.id} className="flex items-center gap-3 text-[12px] rounded-lg px-3 py-2 bg-stone-900 border border-stone-800">
                <Icon size={12} className="text-stone-600 shrink-0" />
                <span className="text-stone-200">{describe(r)}</span>
                <span className="text-stone-500">{r.actorName ? `by ${r.actorName}` : ""}</span>
                <span className="ml-auto text-stone-600 shrink-0 tabular-nums">{formatWhen(r.occurredAt)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
