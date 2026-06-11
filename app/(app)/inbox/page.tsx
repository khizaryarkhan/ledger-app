"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useData } from "@/components/data-provider";
import { Card, Badge, Input, EmptyState } from "@/components/ui";
import { fmt } from "@/lib/format";
import { Search, ArrowDownRight, ArrowUpRight, FileEdit, Inbox } from "lucide-react";

export default function InboxPage() {
  const { communications, customers, contacts, invoices } = useData();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "inbound" | "outbound">("all");

  const filtered = useMemo(() => {
    let res = communications;
    if (filter === "inbound") res = res.filter(c => c.direction === "Inbound");
    if (filter === "outbound") res = res.filter(c => c.direction === "Outbound");
    if (search) {
      const s = search.toLowerCase();
      res = res.filter(c => (c.subject || "").toLowerCase().includes(s) || (c.body || "").toLowerCase().includes(s));
    }
    return [...res].sort((a, b) => new Date(b.sentAt).getTime() - new Date(a.sentAt).getTime());
  }, [communications, search, filter]);

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-white tracking-tight">Communications</h1>
          <p className="text-sm text-stone-400 mt-1">Sent emails, customer responses and internal notes</p>
        </div>
      </div>

      <div className="flex items-center gap-2 mb-4">
        <Input value={search} onChange={(e: any) => setSearch(e.target.value)} placeholder="Search..." icon={Search} className="flex-1 max-w-md" />
        <div className="flex bg-stone-800 rounded-md p-0.5 text-xs font-medium">
          {[["all", "All"], ["inbound", "Inbound"], ["outbound", "Outbound"]].map(([v, l]) => (
            <button key={v} onClick={() => setFilter(v as any)}
              className={`px-3 py-1.5 rounded ${filter === v ? "bg-stone-700 text-white shadow-sm" : "text-stone-400 hover:text-stone-200"}`}>{l}</button>
          ))}
        </div>
      </div>

      {filtered.length === 0 ? (
        <Card><EmptyState icon={Inbox} title="No messages" description="Communications across customers appear here." /></Card>
      ) : (
        <Card padding="none">
          {filtered.map(c => {
            const customer = customers.find(x => x.id === c.customerId);
            const contact = contacts.find(x => x.id === c.contactId);
            const invoice = invoices.find(x => x.id === c.invoiceId);
            const isInbound = c.direction === "Inbound";
            const isNote = c.channel === "Note";
            return (
              <Link key={c.id} href={customer ? `/customers/${customer.id}` : "#"} className="flex items-start gap-3 px-4 py-3 border-b border-stone-800 last:border-0 hover:bg-stone-800/50">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isNote ? "bg-amber-500/20 text-amber-400" : isInbound ? "bg-emerald-500/20 text-emerald-400" : "bg-blue-500/20 text-blue-400"
                }`}>
                  {isNote ? <FileEdit size={12} /> : isInbound ? <ArrowDownRight size={12} /> : <ArrowUpRight size={12} />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <div className="text-sm font-medium text-white truncate">{customer?.name}{contact ? ` · ${contact.name}` : ""}</div>
                    <div className="text-[11px] text-stone-500 flex-shrink-0 ml-2">{fmt.relative(c.sentAt)}</div>
                  </div>
                  {c.subject && <div className="text-sm text-stone-300 truncate">{c.subject}</div>}
                  <div className="text-[12px] text-stone-500 truncate mt-0.5">{c.body}</div>
                  <div className="flex items-center gap-3 mt-1">
                    {invoice && <span className="text-[10px] font-mono text-stone-500">{invoice.invoiceNumber}</span>}
                    {!isNote && c.recipients && (
                      <span className="text-[10px] text-stone-600 truncate">
                        <span className="text-stone-700">{isInbound ? "From:" : "To:"}</span>{" "}
                        <span className="text-stone-500">{c.recipients}</span>
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
