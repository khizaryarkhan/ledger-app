"use client";

/**
 * Page frame shared by the resource reports. In the app it is the standard
 * full-height ListPage shell; in the employee portal (no app top bar) it is a
 * plain stacked header + body.
 */

import type { ReactNode } from "react";
import { ListPage, ListPageHeader } from "@/components/list-view";

export type ReportShellKind = "app" | "portal";

export function ReportShell({ shell, title, subtitle, actions, children }: {
  shell: ReportShellKind; title: string; subtitle: string; actions?: ReactNode; children: ReactNode;
}) {
  if (shell === "portal") {
    return (
      <div className="flex flex-col">
        <ListPageHeader title={title} subtitle={subtitle}>{actions}</ListPageHeader>
        <div className="px-6 py-4">{children}</div>
      </div>
    );
  }
  return (
    <ListPage>
      <ListPageHeader title={title} subtitle={subtitle}>{actions}</ListPageHeader>
      <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
    </ListPage>
  );
}

export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** A week with less than this share of its capacity logged reads as under-logged. */
export const UNDER_LOGGED_RATIO = 0.8;
