"use client";

/**
 * File attachments — QBO form-parity, Phase 4.
 *
 * Self-contained, like DocumentEmailModal and the Print/Download buttons
 * before it: given only {kind, id}, it lists/uploads/downloads/deletes
 * everything itself. Upload goes straight from the browser to Vercel Blob
 * (via /api/documents/attachments/blob-token) — never through our own
 * serverless functions, which cap request bodies at ~4.5 MB — then this
 * component tells the server the upload happened (POST /api/documents/
 * attachments) so the document_attachments row gets created; see that
 * route's comment for why it isn't done via Vercel's own completion webhook.
 *
 * Reused everywhere a document can take an attachment: components/new-
 * document-form.tsx (trade documents) and app/(app)/accounting/transactions/
 * [id]/page.tsx (native ledger documents) — the same two places Print/
 * Download and Email/Send were wired into.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Paperclip, Download, Trash2, Loader, AlertTriangle, UploadCloud } from "lucide-react";

type Attachment = {
  id: string;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  createdAt: string;
};

type Props = {
  kind: "ledger" | "trade";
  id: string;
};

function formatSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentAttachmentsPanel({ kind, id }: Props) {
  const [items, setItems] = useState<Attachment[] | null>(null);
  const [err, setErr] = useState("");
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    fetch(`/api/documents/attachments?docType=${kind}&docId=${encodeURIComponent(id)}`)
      .then(r => r.json())
      .then(d => setItems(Array.isArray(d) ? d : []))
      .catch(() => setItems([]));
  }, [kind, id]);

  useEffect(() => { load(); }, [load]);

  async function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setErr("");
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const blob = await upload(file.name, file, {
          access: "public",
          handleUploadUrl: "/api/documents/attachments/blob-token",
          clientPayload: JSON.stringify({ docType: kind, docId: id }),
        });
        const res = await fetch("/api/documents/attachments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            docType: kind, docId: id,
            filename: file.name, contentType: file.type || undefined, sizeBytes: file.size,
            blobUrl: blob.url,
          }),
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          throw new Error(d.error || `Failed to save ${file.name}`);
        }
      }
      load();
    } catch (e: any) {
      setErr(e?.message || "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function remove(attId: string) {
    if (!confirm("Remove this attachment? This cannot be undone.")) return;
    setDeletingId(attId);
    try {
      const res = await fetch(`/api/documents/attachments/${attId}`, { method: "DELETE" });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error || "Failed to remove attachment."); return; }
      setItems(prev => (prev ?? []).filter(a => a.id !== attId));
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="max-w-[1200px] mt-4">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[11px] uppercase tracking-wider text-stone-500 inline-flex items-center gap-1.5">
          <Paperclip size={12} /> Attachments{items && items.length > 0 ? ` (${items.length})` : ""}
        </div>
        <label className="inline-flex items-center gap-1.5 text-[12px] font-medium text-stone-300 hover:text-white cursor-pointer">
          {uploading ? <Loader size={13} className="animate-spin" /> : <UploadCloud size={13} />}
          {uploading ? "Uploading…" : "Add file"}
          <input ref={fileInput} type="file" multiple className="hidden" disabled={uploading}
            onChange={e => handleFiles(e.target.files)} />
        </label>
      </div>

      {err && (
        <div className="mb-2 text-[12px] text-rose-400 bg-rose-950/40 border border-rose-900 rounded-lg px-3 py-2 inline-flex items-center gap-2">
          <AlertTriangle size={13} /> {err}
        </div>
      )}

      {items === null ? (
        <div className="text-[12px] text-stone-500 inline-flex items-center gap-2"><Loader size={12} className="animate-spin" /> Loading…</div>
      ) : items.length === 0 ? (
        <div className="text-[12px] text-stone-600">No attachments yet.</div>
      ) : (
        <div className="space-y-1">
          {items.map(a => (
            <div key={a.id} className="flex items-center gap-3 text-[12px] rounded-lg px-3 py-2 bg-stone-900 border border-stone-800">
              <Paperclip size={12} className="text-stone-600 shrink-0" />
              <span className="text-stone-200 truncate">{a.filename}</span>
              <span className="text-stone-600 shrink-0">{formatSize(a.sizeBytes)}</span>
              <span className="ml-auto flex items-center gap-2 shrink-0">
                <a href={`/api/documents/attachments/${a.id}`} title="Download"
                  className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-stone-200">
                  <Download size={13} />
                </a>
                <button onClick={() => remove(a.id)} disabled={deletingId === a.id} title="Remove"
                  className="p-1 rounded hover:bg-stone-700 text-stone-500 hover:text-rose-400 disabled:opacity-50">
                  {deletingId === a.id ? <Loader size={13} className="animate-spin" /> : <Trash2 size={13} />}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
