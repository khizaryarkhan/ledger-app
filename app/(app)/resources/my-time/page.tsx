"use client";

import { ListPage, ListPageHeader } from "@/components/list-view";
import { MyTimesheet } from "@/components/my-timesheet";

export default function ResourcesMyTimePage() {
  return (
    <ListPage>
      <ListPageHeader title="My timesheet" subtitle="Log your hours by day, then submit the week for approval." />
      <div className="flex-1 overflow-y-auto">
        <MyTimesheet />
      </div>
    </ListPage>
  );
}
