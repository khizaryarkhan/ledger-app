import { ReactNode } from "react";

export default function ReportingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-y-auto bg-stone-950">
      {children}
    </div>
  );
}
