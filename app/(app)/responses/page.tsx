"use client";

import { ResponsesInbox } from "@/components/responses-inbox";

export default function ResponsesPage() {
  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-stone-900 tracking-tight">Customer Responses</h1>
        <p className="text-sm text-stone-500 mt-1">
          Promise dates and disputes your customers submitted via the portal — plus anything logged by staff.
        </p>
      </div>
      <ResponsesInbox />
    </div>
  );
}
