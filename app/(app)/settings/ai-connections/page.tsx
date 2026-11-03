"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, Loader, ShieldCheck, Trash2 } from "lucide-react";
import { Card } from "@/components/ui";
import { formatDate } from "@/lib/format";

type Connection = {
  id: string;
  scopes: string;
  createdAt: string;
  lastUsedAt: string | null;
  clientName: string | null;
  orgName: string | null;
};

const ACCESS_LABELS: { scope: string; label: string; risky?: boolean }[] = [
  { scope: "mcp:read", label: "Read" },
  { scope: "mcp:write", label: "Create & change" },
  { scope: "mcp:delete", label: "Delete", risky: true },
  { scope: "mcp:sensitive", label: "Send email & settings", risky: true },
  { scope: "mcp:accounting_system", label: "Change QuickBooks / Xero", risky: true },
];

/** A read-only box with a Copy button. Clicking the box selects it, so a blocked clipboard still works by hand. */
function CopyField({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      input.current?.select(); // clipboard blocked: leave it selected for Ctrl+C
    }
  };

  return (
    <div className="flex items-stretch gap-2">
      <input
        ref={input}
        readOnly
        aria-label={label}
        value={value}
        onFocus={(e) => e.currentTarget.select()}
        className="flex-1 min-w-0 h-9 rounded-md bg-stone-950 border border-stone-700 px-3 text-[13px] text-stone-100 font-mono"
      />
      <button
        type="button"
        onClick={copy}
        disabled={!value}
        className="h-9 px-3 rounded-md text-[12px] font-medium inline-flex items-center gap-1.5 bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="shrink-0 w-5 h-5 rounded-full bg-stone-800 text-stone-300 text-[11px] font-semibold flex items-center justify-center mt-0.5">{n}</span>
      <span className="text-[13px] text-stone-300 leading-relaxed">{children}</span>
    </li>
  );
}

