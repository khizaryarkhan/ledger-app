"use client";

/**
 * Page frame shared by the resource reports. In the app it is the standard
 * full-height ListPage shell; in the employee portal (no app top bar) it is a
 * plain stacked header + body.
 */

import type { ReactNode } from "react";
import { ListPage, ListPageHeader } from "@/components/list-view";
import { ReportExportMenu } from "@/components/report-export-menu";
import type { ReportExportModel } from "@/lib/reports/export-model";

export type ReportShellKind = "app" | "portal";

/** `exportModel` undefined = this report has no export; null = not ready to export yet (loading, failed, or stale). */
export function ReportShell({ shell, title, subtitle, actions, exportModel, children }: {
  shell: ReportShellKind; title: string; subtitle: string; actions?: ReactNode; exportModel?: ReportExportModel | null; children: ReactNode;
}) {
  const header = (
    <>
      {actions}
      {exportModel !== undefined && <ReportExportMenu model={exportModel} pdf={shell !== "portal"} />}
    </>
  );
  if (shell === "portal") {
    return (
      <div className="flex flex-col">
        <ListPageHeader title={title} subtitle={subtitle}>{header}</ListPageHeader>
        <div className="px-6 py-4">{children}</div>
      </div>
    );
  }
  return (
    <ListPage>
      <ListPageHeader title={title} subtitle={subtitle}>{header}</ListPageHeader>
      <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
    </ListPage>
  );
}

export { WEEKDAY_SHORT, UNDER_LOGGED_RATIO } from "@/lib/resources/report-constants";
