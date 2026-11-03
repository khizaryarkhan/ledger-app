"use client";

import { useState } from "react";

type Org = { id: string; name: string; role: string };
type Params = { client_id: string; redirect_uri: string; code_challenge: string; state: string };

// The user decides, per connection, how far the AI client may go. Read is always
// on; write and delete are separate boxes and start OFF unless the client asked
// for them. Whatever is ticked, the AI still acts only as this user — their own
// role in the app decides what actually succeeds.
export function McpConsentForm(props: {
  clientName: string; redirectHost: string; orgs: Org[]; params: Params;
}) {
  const [orgId, setOrgId] = useState(props.orgs[0].id);
  // Everything beyond read starts OFF. Never seed these from the request: the
  // link that brought the user here is not trusted.
  const [write, setWrite] = useState(false);
  const [del, setDel] = useState(false);
  const [sensitive, setSensitive] = useState(false);
  const [books, setBooks] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const decide = async (decision: "approve" | "deny") => {
    setBusy(true);
    setError("");
    try {
      const scope = ["mcp:read", write ? "mcp:write" : "", del ? "mcp:delete" : "", sensitive ? "mcp:sensitive" : "", books ? "mcp:accounting_system" : ""].filter(Boolean).join(" ");
      const res = await fetch("/api/mcp/oauth/approve", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...props.params, orgId, scope, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.redirectTo) throw new Error(data.error || "Could not complete the connection.");
      window.location.href = data.redirectTo;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not complete the connection.");
      setBusy(false);
    }
  };

  const box = "mt-1 w-full h-9 rounded-md bg-stone-950 border border-stone-700 px-2 text-[13px] text-stone-100";

  return (
    <div className="min-h-screen flex items-center justify-center bg-stone-950 p-4">
      <div className="w-full max-w-md rounded-lg border border-stone-800 bg-stone-900 p-6">
        <h1 className="text-[20px] font-semibold text-white tracking-tight">Connect {props.clientName}</h1>
        <p className="text-[13px] text-stone-400 mt-1">
          <span className="text-stone-200">{props.clientName}</span> wants to work in Prime Accountax on your behalf.
        </p>
        <div className="mt-3 rounded-md border border-amber-700/60 bg-amber-950/30 px-3 py-2 text-[12px] text-amber-200">
          This application registered itself and is <strong>not verified</strong>. Its name is whatever it chose to call itself.
          After you allow, you will be sent to <strong className="break-all">{props.redirectHost}</strong> — only continue if you
          started this from an app you trust and that address is the one you expect.
        </div>

        <label className="block mt-5 text-[12px] text-stone-400">
          Organisation
          <select value={orgId} onChange={(e) => setOrgId(e.target.value)} className={box}>
            {props.orgs.map((o) => <option key={o.id} value={o.id}>{o.name} — {o.role.replace("_", " ")}</option>)}
          </select>
        </label>

        <fieldset className="mt-5 space-y-3">
          <legend className="text-[12px] text-stone-400">What it may do</legend>
          <label className="flex items-start gap-2 text-[13px] text-stone-300 opacity-80">
            <input type="checkbox" checked disabled className="mt-1" />
            <span><span className="text-stone-100">Read</span> — view invoices, customers, reports and ledger data.</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-stone-300">
            <input type="checkbox" checked={write} onChange={(e) => setWrite(e.target.checked)} className="mt-1" />
            <span><span className="text-stone-100">Create and change</span> — add and edit records in Prime Accountax.</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-stone-300">
            <input type="checkbox" checked={del} onChange={(e) => setDel(e.target.checked)} className="mt-1" />
            <span><span className="text-stone-100">Delete</span> — remove records. Each delete still needs confirming in the AI client.</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-stone-300">
            <input type="checkbox" checked={books} onChange={(e) => setBooks(e.target.checked)} className="mt-1" />
            <span><span className="text-stone-100">Change QuickBooks / Xero</span> — edit or delete records in your connected books through Data Studio. At most 100 records per request, and each change is described and confirmed before it runs.</span>
          </label>
          <label className="flex items-start gap-2 text-[13px] text-stone-300">
            <input type="checkbox" checked={sensitive} onChange={(e) => setSensitive(e.target.checked)} className="mt-1" />
            <span><span className="text-stone-100">Send email and change organisation settings</span> — email customers from your mailbox, change email and organisation settings, create employee logins. Leave this off unless you need it: text inside invoices and emails can try to trick an AI into misusing it.</span>
          </label>
        </fieldset>

        <p className="mt-5 text-[12px] text-stone-500">
          It acts as you: anything your role cannot do in the app, it cannot do either. You can disconnect it at any time.
        </p>

        {error && <p className="mt-3 text-[13px] text-red-400" role="alert">{error}</p>}

        <div className="mt-6 flex justify-end gap-2">
          <button type="button" disabled={busy} onClick={() => decide("deny")} className="h-9 px-4 rounded-md text-[13px] text-stone-300 ring-1 ring-stone-700 hover:text-white disabled:opacity-50">Cancel</button>
          <button type="button" disabled={busy} onClick={() => decide("approve")} className="h-9 px-4 rounded-md text-[13px] font-medium bg-emerald-500 text-white hover:bg-emerald-400 disabled:opacity-50">
            {busy ? "Connecting…" : "Allow"}
          </button>
        </div>
      </div>
    </div>
  );
}