export default function AiConnectionsPage() {
  const [origin, setOrigin] = useState("");
  const [rows, setRows] = useState<Connection[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

  // The address people paste is built from where they are right now, so it is
  // correct on every domain (including a white-label subdomain) with no config.
  useEffect(() => { setOrigin(window.location.origin); }, []);
  const address = origin ? `${origin}/api/mcp` : "";

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/mcp/connections", { cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load your connections.");
      setRows(data.connections ?? []);
      setLoadError("");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load your connections.");
      setRows([]);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const disconnect = async (id: string) => {
    setBusy(id);
    setActionError("");
    try {
      const res = await fetch(`/api/mcp/connections?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not disconnect.");
      setConfirming(null);
      await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Could not disconnect.");
    } finally {
      setBusy(null);
    }
  };

  const cliCommand = address ? `claude mcp add --transport http prime-accountax ${address}` : "";

  return (
    <div className="p-6 max-w-[760px] mx-auto">
      <Link href="/settings" className="inline-flex items-center gap-1.5 text-[12px] text-stone-500 hover:text-stone-300 mb-6 transition-colors">
        <ArrowLeft size={13} /> Back to Settings
      </Link>

      <div className="mb-6">
        <h1 className="text-[18px] font-semibold text-white tracking-tight">AI connections</h1>
        <p className="text-[13px] text-stone-400 mt-0.5">
          Let Claude, ChatGPT or any other AI assistant that supports MCP work in Prime Accountax for you — read your invoices,
          chase customers, tidy QuickBooks — by just asking it.
        </p>
      </div>

      {/* 1. The one thing to copy */}
      <Card className="p-5 mb-5">
        <h2 className="text-[13px] font-semibold text-white">Your connection address</h2>
        <p className="text-[12px] text-stone-500 mt-0.5 mb-3">This is the only thing you need. Paste it into your AI assistant.</p>
        <CopyField value={address} label="Connection address" />
      </Card>

      {/* 2. How to connect — OAuth means there is nothing to configure */}
      <Card className="p-5 mb-5">
        <h2 className="text-[13px] font-semibold text-white">Connect in four clicks</h2>
        <p className="text-[12px] text-stone-500 mt-0.5 mb-4">
          There are no keys or passwords to copy. Your assistant opens a Prime Accountax sign-in page and you approve it there.
        </p>

        <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">Claude (claude.ai or the desktop app)</h3>
        <ol className="space-y-2.5 mb-3">
          <Step n={1}>Open <strong className="text-stone-100">Settings → Connectors</strong> and choose <strong className="text-stone-100">Add custom connector</strong>.</Step>
          <Step n={2}>Name it <em>Prime Accountax</em> and paste the address above.</Step>
          <Step n={3}>Click <strong className="text-stone-100">Connect</strong>. A Prime Accountax page opens — sign in if asked.</Step>
          <Step n={4}>Choose your organisation and what it may do, then click <strong className="text-stone-100">Allow</strong>.</Step>
        </ol>
        <a
          href="https://claude.ai/settings/connectors"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md text-[12px] font-medium ring-1 ring-stone-700 text-stone-200 hover:bg-stone-800"
        >
          Open Claude connectors <ExternalLink size={12} />
        </a>

        <div className="mt-6 pt-5 border-t border-stone-800">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">Claude Code (command line)</h3>
          <p className="text-[12px] text-stone-500 mb-2">Run this once. The first time you use it, it opens the same approval page.</p>
          <CopyField value={cliCommand} label="Claude Code command" />
        </div>

        <div className="mt-6 pt-5 border-t border-stone-800">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">ChatGPT and other assistants</h3>
          <p className="text-[13px] text-stone-400 leading-relaxed">
            Look for where it lets you add a <strong className="text-stone-200">custom connector</strong> or <strong className="text-stone-200">MCP server</strong> by
            URL (the menu names change between versions, and ChatGPT may need developer mode switched on first). Paste the address above and choose
            sign-in with <strong className="text-stone-200">OAuth</strong> if it asks. Anything that speaks MCP over HTTP will work the same way.
          </p>
        </div>
      </Card>

      {/* 3. What it can and cannot do */}
      <Card className="p-5 mb-5">
        <div className="flex items-start gap-3">
          <ShieldCheck size={18} className="text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <h2 className="text-[13px] font-semibold text-white">You stay in control</h2>
            <ul className="mt-2 space-y-1.5 text-[13px] text-stone-400 leading-relaxed list-disc pl-4">
              <li>It acts <strong className="text-stone-200">as you</strong>. Anything your role cannot do in the app, it cannot do either.</li>
              <li>You choose, per connection, whether it may only read, also create and change, also delete, and — separately — change QuickBooks / Xero, or send email and change settings.</li>
              <li>Personal identifiers (such as SSN and date of birth) and credentials are never passed to it, and QuickBooks employee records are off limits.</li>
              <li>Deleting, and any change to QuickBooks / Xero, needs a second confirmation (at most 100 records at a time), and everything it reads or does is recorded in the audit trail under your name.</li>
              <li>You can disconnect at any time below. It stops working immediately.</li>
              <li>Text inside invoices and emails comes from other people. Keep <em>send email</em> switched off unless you need it.</li>
            </ul>
          </div>
        </div>
      </Card>

      {/* 4. What is connected right now */}
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-stone-500 mb-2">Connected assistants</h2>
      {actionError && <p className="text-[13px] text-red-400 mb-2" role="alert">{actionError}</p>}

      {rows === null ? (
        <div className="flex items-center gap-2 text-[13px] text-stone-500 py-4"><Loader size={14} className="animate-spin" /> Loading…</div>
      ) : loadError ? (
        <p className="text-[13px] text-red-400 py-2" role="alert">{loadError}</p>
      ) : rows.length === 0 ? (
        <Card className="p-5 text-[13px] text-stone-500">Nothing is connected yet. Once you approve an assistant it will appear here.</Card>
      ) : (
        <div className="space-y-2">
          {rows.map((c) => {
            const granted = new Set(c.scopes.split(/\s+/));
            return (
              <Card key={c.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] font-semibold text-white truncate">{c.clientName || "AI assistant"}</div>
                    <div className="text-[12px] text-stone-500 mt-0.5">
                      {c.orgName ? `${c.orgName} · ` : ""}connected {formatDate(c.createdAt)} ·{" "}
                      {c.lastUsedAt ? `last used ${formatDate(c.lastUsedAt)}` : "not used yet"}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {ACCESS_LABELS.filter((a) => granted.has(a.scope)).map((a) => (
                        <span
                          key={a.scope}
                          className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${a.risky ? "bg-amber-500/15 text-amber-300" : "bg-stone-800 text-stone-300"}`}
                        >
                          {a.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {confirming === c.id ? (
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" disabled={busy === c.id} onClick={() => setConfirming(null)} className="h-8 px-3 rounded-md text-[12px] text-stone-300 ring-1 ring-stone-700 hover:text-white disabled:opacity-50">Keep</button>
                      <button type="button" disabled={busy === c.id} onClick={() => disconnect(c.id)} className="h-8 px-3 rounded-md text-[12px] font-medium bg-red-600 text-white hover:bg-red-500 disabled:opacity-50">
                        {busy === c.id ? "Disconnecting…" : "Disconnect"}
                      </button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirming(c.id)} className="shrink-0 h-8 px-3 rounded-md text-[12px] inline-flex items-center gap-1.5 text-stone-300 ring-1 ring-stone-700 hover:text-white hover:ring-stone-500">
                      <Trash2 size={12} /> Disconnect
                    </button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
