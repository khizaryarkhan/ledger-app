"use client";

import { ListPage, ListPageHeader } from "@/components/list-view";
import { ApprovalsPanel } from "@/components/approvals-panel";

export default function ResourcesApprovalsPage() {
  return (
    <ListPage>
      <ListPageHeader title="Time approvals" subtitle="Submitted time from the people you approve for." />
      <div className="flex-1 overflow-y-auto">
        <ApprovalsPanel />
      </div>
    </ListPage>
  );
}
